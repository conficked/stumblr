/** @vitest-environment node */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { importCandidateBatch } from "./candidateQueue";
import { getQualificationUrlIdentity, importQualificationEvidence } from "./qualificationEvidence";
import { getConfirmedRuntimeHealthTargets, installRuntimeCatalogue, readRuntimeCatalogue } from "./runtimeStore";
import { applyRuntimeHealthEvidence, type RuntimeObservationPair } from "./runtimeHealth";
import { classifyCollectorTitle } from "./titleClassification.mjs";
import { sanitizeAutoPublishTitle } from "./autoPublishPolicy";
import type { AutoPublishActor } from "@/lib/security/cataloguePublisher";

const publisher = () => import("./autoPublisher");
const sha = "a".repeat(40);
const manualRevision = "b".repeat(40);
const when = () => new Date(Date.now() - 1_000).toISOString();
const actor = (runId = "431", issuedAt = Math.floor(Date.now() / 1_000)): AutoPublishActor => ({
  revision: `${sha}:${runId}:1`, runId, runAttempt: 1, event: "workflow_dispatch", issuedAt,
});
const manualEntry = (id = "reviewed-archive") => ({
  id, title: "Atlas of forgotten tramways", canonicalUrl: `https://${id}.example/`, domain: `${id}.example`,
  topics: ["archives"], description: "A reviewed reference.", status: "evaluation_only", policyBasis: null,
  provenance: { sourceNote: "Reviewed fixture", reviewer: "maintainer", reviewedAt: when() },
  embedEvidence: { observedHeaders: "fixture", observedRenderResult: "rendered", observedAt: when(), device: "desktop" },
});

function seedCandidate(id: string, title: string, url = `https://${id}.example/`, screenedFinalUrl?: string) {
  importCandidateBatch([{
    id, canonical_url: url, domain: new URL(url).hostname, source_id: "lobsters-rss", source_family: "community-feed",
    source_url: "https://lobste.rs/rss", topics: ["art"], title_hint: title,
    selection_status: "evaluation_candidate", availability_status: 200, x_frame_options: null, content_security_policy: null,
    title_signals: classifyCollectorTitle(title, sanitizeAutoPublishTitle(title)),
    screened_destination: screenedFinalUrl ? { ...getQualificationUrlIdentity(screenedFinalUrl), metadata_denied: false } : undefined,
  }]);
  addEvidence(url, "49", "text_observed", screenedFinalUrl);
}

function addEvidence(url: string, runId: string, render_result = "text_observed", finalUrl = url) {
  importQualificationEvidence({
    run_id: runId, run_attempt: 1, qualifier_version: "browser-qualification-v4",
    observations: ["desktop", "mobile"].map(device => ({
      device, canonical_url: url, final_url: finalUrl, observed_at: when(), document_http_status: 200, render_result,
      functionality_result: "not_demonstrated", meaningful_text_length: 810,
      interaction_evidence: { attempted: false, visible_state_changed: false },
      network_failure_reasons: [], frame_failure_reasons: [], console_failure_reasons: [],
    })),
  }, { revision: sha, issuedAt: actor().issuedAt, runId, runAttempt: 1 });
}

const seedReading = () => seedCandidate("chromatic-memory", "A field guide to chromatic memory");
const ids = () => readRuntimeCatalogue().entries.map(entry => entry.id);
const snapshotCount = () => openOpsDb().prepare("SELECT COUNT(*) AS count FROM runtime_catalogue_snapshots").get()?.count;
const confirm = async (owner: AutoPublishActor, preview: { proposalId: string; expectedRevision: string | null; contentHash: string }) => {
  const api = await publisher();
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  if (release.status === "published") {
    api.completeAutoPublicationProof(owner, release.revision!, "verified");
    api.completeAutoPublicationPublicCheck(owner, release.revision!, "confirmed");
  }
  return release;
};

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "stumblr-auto-publication-"));
  vi.stubEnv("STUMBLR_DB_PATH", join(directory, "ops.sqlite"));
});
afterEach(() => {
  closeOpsDbForTests();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

test("redirected candidates are held back without a provable title and never leak the terminal URL", async () => {
  const start = "https://chromatic-memory.example/start";
  const base = "https://chromatic-memory.example/archive?continuation=";
  const terminal = base.padEnd(16_384, "q");
  seedCandidate("chromatic-memory", "A field guide to chromatic memory", start, terminal);
  const owner = actor();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(preview.additions).toEqual([]);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: ["title_missing"] })]);
  expect(JSON.stringify(preview)).not.toContain("/archive?continuation");
  const stored = openOpsDb().prepare("SELECT decisions_json, evidence_json FROM auto_publication_proposals").get();
  expect(JSON.stringify(stored)).not.toContain("/archive?continuation");
});

test("scheduled daily previews persist bounded evidence-retention counts in their report", async () => {
  const owner = { ...actor("440"), event: "schedule" as const };
  const preview = (await publisher()).createAutoPublicationPreview(owner, 20);
  expect(preview.retention).toEqual(expect.objectContaining({ eligible: 0, deleted: 0, remaining: 0 }));
  const stored = openOpsDb().prepare("SELECT counts_json FROM auto_publication_proposals WHERE proposal_id = ?").get(preview.proposalId);
  expect(JSON.parse(String(stored?.counts_json)).retention).toEqual(preview.retention);
});

test("legacy collector title and framing headers cannot reflect a terminal URL into storage or decisions", async () => {
  const start = "https://chromatic-memory.example/start";
  const terminal = "https://chromatic-memory.example/archive?token=redirect-reflection-secret#private";
  const screened_destination = { ...getQualificationUrlIdentity(terminal), metadata_denied: false };
  importCandidateBatch([{
    id: "chromatic-memory", canonical_url: start, domain: "chromatic-memory.example", source_id: "lobsters-rss",
    source_family: "community-feed", source_url: "https://lobste.rs/rss", topics: ["art"],
    title_hint: `A field guide to chromatic memory ${terminal}`, selection_status: "evaluation_candidate",
    availability_status: 200, x_frame_options: `unsupported ${terminal}`,
    content_security_policy: `report-uri ${terminal}`, screened_destination,
    title_signals: classifyCollectorTitle("A field guide to chromatic memory", "A field guide to chromatic memory"),
  }]);
  addEvidence(start, "49", "text_observed", terminal);
  const owner = actor();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(JSON.stringify(preview)).not.toContain("redirect-reflection-secret");
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: ["title_missing"] })]);
  const db = openOpsDb();
  expect(db.prepare("SELECT link_text, screen_json FROM discovery_candidates").get()).toMatchObject({
    link_text: "Website at chromatic-memory.example",
    screen_json: expect.not.stringContaining("redirect-reflection-secret"),
  });
  for (const file of [join(directory, "ops.sqlite"), join(directory, "ops.sqlite-wal")]) {
    expect(readFileSync(file).includes(Buffer.from(terminal))).toBe(false);
  }
});

test("suffix-only reflected destinations are absent from candidate rows and publication artifacts", async () => {
  const start = "https://chromatic-memory.example/start";
  const suffix = "/private-path?token=fixture#fragment";
  const terminal = `https://chromatic-memory.example${suffix}`;
  seedCandidate("chromatic-memory", `A field guide to chromatic memory [${suffix}]`, start, terminal);
  const db = openOpsDb();
  expect(JSON.stringify(db.prepare("SELECT link_text, screen_json FROM discovery_candidates").all())).not.toContain(suffix);
  // Older queue rows can contain reflected titles even when they bypassed current ingestion.
  db.prepare("UPDATE discovery_candidates SET link_text = ?").run(`A field guide to chromatic memory [${suffix}]`);
  const owner = actor();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: ["title_missing"] })]);
  expect(JSON.stringify(preview)).not.toContain(suffix);
  expect(JSON.stringify(db.prepare("SELECT decisions_json, proposed_snapshot_json FROM auto_publication_proposals").all())).not.toContain(suffix);
});

test.each([
  ["/(fixture-private-path)", "fixture-private-path"],
  ["?(fixture-private-query)", "fixture-private-query"],
  ["#(fixture-private-fragment)", "fixture-private-fragment"],
])("parenthesized redirected title %s stays out of ingestion, legacy decisions, and snapshots", async (suffix, secret) => {
  const start = "https://chromatic-memory.example/start";
  const terminal = `https://chromatic-memory.example${suffix}`;
  seedCandidate("chromatic-memory", `A field guide ${suffix}`, start, terminal);
  const db = openOpsDb();
  expect(JSON.stringify(db.prepare("SELECT link_text, screen_json FROM discovery_candidates").all())).not.toContain(secret);
  for (const file of [join(directory, "ops.sqlite"), join(directory, "ops.sqlite-wal")]) {
    expect(readFileSync(file).includes(Buffer.from(secret))).toBe(false);
  }
  db.prepare("UPDATE discovery_candidates SET link_text = ?").run(`A field guide ${suffix}`);
  const owner = actor();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: ["title_missing"] })]);
  expect(JSON.stringify(preview)).not.toContain(secret);
  for (const query of ["SELECT decisions_json, proposed_snapshot_json FROM auto_publication_proposals", "SELECT payload_json FROM runtime_catalogue_snapshots"]) {
    expect(JSON.stringify(db.prepare(query).all())).not.toContain(secret);
  }
});

test("collector title classifications survive safe fallback titles into editorial decisions", async () => {
  const start = "https://chromatic-memory.example/start";
  const terminal = "https://chromatic-memory.example/?(fixture-private-query)";
  importCandidateBatch([{
    id: "chromatic-memory", canonical_url: start, domain: "chromatic-memory.example", source_id: "lobsters-rss",
    source_family: "community-feed", source_url: "https://lobste.rs/rss", topics: ["art"],
    title_hint: "Website at chromatic-memory.example", title_signals: { quality: true, denied: true },
    selection_status: "evaluation_candidate", availability_status: 200,
    screened_destination: { ...getQualificationUrlIdentity(terminal), metadata_denied: false },
  }]);
  addEvidence(start, "49", "text_observed", terminal);
  const db = openOpsDb();
  const preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["metadata_denied"]) })]);
  expect(JSON.stringify(db.prepare("SELECT screen_json FROM discovery_candidates").all())).not.toContain("fixture-private-query");
});

test("declared title classifications cannot override a denial in the supplied title", async () => {
  const url = "https://chromatic-memory.example/";
  importCandidateBatch([{
    id: "chromatic-memory", canonical_url: url, domain: "chromatic-memory.example", source_id: "lobsters-rss",
    source_family: "community-feed", source_url: "https://lobste.rs/rss", topics: ["art"],
    title_hint: "Online store buy now", title_signals: { quality: true, denied: false },
    selection_status: "evaluation_candidate", availability_status: 200,
  }]);
  addEvidence(url, "49");
  const preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["metadata_denied"]) })]);
});

test("title gates survive privacy-safe ingestion and legacy missing classifications fail closed", async () => {
  seedCandidate("chromatic-memory", "Online store buy now");
  const db = openOpsDb();
  let preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["metadata_denied"]) })]);
  expect(JSON.stringify(db.prepare("SELECT link_text, screen_json FROM discovery_candidates").all())).not.toContain("Online store buy now");
  db.exec("UPDATE discovery_candidates SET screen_json = json_remove(screen_json, '$.title_signals')");
  preview = (await publisher()).createAutoPublicationPreview(actor("432"), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_quality"]) })]);
  db.exec(`UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.title_signals', json('{"quality":true,"denied":"false"}'))`);
  preview = (await publisher()).createAutoPublicationPreview(actor("433"), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_quality"]) })]);
  db.exec(`UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.title_signals', json('{"quality":true,"denied":false,"extra":true}'))`);
  preview = (await publisher()).createAutoPublicationPreview(actor("434"), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_quality"]) })]);
});

test("an availability recheck cannot clear a bounded editorial denial", async () => {
  const url = "https://chromatic-memory.example/";
  seedCandidate("chromatic-memory", "Online store buy now", url);
  importCandidateBatch([{
    id: "chromatic-memory", canonical_url: url, domain: "chromatic-memory.example",
    source_id: "runtime-recheck", source_family: "runtime-recheck", source_url: "https://stumblr.dev/api/catalogue",
    topics: ["art"], title_hint: "Website at chromatic-memory.example", title_signals: { quality: true, denied: false },
    selection_status: "evaluation_candidate", availability_status: 200,
  }]);
  const preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({
    candidateId: "chromatic-memory", reasons: expect.arrayContaining(["metadata_denied"]),
  })]);
});

test("redirects without bounded title evidence remain ineligible after collection and import", async () => {
  execFileSync("python3", ["-c", `
from pathlib import Path
import sys
from unittest.mock import Mock, MagicMock, patch
from scripts import discover_catalogue_candidates as disc
out = sys.argv[1]
source = {"id": "lobsters-rss", "kind": "html", "url": "https://lobste.rs/rss",
          "topic_hint": "art", "source_family": "community-feed"}
opener = MagicMock()
response = Mock(status=200, headers={"content-type": "text/html"})
response.geturl.return_value = "https://chromatic-memory.example/terminal?private=fixture-value"
response.read.return_value = b"<p>A document without a title</p>"
opener.open.return_value.__enter__.return_value = response
with (patch.object(disc, "SOURCE_CONFIG", [source]),
      patch.object(disc, "load_existing_catalogue_keys", return_value=(set(), set())),
      patch.object(disc, "robots_allows", return_value=(True, "ok")),
      patch.object(disc, "fetch_text", return_value='<a href="https://chromatic-memory.example/start">A beautiful atlas</a>'),
      patch.object(disc, "resolve_public_ip", return_value=(True, "ok")),
      patch.object(disc, "build_opener", return_value=opener),
      patch.object(sys, "argv", ["discover", "--skip-db", "--output-dir", out])):
    assert disc.main() == 0
`, directory]);
  const selected = JSON.parse(readFileSync(join(directory, "discovery_selected.json"), "utf8"));
  expect(selected).toHaveLength(1);
  expect(selected[0].title_hint).toBe("Website at chromatic-memory.example");
  expect(JSON.stringify(selected)).not.toContain("fixture-value");
  importCandidateBatch(selected);
  addEvidence(selected[0].canonical_url, "49", "text_observed", "https://chromatic-memory.example/terminal?private=fixture-value");
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_quality"]) })]);

  const malformed = { ...selected[0], title_signals: { quality: "true", denied: false } };
  openOpsDb().prepare("DELETE FROM auto_publication_proposals").run();
  openOpsDb().prepare("DELETE FROM discovery_candidates").run();
  expect(importCandidateBatch([malformed]).inserted).toBe(1);
  addEvidence(malformed.canonical_url, "50", "text_observed", "https://chromatic-memory.example/terminal?private=fixture-value");
  expect(api.createAutoPublicationPreview(actor("432"), 5).decisions.rejected)
    .toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_quality"]) })]);
});

test("legacy positive title signals need a digest from independent screening before publication", async () => {
  const url = "https://chromatic-memory.example/";
  seedReading();
  openOpsDb().prepare("UPDATE discovery_candidates SET screen_json = json_remove(screen_json, '$.title_signals.digest')").run();
  const api = await publisher();
  const legacy = api.createAutoPublicationPreview(actor(), 5);
  expect(legacy.decisions.rejected).toEqual([expect.objectContaining({
    candidateId: "chromatic-memory", reasons: expect.arrayContaining(["title_digest_missing"]),
  })]);
  const report = {
    id: "chromatic-memory", canonical_url: url, domain: "chromatic-memory.example",
    source_id: "lobsters-rss", source_family: "community-feed", source_url: "https://lobste.rs/rss",
    topics: ["art"], title_hint: "A field guide to chromatic memory",
    selection_status: "evaluation_candidate", availability_status: 200,
    screened_destination: { ...getQualificationUrlIdentity(url), metadata_denied: false },
  };
  importCandidateBatch([{ ...report, source_family: "runtime-recheck" }]);
  expect(api.createAutoPublicationPreview(actor("432"), 5).decisions.rejected)
    .toEqual([expect.objectContaining({ reasons: expect.arrayContaining(["title_digest_missing"]) })]);
  importCandidateBatch([report]);
  expect(api.createAutoPublicationPreview(actor("433"), 5).additions.map(entry => entry.id)).toEqual(["chromatic-memory"]);
});

test("a page whose rendered text carries sales language is not published", async () => {
  const url = "https://launch.example/";
  seedCandidate("launch", "Launch your workflow faster", url);
  importQualificationEvidence({
    run_id: "50", run_attempt: 1, qualifier_version: "browser-qualification-v4",
    observations: ["desktop", "mobile"].map(device => ({
      device, canonical_url: url, final_url: url, observed_at: when(), document_http_status: 200, render_result: "text_observed",
      functionality_result: "not_demonstrated", meaningful_text_length: 810, commercial_signal: device === "desktop",
      interaction_evidence: { attempted: false, visible_state_changed: false },
      network_failure_reasons: [], frame_failure_reasons: [], console_failure_reasons: [],
    })),
  }, { revision: sha, issuedAt: actor().issuedAt, runId: "50", runAttempt: 1 });
  const preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.additions).toEqual([]);
  expect(preview.decisions.rejected).toEqual([expect.objectContaining({ reasons: ["commercial_landing"] })]);
});

test("identical descriptive titles are shown and deduplicated across domains", async () => {
  const title = "The forgotten tramway acoustics atlas";
  seedCandidate("archive-a", title, "https://northern-trams.example/");
  seedCandidate("archive-b", title, "https://southern-acoustics.example/");
  const api = await publisher();
  const owner = actor();
  const preview = api.createAutoPublicationPreview(owner, 5);
  expect(preview.additions.map(entry => entry.id)).toEqual(["archive-a"]);
  expect(preview.decisions.deferred).toEqual([
    expect.objectContaining({ reason: "batch_duplicate", decision: expect.objectContaining({ candidateId: "archive-b" }) }),
  ]);
  expect(preview.additions[0].title).toBe(title);
  await confirm(owner, preview);
  const later = api.createAutoPublicationPreview(actor("432", owner.issuedAt + 1), 5);
  expect(later.decisions.rejected).toEqual([
    expect.objectContaining({ candidateId: "archive-b", reasons: expect.arrayContaining(["duplicate_title"]) }),
  ]);
});

test("title redaction removes path, query, fragment, and absolute URL forms while retaining descriptive text", async () => {
  const { sanitizeAutoPublishTitle } = await import("./autoPublishPolicy");
  for (const value of ["https://new.example/private?token=fixture#fragment", "/private-path", "?token=fixture", "#fragment", "archive/private", "archive?token=fixture", "archive#fragment"]) {
    expect(sanitizeAutoPublishTitle(`Forgotten tramways atlas [${value}]`)).toBe("Forgotten tramways atlas");
  }
});

test("legacy CLI imports and historical null screened destinations do not abort preview", async () => {
  const artifact = join(directory, "selected.json");
  writeFileSync(artifact, JSON.stringify([{
    canonical_url: "https://legacy.example/", domain: "legacy.example", source_id: "lobsters-rss",
    source_family: "community-feed", source_url: "https://lobste.rs/rss", topics: ["art"],
    title_hint: "A guide to historical archives", selection_status: "evaluation_candidate", availability_status: 200,
  }]));
  execFileSync("python3", ["scripts/catalogue_review_queue.py", "--db-path", join(directory, "ops.sqlite"), "ingest-selected", artifact]);
  const db = openOpsDb();
  const row = db.prepare("SELECT screen_json FROM discovery_candidates WHERE domain = 'legacy.example'").get();
  expect(JSON.parse(String(row?.screen_json))).not.toHaveProperty("screened_destination");
  db.exec("UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.screened_destination', NULL)");
  seedReading();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.admitted.map(item => item.candidateId)).toContain("chromatic-memory");
  db.exec("UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.screened_destination', json('{\"invalid\":true}')) WHERE domain = 'legacy.example'");
  expect(() => api.createAutoPublicationPreview(actor("432"), 5)).toThrow();
});

test("publication still rejects a screened cross-origin redirect and a browser terminal outside the screened URL", async () => {
  seedCandidate("chromatic-memory", "A field guide to chromatic memory",
    "https://chromatic-memory.example/start", "https://redirected.example/archive");
  const start = "https://forest-acoustics.example/start";
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests", start, "https://forest-acoustics.example/archive");
  addEvidence(start, "50", "text_observed", "https://forest-acoustics.example/elsewhere");
  const preview = (await publisher()).createAutoPublicationPreview(actor(), 5);
  expect(preview.decisions.rejected).toEqual([
    expect.objectContaining({ candidateId: "chromatic-memory", reasons: expect.arrayContaining(["redirect_mismatch"]) }),
    expect.objectContaining({ candidateId: "forest-acoustics", reasons: expect.arrayContaining(["redirect_mismatch"]) }),
  ]);
  expect(preview.additions).toEqual([]);
});

test("redaction migration removes legacy terminal URLs from queue and audit replay", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const terminal = "https://chromatic-memory.example/private-path?token=legacy-value#secret";
  const db = openOpsDb();
  db.prepare("UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.final_url', ?)").run(terminal);
  db.prepare(`UPDATE auto_publication_proposals SET decisions_json = json_set(
    decisions_json, '$.admitted[0].effectiveUrl', ?, '$.deferred', json(?)
  )`).run(terminal, JSON.stringify([{ decision: { candidateId: "deferred", effectiveUrl: terminal }, reason: "batch_cap" }]));
  db.exec(readFileSync("db/migrations/009_redact_screened_terminal_urls.sql", "utf8"));
  const replayed = api.createAutoPublicationPreview(owner, 5);
  expect(replayed.decisions.admitted[0].candidateId).toBe(preview.decisions.admitted[0].candidateId);
  expect(replayed.decisions.deferred).toEqual([{ decision: { candidateId: "deferred" }, reason: "batch_cap" }]);
  expect(JSON.stringify(replayed)).not.toContain("legacy-value");
  expect(db.prepare("SELECT screen_json FROM discovery_candidates").get()?.screen_json).not.toContain("legacy-value");
});

test("a release that cannot be proved never replaces the current public catalogue", async () => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(api.getAutoPublicationProof(owner, release.revision!)).toMatchObject({
    status: "pending", revision: release.revision, expectedRevision: manualRevision,
    entries: expect.arrayContaining([expect.objectContaining({ id: "chromatic-memory" })]),
  });
  expect(api.completeAutoPublicationProof(owner, release.revision!, "unverified")).toMatchObject({ status: "unverified" });
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'chromatic-memory'").get()?.status).toBe("pending_review");
  expect(() => api.completeAutoPublicationProof(owner, release.revision!, "verified")).toThrow();
  const retry = { ...owner, revision: `${sha}:${owner.runId}:2`, runAttempt: 2 };
  expect(api.getAutoPublicationProof(retry, release.revision!)).toMatchObject({ status: "pending" });
  expect(api.completeAutoPublicationProof(retry, release.revision!, "verified")).toMatchObject({ status: "verified" });
  expect(ids()).toEqual(["reviewed-archive", "chromatic-memory"]);
});

test("a new authenticated attempt recovers the same release and selective rollback without publishing again", async () => {
  const api = await publisher();
  const owner = { ...actor(), event: "schedule" as const };
  for (const run of ["411", "412", "413"]) api.createAutoPublicationPreview({ ...actor(run), event: "schedule" }, 5);
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  const retry = { ...owner, revision: `${sha}:${owner.runId}:2`, runAttempt: 2 };
  expect(api.createAutoPublicationPreview(retry, 5).recovery).toMatchObject({ status: "pending", release });
  expect(api.getAutoPublicationProof(retry, release.revision!)).toMatchObject({ status: "pending", revision: release.revision });
  expect(() => api.getAutoPublicationProof({ ...retry, runId: "432" }, release.revision!)).toThrow();
  expect(() => api.getAutoPublicationProof({ ...retry, revision: `${"c".repeat(40)}:${owner.runId}:2` }, release.revision!)).toThrow();
  expect(api.commitAutoPublicationPreview(retry, preview.proposalId, preview.expectedRevision, preview.contentHash)).toEqual(release);
  expect(snapshotCount()).toBe(1);
  const rollback = api.rollbackFreshAdditions(retry, release.revision!, ["chromatic-memory"]);
  expect(rollback.removedIds).toEqual(["chromatic-memory"]);
  expect(ids()).toEqual(["forest-acoustics"]);
  expect(api.createAutoPublicationPreview(retry, 5).recovery).toMatchObject({ status: "rolled_back", publicCheck: "pending", release, rollback });
  expect(api.completeAutoPublicationPublicCheck(retry, release.revision!, "confirmed")).toEqual({
    publicCheck: "confirmed", revision: rollback.revision,
  });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'chromatic-memory'").get()?.status).toBe("quarantined");
  expect(api.createAutoPublicationPreview(retry, 5).recovery).toMatchObject({ status: "rolled_back", publicCheck: "confirmed", release, rollback });
  expect(api.rollbackFreshAdditions(retry, release.revision!, ["chromatic-memory"])).toEqual(rollback);
  expect(snapshotCount()).toBe(2);
});

test("an interrupted or rejected selective rollback cannot expose a provisional release", async () => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  expect(() => api.rollbackFreshAdditions(owner, release.revision!, [old.id])).toThrow();
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'quarantined' WHERE id = 'forest-acoustics'").run();
  expect(() => api.rollbackFreshAdditions(owner, release.revision!, ["chromatic-memory"])).toThrow();
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'chromatic-memory'").get()?.status).toBe("pending_review");
});

test("full settlement rejects newer frame denial evidence observed after staging", async () => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  addEvidence("https://chromatic-memory.example/", "50", "frame_denied");
  expect(() => api.completeAutoPublicationProof(owner, release.revision!, "verified")).toThrow(/ineligible/i);
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
});

test("selective settlement rejects a survivor that became editorially denied during proof", async () => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  openOpsDb().prepare(`UPDATE discovery_candidates SET screen_json = json_set(screen_json, '$.title_signals.denied', json('true'))
    WHERE id = 'forest-acoustics'`).run();
  expect(() => api.rollbackFreshAdditions(owner, release.revision!, ["chromatic-memory"])).toThrow(/ineligible/i);
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'chromatic-memory'").get()?.status).toBe("pending_review");
});

test.each([false, true])("an activated release can be corrected by the same run after failed public readback (selective=%s)", async selective => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  const revision = release.revision!;
  const activation = selective ? api.rollbackFreshAdditions(owner, revision, ["chromatic-memory"]).revision :
    api.completeAutoPublicationProof(owner, revision, "verified").revision;
  expect(readRuntimeCatalogue().revision).toBe(activation);
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'forest-acoustics'").get()?.status).toBe("pending_review");
  const retry = { ...owner, revision: `${sha}:${owner.runId}:2`, runAttempt: 2 };
  expect(api.createAutoPublicationPreview(retry, 5).recovery).toMatchObject({ publicCheck: "pending" });
  expect(() => api.completeAutoPublicationPublicCheck(actor("432"), revision, "failed")).toThrow();
  expect(api.completeAutoPublicationPublicCheck(retry, revision, "failed")).toMatchObject({ publicCheck: "failed" });
  expect(api.completeAutoPublicationPublicCheck(retry, revision, "failed")).toMatchObject({ publicCheck: "failed" });
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'chromatic-memory'").get()?.status).toBe("pending_review");
});

test("an expired readback restores the prior public head without a recovery request", async () => {
  const api = await publisher();
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  api.completeAutoPublicationProof(owner, release.revision!, "verified");
  expect(() => api.createAutoPublicationPreview(actor("432"), 5)).toThrow(/awaiting public verification/i);
  openOpsDb().prepare("UPDATE auto_publication_proposals SET public_check_deadline = unixepoch() - 1 WHERE proposal_id = ?").run(preview.proposalId);
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [old] });
  expect(() => api.completeAutoPublicationPublicCheck(owner, release.revision!, "confirmed")).toThrow(/active revision changed/i);
  expect(api.createAutoPublicationPreview(actor("432"), 5).expectedRevision).toBe(manualRevision);
});

test("proof settlement cannot activate a stage after a newer manual publication", async () => {
  const api = await publisher();
  const owner = actor();
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  const reviewed = manualEntry();
  installRuntimeCatalogue({ entries: [reviewed] }, { revision: manualRevision, issuedAt: owner.issuedAt + 1 });
  expect(() => api.getAutoPublicationProof(owner, release.revision!)).toThrow(/stale/i);
  expect(() => api.completeAutoPublicationProof(owner, release.revision!, "verified")).toThrow(/stale/i);
  expect(() => api.rollbackFreshAdditions(owner, release.revision!, ["chromatic-memory"])).toThrow(/stale/i);
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [reviewed] });
});

test("only proof-verified and unrolled limited releases count toward the next stage", async () => {
  const api = await publisher();
  const scheduled = (id: string) => ({ ...actor(id), event: "schedule" as const });
  for (const id of ["401", "402", "403"]) api.createAutoPublicationPreview(scheduled(id), 20);
  for (const [id, title] of [["410", "Carving a wooden sundial"], ["411", "How mammoths survived winter"]]) {
    seedCandidate(`candidate-${id}`, title);
    const owner = scheduled(id);
    const preview = api.createAutoPublicationPreview(owner, 20);
    const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
    expect(api.completeAutoPublicationProof(owner, release.revision!, "verified")).toMatchObject({ status: "verified" });
    api.completeAutoPublicationPublicCheck(owner, release.revision!, "confirmed");
  }
  const owner = scheduled("412");
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 20);
  const release = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  expect(api.getAutoPublicationRolloutStage(scheduled("413"))).toEqual({ stage: "limited", cap: 5 });
  expect(api.completeAutoPublicationProof(owner, release.revision!, "verified")).toMatchObject({ status: "verified" });
  expect(api.getAutoPublicationRolloutStage(scheduled("413"))).toEqual({ stage: "limited", cap: 5 });
  api.completeAutoPublicationPublicCheck(owner, release.revision!, "confirmed");
  expect(api.getAutoPublicationRolloutStage(scheduled("413"))).toEqual({ stage: "full", cap: 20 });
});

test("three verified dispatched releases skip the scheduled ramp", async () => {
  const api = await publisher();
  const scheduled = (id: string) => ({ ...actor(id), event: "schedule" as const });
  expect(api.getAutoPublicationRolloutStage(scheduled("500"))).toEqual({ stage: "report_only", cap: 20 });
  for (const [id, title] of [
    ["510", "Carving a wooden sundial"],
    ["511", "How mammoths survived winter"],
    ["512", "Making ink for printing presses"],
  ]) {
    seedCandidate(`candidate-${id}`, title);
    const owner = actor(id);
    expect(await confirm(owner, api.createAutoPublicationPreview(owner, 20))).toMatchObject({ status: "published" });
  }
  expect(api.getAutoPublicationRolloutStage(scheduled("500"))).toEqual({ stage: "full", cap: 20 });
});

test("scheduled rollout is report-only for three distinct runs and caps three unrolled releases at five", async () => {
  const api = await publisher();
  const stamp = actor().issuedAt;
  const scheduled = (id: string, runAttempt = 1): AutoPublishActor => ({
    ...actor(id, stamp + Number(id)), event: "schedule", runAttempt, revision: `${sha}:${id}:${runAttempt}`,
  });
  const stage = (id: string) => api.getAutoPublicationRolloutStage(scheduled(id));
  seedReading();
  expect(api.createAutoPublicationPreview(actor(), 20).rolloutStage).toEqual({ stage: "full", cap: 20 });
  for (const id of ["10", "11", "12"]) {
    const owner = scheduled(id);
    expect(stage(id)).toEqual({ stage: "report_only", cap: 20 });
    const preview = api.createAutoPublicationPreview(owner, 20);
    expect(preview.rolloutStage).toEqual({ stage: "report_only", cap: 20 });
    await expect(confirm(owner, preview)).rejects.toThrow(/report.only/i);
  }
  const retry = scheduled("10", 2);
  expect(api.createAutoPublicationPreview(retry, 20).rolloutStage.stage).toBe("report_only");
  expect(stage("13")).toEqual({ stage: "limited", cap: 5 });

  for (const [id, title] of [
    ["trams", "A history of abandoned tramways"],
    ["mammoths", "How mammoths survived colder winters"],
    ["sundials", "Constructing a garden sundial"],
    ["printing", "Making ink for printing presses"],
    ["ships", "Exploring wooden shipwrecks"],
  ]) seedCandidate(id, title);
  const owner = scheduled("13");
  const preview = api.createAutoPublicationPreview(owner, 20);
  expect(preview.rolloutStage).toEqual({ stage: "limited", cap: 5 });
  expect(preview.additions).toHaveLength(5);
  expect(preview.decisions.deferred).toEqual([expect.objectContaining({ reason: "batch_cap" })]);
  const firstRelease = await confirm(owner, preview);
  expect(firstRelease.status).toBe("published");
  api.rollbackFreshAdditions(owner, owner.revision, firstRelease.addedIds);
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'rejected' WHERE status = 'pending_review'").run();
  const noOp = scheduled("14");
  expect(await confirm(noOp, api.createAutoPublicationPreview(noOp, 20))).toMatchObject({ status: "no_op" });

  for (const [id, title] of [
    ["15", "Viewing portraits in natural light"],
    ["16", "Ancient forests and their acoustics"],
    ["17", "Tracking meteor showers over decades"],
  ]) {
    const owner = scheduled(id);
    const candidateId = `new-release-${id}`;
    seedCandidate(candidateId, title);
    const preview = api.createAutoPublicationPreview(owner, 20);
    expect(preview.rolloutStage).toEqual({ stage: "limited", cap: 5 });
    expect(await confirm(owner, preview)).toMatchObject({ status: "published", addedIds: [candidateId] });
  }
  const replay = scheduled("17", 2);
  seedCandidate("retry-candidate", "Exploring the chemistry of botanical pigments");
  const recovered = api.createAutoPublicationPreview(replay, 20);
  expect(recovered.recovery).toMatchObject({ status: "verified", release: { revision: scheduled("17").revision } });
  expect(await confirm(replay, recovered)).toEqual(recovered.recovery!.release);
  expect(ids()).not.toContain("retry-candidate");
  expect(stage("18")).toEqual({ stage: "full", cap: 20 });
});

test("preview keeps a complete reviewed snapshot, rejects duplicate candidates, and records decisions before installing", async () => {
  const owner = actor();
  const old = manualEntry();
  installRuntimeCatalogue({ entries: [old] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  seedCandidate("duplicate-runtime", "Why old tram lines still matter", `https://${old.domain}/second`);
  seedCandidate("duplicate-bundle", "A closer look at planetary weather", "https://earth.nullschool.net/other");
  seedCandidate("duplicate-batch", "A field guide to chromatic memory", "https://chromatic-memory.example/other");
  const preview = (await publisher()).createAutoPublicationPreview(owner, 20);
  expect(preview.expectedRevision).toBe(manualRevision);
  expect(preview.currentSnapshot.entries).toEqual([old]);
  expect(preview.proposedSnapshot.entries.map(entry => entry.id)).toEqual(["reviewed-archive", "chromatic-memory"]);
  expect(preview.decisions.rejected).toEqual(expect.arrayContaining([
    expect.objectContaining({ candidateId: "duplicate-runtime", reasons: expect.arrayContaining(["duplicate_domain"]) }),
    expect.objectContaining({ candidateId: "duplicate-bundle", reasons: expect.arrayContaining(["duplicate_domain"]) }),
  ]));
  expect(preview.decisions.deferred).toEqual([
    expect.objectContaining({ reason: "batch_duplicate", decision: expect.objectContaining({ candidateId: "duplicate-batch" }) }),
  ]);
  expect(ids()).toEqual(["reviewed-archive"]);
  closeOpsDbForTests();
  const committed = await confirm(owner, preview);
  expect(committed).toMatchObject({ status: "published", revision: owner.revision, entryCount: 2, addedIds: ["chromatic-memory"] });
  expect(readRuntimeCatalogue().entries).toEqual(preview.proposedSnapshot.entries);
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = ?").get("chromatic-memory")?.status)
    .toBe("reviewed_exportable");
});

test("the same run can replay a preview and commit across fresh tokens without another snapshot", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const refreshed = { ...owner, issuedAt: owner.issuedAt + 1 };
  expect(api.createAutoPublicationPreview(refreshed, 5)).toEqual(preview);
  expect(() => api.createAutoPublicationPreview(refreshed, 20)).toThrow();
  const first = await confirm(owner, preview);
  expect(await confirm(refreshed, preview)).toEqual(first);
  expect(snapshotCount()).toBe(1);
  expect(openOpsDb().prepare("SELECT COUNT(*) AS count FROM review_history WHERE entity_id = ?").get("chromatic-memory")?.count).toBe(1);
});

test("foreign proposals, caller revision changes, caller hash changes, and modified stored payloads cannot install", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(owner, 20);
  await expect(confirm(actor("432"), preview)).rejects.toThrow();
  await expect(confirm(owner, { ...preview, expectedRevision: manualRevision })).rejects.toThrow();
  await expect(confirm(owner, { ...preview, contentHash: "0".repeat(64) })).rejects.toThrow();
  openOpsDb().prepare("UPDATE auto_publication_proposals SET proposed_snapshot_json = ? WHERE proposal_id = ?")
    .run(JSON.stringify({ entries: [manualEntry("forged")] }), preview.proposalId);
  await expect(confirm(owner, preview)).rejects.toThrow();
  expect(snapshotCount()).toBe(0);
});

test("an unchanged snapshot cannot make a proposal from a different policy version publish", async () => {
  seedReading();
  const owner = actor();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  openOpsDb().prepare("UPDATE auto_publication_proposals SET policy_version = ? WHERE proposal_id = ?").run("old", preview.proposalId);
  await expect(confirm(owner, preview)).rejects.toThrow(/policy/i);
  expect(snapshotCount()).toBe(0);
});

test("two previews racing from one live revision install at most one snapshot", async () => {
  seedReading();
  const api = await publisher();
  const first = actor("431");
  const second = actor("432", first.issuedAt + 1);
  const [a, b] = [first, second].map(owner => api.createAutoPublicationPreview(owner, 5));
  const results = await Promise.allSettled([confirm(first, a), confirm(second, b)]);
  expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(snapshotCount()).toBe(1);
  expect(ids()).toEqual(["chromatic-memory"]);
});

test("newer manual snapshots invalidate outstanding previews even when the auto run fetches a fresh token", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(owner, 5);
  installRuntimeCatalogue({ entries: [manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt + 1 });
  await expect(confirm({ ...owner, issuedAt: owner.issuedAt + 2 }, preview)).rejects.toThrow(/stale/i);
  expect(readRuntimeCatalogue().revision).toBe(manualRevision);
  expect(ids()).toEqual(["reviewed-archive"]);
  expect(snapshotCount()).toBe(1);
});

test("commit fails closed if newer evidence or quarantine invalidates the selected additions", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  const preview = api.createAutoPublicationPreview(owner, 5);
  addEvidence("https://chromatic-memory.example/", "50", "blank");
  await expect(confirm(owner, preview)).rejects.toThrow();
  expect(snapshotCount()).toBe(0);
});

test("a candidate-free release is recorded as a successful no-op without changing live revision", async () => {
  const owner = actor();
  installRuntimeCatalogue({ entries: [manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(preview.additions).toEqual([]);
  expect(await confirm(owner, preview)).toMatchObject({ status: "no_op", revision: manualRevision, entryCount: 1, addedIds: [] });
  expect(snapshotCount()).toBe(1);
  expect(readRuntimeCatalogue().revision).toBe(manualRevision);
});

test("publication prunes already quarantined entries without reviving them and audits the removal", async () => {
  const owner = actor();
  installRuntimeCatalogue({ entries: [manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'quarantined' WHERE id = ?").run("reviewed-archive");
  seedReading();
  const preview = (await publisher()).createAutoPublicationPreview(owner, 5);
  expect(preview.removals.map(entry => entry.id)).toEqual(["reviewed-archive"]);
  expect(await confirm(owner, preview)).toMatchObject({ removedIds: ["reviewed-archive"], entryCount: 1 });
  expect(ids()).toEqual(["chromatic-memory"]);
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = ?").get("reviewed-archive")?.status).toBe("quarantined");
});

test("selective proof rollback removes only failed fresh IDs, retains subsequent additions, and records both revision links", async () => {
  const owner = actor();
  const api = await publisher();
  installRuntimeCatalogue({ entries: [manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  const later = actor("432", owner.issuedAt + 2);
  seedCandidate("ink-composition", "Pigments and the chemistry of ink");
  await confirm(later, api.createAutoPublicationPreview(later, 5));
  expect(() => api.rollbackFreshAdditions(later, owner.revision, ["chromatic-memory"])).toThrow();
  expect(() => api.rollbackFreshAdditions(owner, owner.revision, ["reviewed-archive"])).toThrow();
  expect(() => api.rollbackFreshAdditions(owner, owner.revision, ["ink-composition"])).toThrow();
  const rolledBack = api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"]);
  expect(rolledBack).toMatchObject({ removedIds: ["chromatic-memory"], entryCount: 3 });
  expect(ids()).toEqual(["reviewed-archive", "forest-acoustics", "ink-composition"]);
  expect(readRuntimeCatalogue().revision).toBe(rolledBack.revision);
  expect(api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"])).toEqual(rolledBack);
  expect(openOpsDb().prepare("SELECT * FROM auto_publication_audit WHERE revision = ?").get(rolledBack.revision)).toMatchObject({
    prior_revision: later.revision, release_revision: owner.revision, operation: "rollback",
  });
});

test.each(["rejected", "expired"])("historical rollback cannot retain an unconfirmed addition when readback is %s", async outcome => {
  const api = await publisher();
  const older = actor();
  seedReading();
  await confirm(older, api.createAutoPublicationPreview(older, 5));
  expect(ids()).toEqual(["chromatic-memory"]);

  const newer = actor("432", older.issuedAt + 2);
  seedCandidate("ink-composition", "Pigments and the chemistry of ink");
  const preview = api.createAutoPublicationPreview(newer, 5);
  const release = api.commitAutoPublicationPreview(newer, preview.proposalId, preview.expectedRevision, preview.contentHash);
  api.completeAutoPublicationProof(newer, release.revision!, "verified");
  expect(readRuntimeCatalogue().revision).toBe(newer.revision);
  expect(ids()).toEqual(["chromatic-memory", "ink-composition"]);
  expect(() => api.rollbackFreshAdditions(older, older.revision, ["chromatic-memory"])).toThrow(/awaiting public verification/i);
  expect(snapshotCount()).toBe(2);

  if (outcome === "rejected") api.completeAutoPublicationPublicCheck(newer, newer.revision, "failed");
  else openOpsDb().prepare("UPDATE auto_publication_proposals SET public_check_deadline = unixepoch() - 1 WHERE proposal_id = ?").run(preview.proposalId);
  expect(readRuntimeCatalogue().revision).toBe(older.revision);
  expect(ids()).toEqual(["chromatic-memory"]);
  expect(api.rollbackFreshAdditions(older, older.revision, ["chromatic-memory"]).entryCount).toBe(0);
  expect(ids()).toEqual([]);
});

test("rollback cannot undo an intervening explicit manual review", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  const [entry] = readRuntimeCatalogue().entries;
  installRuntimeCatalogue({ entries: [entry, manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt + 10 });
  expect(() => api.rollbackFreshAdditions({ ...owner, issuedAt: owner.issuedAt + 20 }, owner.revision, ["chromatic-memory"])).toThrow();
  expect(ids()).toEqual(["chromatic-memory", "reviewed-archive"]);
  expect(readRuntimeCatalogue().revision).toBe(manualRevision);
});

test("rollback satisfies already absent audited IDs and retries against the original request", async () => {
  const owner = actor();
  const api = await publisher();
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'quarantined' WHERE id = ?").run("forest-acoustics");
  const later = actor("432", owner.issuedAt + 2);
  seedCandidate("ink-composition", "Pigments and the chemistry of ink");
  expect(await confirm(later, api.createAutoPublicationPreview(later, 5))).toMatchObject({ removedIds: ["forest-acoustics"] });

  const failedIds = ["forest-acoustics", "chromatic-memory"];
  const rolledBack = api.rollbackFreshAdditions(owner, owner.revision, failedIds);
  expect(rolledBack).toMatchObject({ removedIds: ["chromatic-memory"], entryCount: 1 });
  expect(ids()).toEqual(["ink-composition"]);
  expect(api.rollbackFreshAdditions(owner, owner.revision, [...failedIds].reverse())).toEqual(rolledBack);
  expect(() => api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"])).toThrow();
  const audit = openOpsDb().prepare("SELECT requested_ids_json, removals_json FROM auto_publication_audit WHERE revision = ?").get(rolledBack.revision);
  expect(JSON.parse(String(audit?.requested_ids_json))).toEqual(["chromatic-memory", "forest-acoustics"]);
  expect(JSON.parse(String(audit?.removals_json))).toEqual(["chromatic-memory"]);
  expect(snapshotCount()).toBe(3);
});

test("rollback succeeds with zero removals when all requested fresh IDs are already absent", async () => {
  const owner = actor();
  const api = await publisher();
  seedReading();
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'quarantined' WHERE id = ?").run("chromatic-memory");
  const later = actor("432", owner.issuedAt + 2);
  seedCandidate("ink-composition", "Pigments and the chemistry of ink");
  await confirm(later, api.createAutoPublicationPreview(later, 5));

  const result = api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"]);
  expect(result.removedIds).toEqual([]);
  expect(ids()).toEqual(["ink-composition"]);
  expect(api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"])).toEqual(result);
});

test("rollback preserves a present entry whose audited identity changed", async () => {
  const owner = actor();
  const api = await publisher();
  seedReading();
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  const later = actor("432", owner.issuedAt + 2);
  seedCandidate("ink-composition", "Pigments and the chemistry of ink");
  await confirm(later, api.createAutoPublicationPreview(later, 5));
  openOpsDb().prepare(`UPDATE runtime_catalogue_snapshots
    SET payload_json = json_set(payload_json, '$.entries[0].title', 'Replaced title')
    WHERE revision = ?`).run(later.revision);
  expect(() => api.rollbackFreshAdditions(owner, owner.revision, ["chromatic-memory"])).toThrow(/changed/);
  expect(ids()).toEqual(["chromatic-memory", "ink-composition"]);
  expect(snapshotCount()).toBe(2);
});

let testKeys: ReturnType<typeof createLocalJWKSet>;
vi.mock("jose", async (importOriginal) => {
  const jose = await importOriginal<typeof import("jose")>();
  return { ...jose, createRemoteJWKSet: () => (...args: Parameters<ReturnType<typeof createLocalJWKSet>>) => testKeys(...args) };
});

test("auto routes isolate authorities, enforce JSON bounds, and reject caller-supplied snapshots", async () => {
  const [{ POST: preview }, { POST: commit }, { POST: rollback }, { POST: proof }, { POST: ingest }, { POST: collect }] = await Promise.all([
    import("@/app/api/catalogue/auto/preview/route"), import("@/app/api/catalogue/auto/commit/route"),
    import("@/app/api/catalogue/auto/rollback/route"), import("@/app/api/catalogue/auto/proof/route"),
    import("@/app/api/catalogue/ingest/route"),
    import("@/app/api/catalogue/candidates/route"),
  ]);
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  testKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  const token = async (workflow: string, audience: string) => new SignJWT({
    repository_id: "1450399070", repository: "conficked/stumblr", ref: "refs/heads/main",
    workflow_ref: `conficked/stumblr/.github/workflows/${workflow}.yml@refs/heads/main`,
    event_name: "workflow_dispatch", sha, run_id: "431", run_attempt: "1",
  }).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://token.actions.githubusercontent.com")
    .setAudience(`https://stumblr.dev/${audience}`).setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(privateKey);
  const auto = await token("catalogue-auto-publish", "catalogue-auto-publish");
  const manual = await token("catalogue-publish", "catalogue-ingest");
  const collector = await token("discovery-manual-review", "catalogue-collect");
  const post = (key: string, body: unknown, contentType = "application/json") => new Request("https://stumblr.dev/api/catalogue", {
    method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": contentType },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  for (const route of [preview, commit, rollback, proof]) {
    for (const key of [manual, collector]) {
      const denied = await route(post(key, {}));
      expect(denied.status).toBe(401);
      expect(denied.headers.get("cache-control")).toBe("no-store");
    }
    expect((await route(post(auto, "{}", "application/json-seq"))).status).toBe(415);
    expect((await route(post(auto, "{}".padEnd(100_000)))).status).toBe(413);
  }
  expect((await ingest(post(auto, {}))).status).toBe(401);
  expect((await collect(post(auto, []))).status).toBe(401);
  expect((await preview(post(auto, { requestedCap: 21 }))).status).toBe(400);
  seedReading();
  const made = await preview(post(auto, { requestedCap: 5 }));
  expect(made.status).toBe(200);
  expect(made.headers.get("cache-control")).toBe("no-store");
  const { proposalId, expectedRevision, contentHash } = await made.json();
  const commitBody = { proposalId, expectedRevision, contentHash };
  expect((await commit(post(auto, { ...commitBody, entries: [manualEntry()] }))).status).toBe(400);
  expect((await commit(post(auto, commitBody))).status).toBe(200);
  expect(ids()).toEqual([]);
  const proofView = await proof(post(auto, { action: "read", releaseRevision: actor().revision }));
  expect(await proofView.json()).toMatchObject({
    ok: true, status: "pending", contentSecurityPolicy: expect.stringContaining("https://chromatic-memory.example"),
  });
  const rollbackBody = { releaseRevision: actor().revision, failedIds: ["chromatic-memory"] };
  expect((await rollback(post(auto, { ...rollbackBody, entries: [manualEntry()] }))).status).toBe(400);
  expect((await rollback(post(auto, rollbackBody))).status).toBe(200);
  expect(ids()).toEqual([]);
});

test("a fresh proof token does not make an already issued manual publication stale", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  const proofToken = { ...owner, issuedAt: owner.issuedAt + 10 };
  api.rollbackFreshAdditions(proofToken, owner.revision, ["chromatic-memory"]);
  installRuntimeCatalogue({ entries: [manualEntry()] }, { revision: manualRevision, issuedAt: owner.issuedAt + 5 });
  expect(readRuntimeCatalogue().revision).toBe(manualRevision);
  expect(ids()).toEqual(["reviewed-archive"]);
});

function runtimePair(run: number, denied = false): RuntimeObservationPair {
  const row: Omit<RuntimeObservationPair["desktop"], "device"> = {
    render_result: denied ? "frame_denied" : "text_observed",
    functionality_result: "not_demonstrated", document_http_status: 200,
    frame_failure_reasons: denied ? ["browser enforced destination frame policy"] : [], network_failure_reasons: [],
  };
  return {
    run_id: String(run), run_attempt: 1, qualifier_version: "browser-qualification-v4",
    desktop: { device: "desktop", ...row }, mobile: { device: "mobile", ...row },
  };
}

test("an auto-published entry accepts its first runtime health observation after settlement", async () => {
  seedReading();
  const owner = actor();
  const api = await publisher();
  await confirm(owner, api.createAutoPublicationPreview(owner, 5));
  expect(getConfirmedRuntimeHealthTargets().map(target => target.id)).toEqual(["chromatic-memory"]);
  expect(applyRuntimeHealthEvidence("chromatic-memory", runtimePair(999)).state).toBe("healthy");
});

test.each([false, true])("public preview, proof and readback agree while established entries remain hidden (release=%s)", async publish => {
  const owner = actor();
  const api = await publisher();
  const entries = [manualEntry("quarantined"), manualEntry("recovering"), manualEntry("visible")];
  installRuntimeCatalogue({ entries }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  applyRuntimeHealthEvidence("quarantined", runtimePair(500, true));
  applyRuntimeHealthEvidence("recovering", runtimePair(500, true));
  applyRuntimeHealthEvidence("recovering", runtimePair(501));
  if (publish) seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const expectedIds = publish ? ["visible", "chromatic-memory"] : ["visible"];
  expect(preview.currentSnapshot.entries.map(entry => entry.id)).toEqual(["visible"]);
  expect(preview.proposedSnapshot.entries.map(entry => entry.id)).toEqual(expectedIds);
  expect(preview.removals.map(entry => entry.id)).toEqual(["quarantined", "recovering"]);
  const result = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  expect(result.entryCount).toBe(expectedIds.length);
  if (publish) {
    const proof = api.getAutoPublicationProof(owner, result.revision!);
    expect(proof.entries.map(entry => entry.id)).toEqual(expectedIds);
    expect(proof.entryCount).toBe(expectedIds.length);
    api.completeAutoPublicationProof(owner, result.revision!, "verified");
    expect(ids()).toEqual(expectedIds);
    api.completeAutoPublicationPublicCheck(owner, result.revision!, "confirmed");
  } else {
    expect(result).toMatchObject({ status: "no_op", revision: manualRevision });
  }
  expect(ids()).toEqual(expectedIds);
  expect(getConfirmedRuntimeHealthTargets(24, false).map(target => target.id)).toContain("recovering");
  expect(applyRuntimeHealthEvidence("recovering", runtimePair(502)).state).toBe("restored");
  expect(ids()).toEqual(["recovering", ...expectedIds]);
});

test("selective rollback can remove a proven failure already quarantined by the collector while retaining hidden recovery entries", async () => {
  const owner = actor();
  const api = await publisher();
  installRuntimeCatalogue({ entries: [manualEntry("recovering")] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  applyRuntimeHealthEvidence("recovering", runtimePair(500, true));
  applyRuntimeHealthEvidence("recovering", runtimePair(501));
  seedReading();
  seedCandidate("forest-acoustics", "Listening to the acoustics of forests");
  const preview = api.createAutoPublicationPreview(owner, 5);
  const result = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  openOpsDb().prepare("UPDATE discovery_candidates SET status = 'quarantined' WHERE id = 'chromatic-memory'").run();
  const rollback = api.rollbackFreshAdditions(owner, result.revision!, ["chromatic-memory"]);
  expect(rollback).toMatchObject({ entryCount: 1, removedIds: ["chromatic-memory"] });
  expect(api.completeAutoPublicationPublicCheck(owner, result.revision!, "confirmed")).toMatchObject({ publicCheck: "confirmed" });
  expect(ids()).toEqual(["forest-acoustics"]);
  expect(applyRuntimeHealthEvidence("recovering", runtimePair(502)).state).toBe("restored");
  expect(ids()).toEqual(["recovering", "forest-acoustics"]);
});

test("public settlement rejects a modified staged durable entry even when it is hidden", async () => {
  const owner = actor();
  const api = await publisher();
  installRuntimeCatalogue({ entries: [manualEntry("recovering")] }, { revision: manualRevision, issuedAt: owner.issuedAt - 10 });
  applyRuntimeHealthEvidence("recovering", runtimePair(500, true));
  seedReading();
  const preview = api.createAutoPublicationPreview(owner, 5);
  const result = api.commitAutoPublicationPreview(owner, preview.proposalId, preview.expectedRevision, preview.contentHash);
  api.completeAutoPublicationProof(owner, result.revision!, "verified");
  openOpsDb().prepare(`UPDATE runtime_catalogue_snapshots
    SET payload_json = json_set(payload_json, '$.entries[0].title', 'Replaced hidden title')
    WHERE revision = ?`).run(result.revision!);
  expect(() => api.completeAutoPublicationPublicCheck(owner, result.revision!, "confirmed")).toThrow(/changed/i);
  api.completeAutoPublicationPublicCheck(owner, result.revision!, "failed");
  expect(readRuntimeCatalogue()).toEqual({ revision: manualRevision, entries: [] });
});

test("scheduled preview retries spend the raw evidence retention budget only once per run", async () => {
  const api = await publisher();
  const owner = { ...actor(), event: "schedule" as const };
  seedReading();
  const db = openOpsDb();
  const insert = db.prepare("INSERT INTO runtime_http_evidence VALUES ('chromatic-memory', ?, 1, ?, 200, '{}')");
  for (let run = 1; run <= 505; run++) insert.run(String(run), "2025-01-01T00:00:00.000Z");
  const first = api.createAutoPublicationPreview(owner, 5);
  expect(first.retention).toMatchObject({ eligible: 504, deleted: 500, remaining: 4 });
  const repeated = api.createAutoPublicationPreview(owner, 5);
  expect(repeated.retention).toEqual(first.retention);
  const retried = api.createAutoPublicationPreview({ ...owner, runAttempt: 2, revision: owner.revision.replace(/:1$/, ":2") }, 5);
  expect(retried.retention).toEqual(first.retention);
  expect(db.prepare("SELECT count(*) AS count FROM runtime_http_evidence").get()?.count).toBe(5);
});
