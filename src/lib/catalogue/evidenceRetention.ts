import { openOpsDb, type OpsDb } from "@/lib/db/client";

const BATCH_SIZE = 500;
const latestOrder = "observed_at DESC, length(run_id) DESC, run_id DESC, run_attempt DESC";
const evidenceTables = [
  { table: "candidate_qualification_evidence", partition: "AND latest.device = evidence.device", tie: ", qualifier_version DESC" },
  { table: "runtime_health_observations", partition: "", tie: ", qualifier_version DESC" },
  { table: "runtime_http_evidence", partition: "", tie: "" },
];

export type RetentionResult = { eligible: number; deleted: number; remaining: number; cutoff: string };

/** Delete at most 500 superseded raw observations inside the caller's transaction. */
export function pruneEvidenceInTransaction(db: OpsDb, now: Date): RetentionResult {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid retention date");
  const cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let eligible = 0;
  let deleted = 0;
  for (const { table, partition, tie } of evidenceTables) {
    const superseded = `FROM ${table} AS evidence
      WHERE observed_at < ? AND evidence.rowid != (
        SELECT latest.rowid FROM ${table} AS latest
        WHERE latest.candidate_id = evidence.candidate_id ${partition}
        ORDER BY ${latestOrder}${tie}, rowid DESC LIMIT 1
      )`;
    eligible += Number(db.prepare(`SELECT COUNT(*) AS count ${superseded}`).get(cutoff)?.count ?? 0);
    if (deleted === BATCH_SIZE) continue;
    deleted += Number(db.prepare(`DELETE FROM ${table} WHERE rowid IN (
      SELECT evidence.rowid ${superseded} ORDER BY observed_at, rowid LIMIT ?
    )`).run(cutoff, BATCH_SIZE - deleted).changes);
  }
  return { eligible, deleted, remaining: eligible - deleted, cutoff };
}

export function pruneQualificationEvidence(now: Date): RetentionResult {
  const db = openOpsDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = pruneEvidenceInTransaction(db, now);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
