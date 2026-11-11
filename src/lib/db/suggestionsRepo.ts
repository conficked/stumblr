import { CommunitySuggestion } from "@/lib/submissions/types";
import { openOpsDb, OpsDb } from "./client";

export type SuggestionInsertResult =
  | { kind: "inserted"; suggestion: CommunitySuggestion }
  | { kind: "duplicate"; suggestion: CommunitySuggestion };

function rowToSuggestion(row: Record<string, unknown>): CommunitySuggestion {
  let topics: CommunitySuggestion["topics"] = [];
  try {
    const parsed = JSON.parse(String(row.topics_json ?? "[]"));
    if (Array.isArray(parsed)) topics = parsed as CommunitySuggestion["topics"];
  } catch {
    topics = [];
  }
  return {
    id: String(row.id),
    canonicalUrl: String(row.canonical_url),
    domain: String(row.domain),
    submittedAt: String(row.submitted_at),
    status: "pending_review",
    source: "community",
    title: row.title == null ? null : String(row.title),
    note: row.note == null ? null : String(row.note),
    topics,
    submitterHash: String(row.submitter_hash),
  };
}

export function listSuggestions(db?: OpsDb): CommunitySuggestion[] {
  const conn = db ?? openOpsDb();
  const rows = conn
    .prepare(
      "SELECT id, canonical_url, domain, submitted_at, status, source, title, note, topics_json, submitter_hash FROM community_suggestions ORDER BY submitted_at ASC",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToSuggestion);
}

export function findSuggestionByCanonicalUrl(
  canonicalUrl: string,
  db?: OpsDb,
): CommunitySuggestion | null {
  const conn = db ?? openOpsDb();
  const row = conn
    .prepare(
      "SELECT id, canonical_url, domain, submitted_at, status, source, title, note, topics_json, submitter_hash FROM community_suggestions WHERE canonical_url = ? LIMIT 1",
    )
    .get(canonicalUrl) as Record<string, unknown> | undefined;
  return row ? rowToSuggestion(row) : null;
}

export function findSuggestionByDomain(domain: string, db?: OpsDb): CommunitySuggestion | null {
  const conn = db ?? openOpsDb();
  const row = conn
    .prepare(
      "SELECT id, canonical_url, domain, submitted_at, status, source, title, note, topics_json, submitter_hash FROM community_suggestions WHERE domain = ? LIMIT 1",
    )
    .get(domain.toLowerCase()) as Record<string, unknown> | undefined;
  return row ? rowToSuggestion(row) : null;
}

export function insertSuggestion(
  suggestion: CommunitySuggestion,
  db?: OpsDb,
): SuggestionInsertResult {
  const conn = db ?? openOpsDb();
  const now = new Date().toISOString();
  try {
    conn
      .prepare(
        `INSERT INTO community_suggestions (
          id, canonical_url, domain, submitted_at, status, source, title, note, topics_json, submitter_hash, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        suggestion.id,
        suggestion.canonicalUrl,
        suggestion.domain,
        suggestion.submittedAt,
        suggestion.status,
        suggestion.source,
        suggestion.title,
        suggestion.note,
        JSON.stringify(suggestion.topics),
        suggestion.submitterHash,
        now,
      );
    return { kind: "inserted", suggestion };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/UNIQUE/i.test(message)) throw error;
    const existing =
      findSuggestionByCanonicalUrl(suggestion.canonicalUrl, conn) ??
      findSuggestionByDomain(suggestion.domain, conn);
    if (!existing) throw error;
    return { kind: "duplicate", suggestion: existing };
  }
}

/** Suggestions the collector has not screened yet. Notes and submitter hashes never leave the server. */
export function listUnqueuedSuggestions(limit = 12, db?: OpsDb): Array<{ canonical_url: string; topics: string[] }> {
  const conn = db ?? openOpsDb();
  const rows = conn
    .prepare(
      `SELECT suggestion.canonical_url, suggestion.topics_json FROM community_suggestions AS suggestion
       WHERE NOT EXISTS (SELECT 1 FROM discovery_candidates AS candidate
         WHERE candidate.canonical_url = suggestion.canonical_url OR candidate.domain = suggestion.domain)
       ORDER BY suggestion.submitted_at, suggestion.id LIMIT ?`,
    )
    .all(limit) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let topics: unknown = [];
    try {
      topics = JSON.parse(String(row.topics_json ?? "[]"));
    } catch {
      topics = [];
    }
    return {
      canonical_url: String(row.canonical_url),
      topics: Array.isArray(topics) ? topics.filter((topic): topic is string => typeof topic === "string") : [],
    };
  });
}
