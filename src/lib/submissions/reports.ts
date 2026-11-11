import crypto from "node:crypto";
import { openOpsDb } from "@/lib/db/client";
import { catalogueEntries } from "@/lib/catalogue/entries";
import { readRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";

const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX = 12;
const MAX_NOTE_LEN = 600;

const rateLimiter = new Map<string, number[]>();

export type ReportInput = { entryId?: unknown; type?: unknown; note?: unknown };

function checkRateLimit(submitterKey: string): number | null {
  const now = Date.now();
  const stamps = (rateLimiter.get(submitterKey) ?? []).filter((stamp) => now - stamp <= RATE_LIMIT_WINDOW_MS);
  if (stamps.length >= RATE_LIMIT_MAX) {
    rateLimiter.set(submitterKey, stamps);
    return Math.max(1, Math.ceil((RATE_LIMIT_WINDOW_MS - (now - stamps[0])) / 1000));
  }
  stamps.push(now);
  rateLimiter.set(submitterKey, stamps);
  return null;
}

export function processReport(input: ReportInput, submitterToken: string) {
  const kind = input.type === "broken" || input.type === "report" ? input.type : null;
  const entryId = typeof input.entryId === "string" ? input.entryId.trim() : "";
  if (!kind || !entryId || entryId.length > 200) {
    return { ok: false as const, status: 400, code: "invalid_report", message: "Report needs a site and a type." };
  }
  const entry = [...readRuntimeCatalogue().entries, ...catalogueEntries].find((item) => item.id === entryId);
  if (!entry) {
    return { ok: false as const, status: 404, code: "unknown_entry", message: "That site is no longer in the catalogue." };
  }
  const retryAfterSec = checkRateLimit(submitterToken);
  if (retryAfterSec !== null) {
    return {
      ok: false as const, status: 429, code: "rate_limited",
      message: "Too many reports from this client. Try again later.", retryAfterSec,
    };
  }
  const note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, MAX_NOTE_LEN) || null : null;
  const submitterHash = crypto.createHash("sha256").update(submitterToken).digest("hex").slice(0, 24);
  openOpsDb()
    .prepare(`INSERT INTO community_reports (entry_id, canonical_url, kind, note, submitter_hash, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?)`)
    .run(entry.id, entry.canonicalUrl, kind, note, submitterHash, new Date().toISOString());
  return { ok: true as const, status: 201, code: "received", message: "Thanks, report received." };
}

/** Canonical URLs with broken reports that no health run has picked up yet. */
export function pendingBrokenReportUrls(): Set<string> {
  const rows = openOpsDb()
    .prepare("SELECT DISTINCT canonical_url FROM community_reports WHERE kind = 'broken' AND rechecked_at IS NULL")
    .all();
  return new Set(rows.map((row) => String(row.canonical_url)));
}

export function markReportsRechecked(canonicalUrls: string[]) {
  if (!canonicalUrls.length) return;
  const update = openOpsDb().prepare(
    "UPDATE community_reports SET rechecked_at = ? WHERE kind = 'broken' AND rechecked_at IS NULL AND canonical_url = ?",
  );
  const now = new Date().toISOString();
  for (const url of canonicalUrls) update.run(now, url);
}

export function __resetReportRateLimitForTests() {
  rateLimiter.clear();
}
