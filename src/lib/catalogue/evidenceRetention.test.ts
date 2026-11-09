/** @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { importCandidateBatch } from "./candidateQueue";
import { importQualificationEvidence } from "./qualificationEvidence";
import { pruneQualificationEvidence } from "./evidenceRetention";

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "stumblr-evidence-retention-"));
  vi.stubEnv("STUMBLR_DB_PATH", join(directory, "ops.sqlite"));
});
afterEach(() => {
  closeOpsDbForTests();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function seed(id: string) {
  const canonical_url = `https://${id}.example/`;
  importCandidateBatch([{
    id, canonical_url, domain: `${id}.example`, source_id: "feed", source_family: "test", source_url: "https://feed.example/",
    topics: ["art"], title_hint: "A field guide", selection_status: "evaluation_candidate", availability_status: 200,
  }]);
  const add = (run_id: string, observed_at: string) => importQualificationEvidence({
    run_id, run_attempt: 1, qualifier_version: "browser-qualification-v1",
    observations: (["desktop", "mobile"] as const).map(device => ({
      device, canonical_url, observed_at, final_url: canonical_url, document_http_status: 200,
      render_result: "text_observed", functionality_result: "not_demonstrated", meaningful_text_length: 500,
      interaction_evidence: { attempted: false, visible_state_changed: false },
      network_failure_reasons: [], frame_failure_reasons: [], console_failure_reasons: [],
    })),
  }, { revision: "a".repeat(40), issuedAt: 1, runId: run_id, runAttempt: 1 });
  return add;
}

test("prunes only superseded observations older than 30 days and preserves latest candidate state", () => {
  const now = new Date("2026-11-09T00:00:00.000Z");
  const add = seed("retention-old");
  add("1", "2026-10-01T00:00:00.000Z");
  add("2", "2026-11-01T00:00:00.000Z");
  const before = Number(openOpsDb().prepare("SELECT COUNT(*) AS count FROM candidate_qualification_evidence").get()?.count);

  const result = pruneQualificationEvidence(now);

  expect(result).toMatchObject({ deleted: 2 });
  expect(Number(openOpsDb().prepare("SELECT COUNT(*) AS count FROM candidate_qualification_evidence").get()?.count)).toBe(before - 2);
  expect(openOpsDb().prepare("SELECT run_id FROM candidate_qualification_evidence").all().map(row => row.run_id)).toEqual(["2", "2"]);
});

test("preserves every release audit and latest candidate state while pruning old superseded evidence", () => {
  const now = new Date("2026-11-09T00:00:00.000Z");
  const add = seed("retention-audited");
  add("1", "2026-10-01T00:00:00.000Z");
  add("2", "2026-11-01T00:00:00.000Z");
  const db = openOpsDb();
  db.prepare("INSERT INTO runtime_catalogue_snapshots(revision, issued_at, payload_json, imported_at) VALUES (?, ?, ?, ?)")
    .run("release-1", 1, JSON.stringify({ entries: [] }), "2026-10-01T00:00:00.000Z");
  db.prepare(`INSERT INTO auto_publication_proposals
    (proposal_id, actor_revision, actor_run_id, actor_run_attempt, actor_event, actor_issued_at, expected_revision,
     policy_version, requested_cap, content_hash, proposed_snapshot_json, decisions_json, counts_json, evidence_json,
     removals_json, status, created_at)
    VALUES ('proposal-1', 'release-1', '1', 1, 'schedule', 1, NULL, 'v1', 1, 'hash', '{}', '{}', '{}', '{}', '[]', 'published', ?)`)
    .run("2026-10-01T00:00:00.000Z");
  db.prepare(`INSERT INTO auto_publication_audit
    (revision, release_revision, proposal_id, operation, additions_json, removals_json, result_json, actor_revision, actor_issued_at, created_at)
    VALUES (?, ?, ?, 'publish', '[]', '[]', '{}', ?, ?, ?)`).run("release-1", "release-1", "proposal-1", "release-1", 1, "2026-10-01T00:00:00.000Z");

  pruneQualificationEvidence(now);

  expect(Number(db.prepare("SELECT COUNT(*) AS count FROM auto_publication_audit").get()?.count)).toBe(1);
  expect(Number(db.prepare("SELECT COUNT(*) AS count FROM candidate_qualification_evidence WHERE run_id = '2'").get()?.count)).toBe(2);
});

test("runtime retention bounds total deletes, keeping the cutoff, latest raw rows, and durable transitions", () => {
  const add = seed("retention-runtime");
  add("1", "2026-11-01T00:00:00.000Z");
  seed("retention-latest");
  const db = openOpsDb();
  const id = "retention-runtime";
  const before = "2026-10-09T23:59:59.999Z";
  const boundary = "2026-10-10T00:00:00.000Z";
  db.prepare("INSERT INTO runtime_health_state VALUES (?, 'quarantined', 'runtime_two_independent_hard_failures', 2, 0, ?)").run(id, before);
  db.prepare(`INSERT INTO runtime_health_transitions(candidate_id, from_state, to_state, reason_code, source, observed_at, run_id, run_attempt)
    VALUES (?, 'suspect', 'quarantined', 'runtime_two_independent_hard_failures', 'browser', ?, '1', 1)`).run(id, before);
  const browser = db.prepare("INSERT INTO runtime_health_observations VALUES (?, ?, 1, 'browser-qualification-v1', '{}', ?)");
  const http = db.prepare("INSERT INTO runtime_http_evidence VALUES (?, ?, 1, ?, 200, '{}')");
  for (let run = 1; run <= 502; run++) {
    browser.run(id, String(run), before);
    http.run(id, String(run), before);
  }
  browser.run(id, "503", boundary);
  http.run(id, "503", boundary);
  browser.run("retention-latest", "1", before);
  http.run("retention-latest", "1", before);

  const now = new Date("2026-11-09T00:00:00.000Z");
  expect(pruneQualificationEvidence(now)).toMatchObject({ eligible: 1004, deleted: 500, remaining: 504, cutoff: boundary });
  expect(pruneQualificationEvidence(now)).toMatchObject({ deleted: 500, remaining: 4 });
  expect(pruneQualificationEvidence(now)).toMatchObject({ deleted: 4, remaining: 0 });
  for (const table of ["runtime_health_observations", "runtime_http_evidence"]) {
    expect(db.prepare(`SELECT candidate_id, run_id FROM ${table} ORDER BY candidate_id`).all()).toEqual([
      { candidate_id: "retention-latest", run_id: "1" }, { candidate_id: id, run_id: "503" },
    ]);
  }
  expect(db.prepare("SELECT state FROM runtime_health_state WHERE candidate_id = ?").get(id)?.state).toBe("quarantined");
  expect(db.prepare("SELECT to_state, run_id FROM runtime_health_transitions").all()).toEqual([{ to_state: "quarantined", run_id: "1" }]);
});
