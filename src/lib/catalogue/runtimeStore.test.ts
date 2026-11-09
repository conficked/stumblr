/** @vitest-environment node */
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { installRuntimeCatalogue, readRuntimeCatalogue } from "./runtimeStore";
import { getCatalogue } from ".";
let temp: string;
beforeEach(() => {
  temp = fs.mkdtempSync(path.join(os.tmpdir(), "stumblr-runtime-"));
  vi.stubEnv("STUMBLR_DB_PATH", path.join(temp, "runtime.sqlite"));
});
afterEach(() => {
  closeOpsDbForTests();
  fs.rmSync(temp, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
test("atomic reviewed snapshots survive restart and reject invalid or stale publications", () => {
  const entry = { ...getCatalogue({ includeEvaluation: true })[0], status: "evaluation_only", policyBasis: null, provenance: { sourceNote: "review fixture", reviewer: "test", reviewedAt: "2026-11-08T18:00:00Z" }, embedEvidence: { observedHeaders: "fixture", observedRenderResult: "rendered", observedAt: "2026-11-08T18:00:00Z", device: "desktop" } };
  installRuntimeCatalogue({ entries: [entry] }, { revision: "a".repeat(40), issuedAt: 10 });
  closeOpsDbForTests();
  expect(readRuntimeCatalogue().entries).toHaveLength(1);
  expect(() => installRuntimeCatalogue({ entries: [{ ...entry, status: "launch_approved" }] }, { revision: "b".repeat(40), issuedAt: 20 })).toThrow();
  expect(() => installRuntimeCatalogue({ entries: [entry] }, { revision: "b".repeat(40), issuedAt: 9 })).toThrow();
  expect(() => installRuntimeCatalogue({ entries: [] }, { revision: "a".repeat(40), issuedAt: 20 })).toThrow();
  installRuntimeCatalogue({ entries: [entry] }, { revision: "b".repeat(40), issuedAt: 30 });
  openOpsDb().prepare("UPDATE runtime_catalogue_snapshots SET payload_json = ? WHERE revision = ?").run("corrupt", "b".repeat(40));
  expect(readRuntimeCatalogue().revision).toBe("a".repeat(40));
});

test("manual publication wins when OIDC timestamps share a second", () => {
  const manualRevision = "b".repeat(40);
  const autoRevision = `${"a".repeat(40)}:431:1`;
  const db = openOpsDb();
  db.prepare("INSERT INTO runtime_catalogue_snapshots VALUES (?, 10, '{\"entries\":[]}', ?)").run(autoRevision, new Date().toISOString());
  installRuntimeCatalogue({ entries: [] }, { revision: manualRevision, issuedAt: 10 });
  expect(readRuntimeCatalogue().revision).toBe(manualRevision);
});

test("upgrade backfills runtime health for legacy published URLs whose manifest ID differs from the queue ID", () => {
  const db = openOpsDb();
  const url = "https://legacy.example/";
  db.prepare(`INSERT INTO discovery_candidates(id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at)
    VALUES('queue-id', ?, 'legacy.example', 'fixture', 'fixture', ?, '2026-01-01', 'reviewed_exportable', '2026-01-01')`).run(url, url);
  db.prepare("INSERT INTO runtime_catalogue_snapshots VALUES ('legacy-revision', 1, ?, '2026-01-01')").run(JSON.stringify({
    entries: [{ id: "legacy-manifest-id", canonicalUrl: url }],
  }));
  // Reopen this database as one that has applied the original migration 016 only.
  db.exec("DROP TABLE IF EXISTS runtime_health_transitions; ALTER TABLE auto_publication_proposals DROP COLUMN durable_content_hash; DELETE FROM schema_migrations WHERE name = '017_runtime_health_identity_and_audit.sql'");
  closeOpsDbForTests();
  expect(openOpsDb().prepare("SELECT candidate_id, state FROM runtime_health_state").all()).toEqual([
    { candidate_id: "queue-id", state: "healthy" },
  ]);
});
