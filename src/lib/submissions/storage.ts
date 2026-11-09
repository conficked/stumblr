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
