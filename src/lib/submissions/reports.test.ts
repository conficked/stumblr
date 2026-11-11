/** @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { catalogueEntries } from "@/lib/catalogue/entries";
import { getConfirmedRuntimeHealthTargets, installRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";
import { __resetReportRateLimitForTests, markReportsRechecked, pendingBrokenReportUrls, processReport } from "./reports";

const runtimeEntry = (id: string, canonicalUrl: string) => ({
  id, title: id, canonicalUrl, domain: new URL(canonicalUrl).hostname,
  topics: ["archives"], description: "", status: "evaluation_only" as const, policyBasis: null,
  provenance: { sourceNote: "fixture", reviewer: "reviewer", reviewedAt: "2026-01-01T00:00:00.000Z" },
  embedEvidence: { observedHeaders: "", observedRenderResult: "rendered" as const, observedAt: "2026-01-01T00:00:00.000Z", device: "desktop" as const },
});

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "stumblr-reports-"));
  vi.stubEnv("STUMBLR_DB_PATH", join(directory, "ops.sqlite"));
  __resetReportRateLimitForTests();
});

afterEach(() => {
  closeOpsDbForTests();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

test("stores a report for a catalogue entry with its canonical URL and a hashed submitter", () => {
  const entry = catalogueEntries[0];
  expect(processReport({ entryId: entry.id, type: "broken", note: "  blank   page " }, "1.2.3.4|ua")).toMatchObject({ ok: true, status: 201 });
  const row = openOpsDb().prepare("SELECT * FROM community_reports").get();
  expect(row).toMatchObject({ entry_id: entry.id, canonical_url: entry.canonicalUrl, kind: "broken", note: "blank page", rechecked_at: null });
  expect(String(row?.submitter_hash)).not.toContain("1.2.3.4");
});

test("rejects invalid types, unknown entries, and floods", () => {
  const entry = catalogueEntries[0];
  expect(processReport({ entryId: entry.id, type: "spam" }, "t")).toMatchObject({ ok: false, status: 400 });
  expect(processReport({ entryId: "no-such-entry", type: "broken" }, "t")).toMatchObject({ ok: false, status: 404 });
  for (let index = 0; index < 12; index += 1) expect(processReport({ entryId: entry.id, type: "report" }, "flood").ok).toBe(true);
  expect(processReport({ entryId: entry.id, type: "report" }, "flood")).toMatchObject({ ok: false, status: 429, code: "rate_limited" });
  expect(processReport({ entryId: entry.id, type: "report" }, "someone-else").ok).toBe(true);
});

test("broken reports move a runtime entry to the front of health targets until picked up", () => {
  const entries = Array.from({ length: 30 }, (_, index) => runtimeEntry(`entry-${index}`, `https://site${index}.example/`));
  const db = openOpsDb();
  const candidate = db.prepare(`INSERT INTO discovery_candidates (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at)
    VALUES (?, ?, ?, 'fixture', 'fixture', 'https://source.example/', '2026-01-01', 'pending_review', '2026-01-01')`);
  const health = db.prepare(`INSERT INTO runtime_health_state (candidate_id, state, reason_code, failure_streak, recovery_streak, updated_at)
    VALUES (?, 'healthy', 'healthy', 0, 0, '2026-01-01')`);
  for (const entry of entries) {
    candidate.run(entry.id, entry.canonicalUrl, entry.domain);
    health.run(entry.id);
  }
  installRuntimeCatalogue({ entries }, { revision: "reports-test", issuedAt: 1 });

  const reported = entries[29];
  expect(getConfirmedRuntimeHealthTargets(24, false).map(target => target.id)).not.toContain(reported.id);
  processReport({ entryId: reported.id, type: "broken" }, "t");
  processReport({ entryId: entries[28].id, type: "report", note: "not broken, just odd" }, "t");
  expect(pendingBrokenReportUrls()).toEqual(new Set([reported.canonicalUrl]));
  expect(getConfirmedRuntimeHealthTargets(24, false, pendingBrokenReportUrls())[0]).toEqual({ id: reported.id, canonicalUrl: reported.canonicalUrl });

  markReportsRechecked([reported.canonicalUrl]);
  expect(pendingBrokenReportUrls().size).toBe(0);
});
