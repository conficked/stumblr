import crypto from "node:crypto";
import { openOpsDb, OpsDb } from "./client";

export type DiscoveryCandidateInput = {
  id?: string;
  canonicalUrl: string;
  domain: string;
  sourceId: string;
  sourceFamily: string;
  sourceUrl: string;
  discoveredAt?: string;
  status?: string;
  topicHint?: string | null;
  topics?: string[];
  linkText?: string | null;
  screen?: Record<string, unknown> | null;
  provenance?: Record<string, unknown>;
};

export type UpsertCandidateResult =
  | { kind: "inserted"; id: string }
  | { kind: "existing"; id: string };

function nowIso() {
  return new Date().toISOString();
}

function makeCandidateId(canonicalUrl: string, domain: string): string {
  const digest = crypto.createHash("sha1").update(canonicalUrl).digest("hex").slice(0, 12);
  return `${domain.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${digest}`;
}

export function upsertCandidate(
  input: DiscoveryCandidateInput,
  db?: OpsDb,
): UpsertCandidateResult {
  const conn = db ?? openOpsDb();
  const id = input.id ?? makeCandidateId(input.canonicalUrl, input.domain);
  const discoveredAt = input.discoveredAt ?? nowIso();
  const updatedAt = nowIso();
  const status = input.status ?? "discovered";

  const existing = conn
    .prepare("SELECT id FROM discovery_candidates WHERE canonical_url = ? LIMIT 1")
    .get(input.canonicalUrl) as { id: string } | undefined;
  if (existing) {
    conn
      .prepare(
        `UPDATE discovery_candidates SET
          source_id = ?, source_family = ?, source_url = ?, status = ?,
          topic_hint = ?, topics_json = ?, link_text = ?,
          screen_json = COALESCE(?, screen_json),
          provenance_json = ?, updated_at = ?
         WHERE canonical_url = ?`,
      )
      .run(
        input.sourceId,
        input.sourceFamily,
        input.sourceUrl,
        status,
        input.topicHint ?? null,
        JSON.stringify(input.topics ?? []),
        input.linkText ?? null,
        input.screen ? JSON.stringify(input.screen) : null,
        JSON.stringify(input.provenance ?? {}),
        updatedAt,
        input.canonicalUrl,
      );
    return { kind: "existing", id: existing.id };
  }

  try {
    conn
      .prepare(
        `INSERT INTO discovery_candidates (
          id, canonical_url, domain, source_id, source_family, source_url,
          discovered_at, status, topic_hint, topics_json, link_text, screen_json, provenance_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.canonicalUrl,
        input.domain,
        input.sourceId,
        input.sourceFamily,
        input.sourceUrl,
        discoveredAt,
        status,
        input.topicHint ?? null,
        JSON.stringify(input.topics ?? []),
        input.linkText ?? null,
        input.screen ? JSON.stringify(input.screen) : null,
        JSON.stringify(input.provenance ?? {}),
        updatedAt,
      );
    return { kind: "inserted", id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/UNIQUE/i.test(message)) throw error;
    const again = conn
      .prepare("SELECT id FROM discovery_candidates WHERE canonical_url = ? LIMIT 1")
      .get(input.canonicalUrl) as { id: string } | undefined;
    if (!again) throw error;
    return { kind: "existing", id: again.id };
  }
}

export function startDiscoveryRun(
  owner: string,
  leaseTtlSec = 300,
  db?: OpsDb,
): { runId: string; leaseUntil: string } {
  const conn = db ?? openOpsDb();
  const runId = `run-${crypto.randomBytes(8).toString("hex")}`;
  const startedAt = nowIso();
  const leaseUntil = new Date(Date.now() + leaseTtlSec * 1000).toISOString();
  conn
    .prepare(
      `INSERT INTO discovery_runs (id, started_at, status, checkpoint_json, stats_json, lease_owner, lease_until)
       VALUES (?, ?, 'running', '{}', '{}', ?, ?)`,
    )
    .run(runId, startedAt, owner, leaseUntil);
  appendRunEvent(runId, "started", { owner }, conn);
  return { runId, leaseUntil };
}

export function tryAcquireRunLease(
  runId: string,
  owner: string,
  leaseTtlSec = 300,
  db?: OpsDb,
): boolean {
  const conn = db ?? openOpsDb();
  const now = nowIso();
  const leaseUntil = new Date(Date.now() + leaseTtlSec * 1000).toISOString();
  const result = conn
    .prepare(
      `UPDATE discovery_runs
       SET lease_owner = ?, lease_until = ?
       WHERE id = ?
         AND status = 'running'
         AND (lease_owner IS NULL OR lease_owner = ? OR lease_until IS NULL OR lease_until < ?)`,
    )
    .run(owner, leaseUntil, runId, owner, now);
  return Number(result.changes ?? 0) === 1;
}

export function checkpointRun(
  runId: string,
  checkpoint: Record<string, unknown>,
  stats?: Record<string, unknown>,
  db?: OpsDb,
): void {
  const conn = db ?? openOpsDb();
  conn
    .prepare(
      `UPDATE discovery_runs SET checkpoint_json = ?, stats_json = COALESCE(?, stats_json) WHERE id = ?`,
    )
    .run(JSON.stringify(checkpoint), stats ? JSON.stringify(stats) : null, runId);
  appendRunEvent(runId, "checkpoint", checkpoint, conn);
}

export function finishDiscoveryRun(
  runId: string,
  status: "succeeded" | "failed" | "interrupted",
  stats?: Record<string, unknown>,
  error?: string | null,
  db?: OpsDb,
): void {
  const conn = db ?? openOpsDb();
  conn
    .prepare(
      `UPDATE discovery_runs
       SET status = ?, finished_at = ?, stats_json = COALESCE(?, stats_json), error = ?, lease_owner = NULL, lease_until = NULL
       WHERE id = ?`,
    )
    .run(status, nowIso(), stats ? JSON.stringify(stats) : null, error ?? null, runId);
  appendRunEvent(runId, "finished", { status, error: error ?? null }, conn);
}

export function appendRunEvent(
  runId: string,
  kind: string,
  payload: Record<string, unknown>,
  db?: OpsDb,
): void {
  const conn = db ?? openOpsDb();
  conn
    .prepare(
      `INSERT INTO discovery_run_events (run_id, at, kind, payload_json) VALUES (?, ?, ?, ?)`,
    )
    .run(runId, nowIso(), kind, JSON.stringify(payload));
}

export function getRun(runId: string, db?: OpsDb) {
  const conn = db ?? openOpsDb();
  return conn.prepare("SELECT * FROM discovery_runs WHERE id = ?").get(runId) as
    | Record<string, unknown>
    | undefined;
}

export function countCandidates(db?: OpsDb): number {
  const conn = db ?? openOpsDb();
  const row = conn.prepare("SELECT COUNT(*) AS n FROM discovery_candidates").get() as {
    n: number;
  };
  return Number(row.n);
}
