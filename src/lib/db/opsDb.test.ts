/** @vitest-environment node */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { closeOpsDbForTests, migrateOpsDb, openOpsDb } from "./client";
import {
  checkpointRun,
  countCandidates,
  finishDiscoveryRun,
  getRun,
  startDiscoveryRun,
  tryAcquireRunLease,
  upsertCandidate,
} from "./discoveryRepo";
import { findSuggestionByCanonicalUrl, insertSuggestion, listSuggestions } from "./suggestionsRepo";

describe("ops sqlite durability (local proof)", () => {
  let tmpDir: string;
  let dbPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stumblr-ops-"));
    dbPath = path.join(tmpDir, "ops.sqlite");
    process.env.STUMBLR_DB_PATH = dbPath;
    closeOpsDbForTests();
  });

  afterEach(() => {
    closeOpsDbForTests();
    delete process.env.STUMBLR_DB_PATH;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("survives process reopen (restart persistence)", () => {
    const db1 = openOpsDb(dbPath);
    const inserted = insertSuggestion(
      {
        id: "example-org-aaaaaaaaaa",
        canonicalUrl: "https://example.org/restart",
        domain: "example.org",
        submittedAt: new Date().toISOString(),
        status: "pending_review",
        source: "community",
        title: "Restart",
        note: null,
        topics: ["culture"],
        submitterHash: "abc",
      },
      db1,
    );
    expect(inserted.kind).toBe("inserted");
    upsertCandidate(
      {
        canonicalUrl: "https://candidate.example.org/",
        domain: "candidate.example.org",
        sourceId: "webring-xxiivv",
        sourceFamily: "webring",
        sourceUrl: "https://webring.xxiivv.com/",
        status: "discovered",
      },
      db1,
    );

    closeOpsDbForTests();
    const db2 = openOpsDb(dbPath);
    expect(findSuggestionByCanonicalUrl("https://example.org/restart", db2)?.title).toBe("Restart");
    expect(listSuggestions(db2)).toHaveLength(1);
    expect(countCandidates(db2)).toBe(1); // Suggestions wait for the collector to screen them.
  });

  test("privacy upgrade erases exact legacy URLs from the main database and WAL while connections remain open", () => {
    const terminal = "https://archive.example/hidden?signature=wal-privacy-regression#fragment";
    const bytes = Buffer.from(terminal);
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      for (const file of fs.readdirSync("db/migrations").filter(file => file < "009").sort()) {
        legacy.exec(fs.readFileSync(path.join("db/migrations", file), "utf8"));
        legacy.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, 'fixture')").run(file);
      }
      legacy.prepare(`INSERT INTO discovery_candidates
        (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, link_text, screen_json, updated_at)
        VALUES ('legacy', 'https://archive.example/start', 'archive.example', 'fixture', 'fixture',
          'https://source.example/', 'fixture', 'pending_review', ?, ?, 'fixture')`)
        .run(`A guide to old archives ${terminal}`, JSON.stringify({ final_url: terminal }));
      legacy.exec("PRAGMA wal_checkpoint(TRUNCATE)");
      legacy.prepare("UPDATE discovery_candidates SET screen_json = ?").run(JSON.stringify({
        final_url: terminal, content_security_policy: `report-uri ${terminal}`,
      }));
      const oldEntry = { id: "legacy", title: `A guide to old archives ${terminal}`, provenance: { reviewer: "stumblr-auto-policy/2 run/41" } };
      const payload = JSON.stringify({ entries: [oldEntry] });
      legacy.prepare("INSERT INTO runtime_catalogue_snapshots VALUES ('old', 1, ?, 'fixture')").run(payload);
      legacy.prepare(`INSERT INTO auto_publication_proposals (
        proposal_id, actor_revision, actor_run_id, actor_run_attempt, actor_event, actor_issued_at, policy_version,
        requested_cap, content_hash, proposed_snapshot_json, decisions_json, counts_json, evidence_json, removals_json, status, created_at
      ) VALUES ('proposal', 'old', '41', 1, 'schedule', 1, '2', 5, 'original-hash', ?, ?, '{}', '{}', ?, 'pending', 'fixture')`)
        .run(payload, JSON.stringify({ admitted: [oldEntry], deferred: [{ decision: oldEntry, reason: "batch_cap" }], rejected: [] }), JSON.stringify([oldEntry]));
      expect(fs.readFileSync(dbPath).includes(bytes)).toBe(true);
      expect(fs.readFileSync(dbPath + "-wal").includes(bytes)).toBe(true);
      const upgraded = openOpsDb(dbPath);
      expect(upgraded.prepare("SELECT canonical_url, status FROM discovery_candidates").get()).toMatchObject({
        canonical_url: "https://archive.example/start", status: "pending_review",
      });
      const snapshot = upgraded.prepare("SELECT payload_json FROM runtime_catalogue_snapshots").get();
      expect(JSON.parse(String(snapshot?.payload_json)).entries[0]).toMatchObject({ id: "legacy", title: "Redacted discovery title" });
      const proposal = upgraded.prepare("SELECT decisions_json, proposed_snapshot_json, removals_json FROM auto_publication_proposals").get();
      expect(JSON.parse(String(proposal?.decisions_json))).toMatchObject({
        admitted: [{ id: "legacy", title: "Redacted discovery title" }],
        deferred: [{ decision: { id: "legacy", title: "Redacted discovery title" } }],
      });
      expect(JSON.parse(String(proposal?.removals_json))[0].title).toBe("Redacted discovery title");
      expect(JSON.parse(String(proposal?.proposed_snapshot_json)).entries[0].title).toBe("Redacted discovery title");
      expect(fs.readFileSync(dbPath).includes(bytes)).toBe(false);
      expect(fs.readFileSync(dbPath + "-wal").includes(bytes)).toBe(false);
    } finally {
      legacy.close();
    }
  });

  test("a reader blocking the privacy checkpoint leaves a durable retry marker", () => {
    const db = openOpsDb(dbPath);
    const reader = new DatabaseSync(dbPath);
    try {
      db.exec("PRAGMA busy_timeout = 0; INSERT INTO ops_privacy_scrub_pending VALUES (1)");
      reader.exec("BEGIN");
      expect(reader.prepare("SELECT id FROM ops_privacy_scrub_pending").get()?.id).toBe(1);
      expect(() => migrateOpsDb(db)).toThrow(/Privacy scrub WAL checkpoint/);
      expect(db.prepare("SELECT id FROM ops_privacy_scrub_pending").get()?.id).toBe(1);
      reader.exec("ROLLBACK");
      migrateOpsDb(db);
      expect(db.prepare("SELECT id FROM ops_privacy_scrub_pending").get()).toBeUndefined();
    } finally {
      reader.close();
    }
  });

  test("privacy upgrade removes reflected path suffixes from legacy rows and auto snapshots", () => {
    const suffix = "/private-path?token=fixture#fragment";
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      for (const file of fs.readdirSync("db/migrations").filter(file => file < "011").sort()) {
        legacy.exec(fs.readFileSync(path.join("db/migrations", file), "utf8"));
        legacy.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, 'fixture')").run(file);
      }
      legacy.prepare(`INSERT INTO discovery_candidates
        (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, link_text, screen_json, updated_at)
        VALUES ('legacy', 'https://archive.example/start', 'archive.example', 'fixture', 'fixture',
          'https://source.example/', 'fixture', 'pending_review', ?, '{}', 'fixture')`).run(`Archive guide [${suffix}]`);
      const entry = { id: "legacy", title: `Archive guide [${suffix}]`, provenance: { reviewer: "stumblr-auto-policy/3 run/41" } };
      const payload = JSON.stringify({ entries: [entry] });
      legacy.prepare("INSERT INTO runtime_catalogue_snapshots VALUES ('old', 1, ?, 'fixture')").run(payload);
      legacy.prepare(`INSERT INTO auto_publication_proposals (
        proposal_id, actor_revision, actor_run_id, actor_run_attempt, actor_event, actor_issued_at, policy_version,
        requested_cap, content_hash, proposed_snapshot_json, decisions_json, counts_json, evidence_json, removals_json, status, created_at
      ) VALUES ('proposal', 'old', '41', 1, 'schedule', 1, '3', 5, 'hash', ?, ?, '{}', '{}', ?, 'pending', 'fixture')`)
        .run(payload, JSON.stringify({ admitted: [entry], deferred: [{ decision: entry, reason: "batch_cap" }], rejected: [] }), JSON.stringify([entry]));
      const upgraded = openOpsDb(dbPath);
      for (const query of ["SELECT link_text FROM discovery_candidates", "SELECT * FROM auto_publication_proposals", "SELECT payload_json FROM runtime_catalogue_snapshots"]) {
        expect(JSON.stringify(upgraded.prepare(query).all())).not.toContain(suffix);
      }
      expect(fs.readFileSync(dbPath).includes(Buffer.from(suffix))).toBe(false);
      expect(fs.readFileSync(dbPath + "-wal").includes(Buffer.from(suffix))).toBe(false);
    } finally {
      legacy.close();
    }
  });

  test("privacy upgrade removes unrecognizable legacy redirect titles", () => {
    const secret = "fixture-private-fragment";
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      for (const file of fs.readdirSync("db/migrations").filter(file => file < "012").sort()) {
        legacy.exec(fs.readFileSync(path.join("db/migrations", file), "utf8"));
        legacy.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, 'fixture')").run(file);
      }
      legacy.prepare(`INSERT INTO discovery_candidates
        (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, link_text, screen_json, updated_at)
        VALUES ('legacy', 'https://archive.example/start', 'archive.example', 'fixture', 'fixture',
          'https://source.example/', 'fixture', 'pending_review', ?, '{}', 'fixture')`).run(`Archive guide (${secret})`);
      const entry = { id: "legacy", title: `Archive guide (${secret})`, provenance: { reviewer: "stumblr-auto-policy/4 run/41" } };
      const payload = JSON.stringify({ entries: [entry] });
      legacy.prepare("INSERT INTO runtime_catalogue_snapshots VALUES ('old', 1, ?, 'fixture')").run(payload);
      legacy.prepare(`INSERT INTO auto_publication_proposals (
        proposal_id, actor_revision, actor_run_id, actor_run_attempt, actor_event, actor_issued_at, policy_version,
        requested_cap, content_hash, proposed_snapshot_json, decisions_json, counts_json, evidence_json, removals_json, status, created_at
      ) VALUES ('proposal', 'old', '41', 1, 'schedule', 1, '4', 5, 'hash', ?, ?, '{}', '{}', ?, 'pending', 'fixture')`)
        .run(payload, JSON.stringify({ admitted: [entry], deferred: [{ decision: entry, reason: "batch_cap" }], rejected: [] }), JSON.stringify([entry]));
      const upgraded = openOpsDb(dbPath);
      for (const query of ["SELECT link_text FROM discovery_candidates", "SELECT * FROM auto_publication_proposals", "SELECT payload_json FROM runtime_catalogue_snapshots"]) {
        expect(JSON.stringify(upgraded.prepare(query).all())).not.toContain(secret);
      }
      expect(fs.readFileSync(dbPath).includes(Buffer.from(secret))).toBe(false);
      expect(fs.readFileSync(dbPath + "-wal").includes(Buffer.from(secret))).toBe(false);
    } finally { legacy.close(); }
  });

  test("privacy upgrade removes post-migration collector screen titles", () => {
    const secret = "fixture-private-query";
    const legacy = new DatabaseSync(dbPath);
    try {
      legacy.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0;");
      for (const file of fs.readdirSync("db/migrations").filter(file => file < "012").sort()) {
        legacy.exec(fs.readFileSync(path.join("db/migrations", file), "utf8"));
        legacy.prepare("INSERT INTO schema_migrations(name, applied_at) VALUES (?, 'fixture')").run(file);
      }
      legacy.prepare(`INSERT INTO discovery_candidates
        (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, link_text, screen_json, updated_at)
        VALUES ('legacy', 'https://archive.example/start', 'archive.example', 'fixture', 'fixture',
          'https://source.example/', 'fixture', 'pending_review', 'safe', ?, 'fixture')`)
        .run(JSON.stringify({ title_hint: `Archive guide (${secret})` }));
      const upgraded = openOpsDb(dbPath);
      expect(JSON.stringify(upgraded.prepare("SELECT screen_json FROM discovery_candidates").all())).not.toContain(secret);
      expect(fs.readFileSync(dbPath).includes(Buffer.from(secret))).toBe(false);
      expect(fs.readFileSync(dbPath + "-wal").includes(Buffer.from(secret))).toBe(false);
    } finally { legacy.close(); }
  });

  test("canonical URL uniqueness under overlapping inserts", () => {
    const db = openOpsDb(dbPath);
    const row = {
      id: "race-1",
      canonicalUrl: "https://race.example.org/item",
      domain: "race.example.org",
      submittedAt: new Date().toISOString(),
      status: "pending_review" as const,
      source: "community" as const,
      title: "A",
      note: null,
      topics: [] as [],
      submitterHash: "h1",
    };
    expect(insertSuggestion(row, db).kind).toBe("inserted");
    const second = insertSuggestion({ ...row, id: "race-2", title: "B", submitterHash: "h2" }, db);
    expect(second.kind).toBe("duplicate");
    expect(listSuggestions(db)).toHaveLength(1);

    const c1 = upsertCandidate(
      {
        canonicalUrl: "https://cand-race.example.org/",
        domain: "cand-race.example.org",
        sourceId: "a",
        sourceFamily: "webring",
        sourceUrl: "https://example.com/a",
      },
      db,
    );
    const c2 = upsertCandidate(
      {
        canonicalUrl: "https://cand-race.example.org/",
        domain: "cand-race.example.org",
        sourceId: "b",
        sourceFamily: "webring",
        sourceUrl: "https://example.com/b",
      },
      db,
    );
    expect(c1.kind).toBe("inserted");
    expect(c2.kind).toBe("existing");
    expect(c2.id).toBe(c1.id);
    expect(countCandidates(db)).toBe(1); // Only the discovered URL; suggestions wait for screening.
  });

  test("run lease prevents overlapping workers", () => {
    const db = openOpsDb(dbPath);
    const { runId } = startDiscoveryRun("worker-a", 120, db);
    expect(tryAcquireRunLease(runId, "worker-a", 120, db)).toBe(true);
    expect(tryAcquireRunLease(runId, "worker-b", 120, db)).toBe(false);
    checkpointRun(runId, { sourceIndex: 2 }, { accepted: 3 }, db);
    finishDiscoveryRun(runId, "succeeded", { accepted: 3 }, null, db);
    const run = getRun(runId, db);
    expect(run?.status).toBe("succeeded");
    expect(run?.lease_owner).toBeNull();
  });
});
