import { findSuggestionByCanonicalUrl, findSuggestionByDomain, insertSuggestion, listSuggestions } from "@/lib/db/suggestionsRepo";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { CommunitySuggestion, SuggestionStore } from "./types";

const DEFAULT_STORE: SuggestionStore = { version: 1, suggestions: [] };

/** @deprecated JSON path retained only for migration/tests naming; primary store is SQLite. */
export function suggestionDbConfigured(): boolean {
  return Boolean(process.env.STUMBLR_DB_PATH) || true;
}

export async function readSuggestionStore(): Promise<SuggestionStore> {
  openOpsDb();
  return {
    version: 1,
    suggestions: listSuggestions(),
  };
}

export async function writeSuggestionStore(store: SuggestionStore): Promise<void> {
  // No-op: mutations go through insertCommunitySuggestion for race-safe UNIQUE handling.
  void store;
}

export function findPendingByCanonicalOrDomain(
  canonicalUrl: string,
  domain: string,
): CommunitySuggestion | null {
  openOpsDb();
  return findSuggestionByCanonicalUrl(canonicalUrl) ?? findSuggestionByDomain(domain);
}

/** How discovery already judged this destination, if it screened it out. */
export function findScreenedOutCandidate(canonicalUrl: string, domain: string): "framing_denied" | "screened_out" | null {
  const row = openOpsDb()
    .prepare(`SELECT status, screen_json FROM discovery_candidates WHERE canonical_url = ? OR domain = ?
      ORDER BY (canonical_url = ?) DESC LIMIT 1`)
    .get(canonicalUrl, domain, canonicalUrl);
  if (!row || (row.status !== "quarantined" && row.status !== "rejected")) return null;
  try {
    const screen = JSON.parse(String(row.screen_json ?? "{}"));
    if (screen?.framing?.denied === true) return "framing_denied";
  } catch {
    // Unreadable screening evidence still means the destination was screened out.
  }
  return "screened_out";
}

export function insertCommunitySuggestion(
  suggestion: CommunitySuggestion,
): { kind: "inserted" | "duplicate"; suggestion: CommunitySuggestion } {
  openOpsDb();
  return insertSuggestion(suggestion);
}

export function __resetSuggestionStoreForTests(): void {
  closeOpsDbForTests();
}

export { DEFAULT_STORE };
