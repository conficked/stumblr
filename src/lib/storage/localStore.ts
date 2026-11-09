import {
  ClientStateV2,
  DEFAULT_STATE,
  DiscoveryCycleBoundary,
  DiscoveryDeckState,
  DiscoveryDeckStore,
  EntrySnapshot,
  MAX_DECK_BOUNDARY,
  MAX_DECK_IDS,
  MAX_DECK_RECENT_IDS,
  MAX_DISCOVERY_SCOPES,
  MAX_HISTORY_SNAPSHOTS,
} from "./schema";

const KEY = "stumblr:v1";
const MIGRATION_TAIL_SIZE = 10;
let memoryState: ClientStateV2 = structuredClone(DEFAULT_STATE);
let preferMemoryState = false;

function storage(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function snapshots(value: unknown, limit: number): EntrySnapshot[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is EntrySnapshot =>
    isRecord(item) && ["id", "title", "canonicalUrl", "domain", "seenAt"].every((key) => typeof item[key] === "string"),
  ).slice(-limit);
}

function stringIds(value: unknown, limit = MAX_DECK_IDS): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const id of value) {
    if (typeof id !== "string" || !id || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= limit) break;
  }
  return result;
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIdList(value: unknown, limit: number): value is string[] {
  if (!Array.isArray(value) || value.length > limit) return false;
  for (const id of value) {
    if (!isId(id)) return false;
  }
  return true;
}

function migrationTail(value: unknown): string[] {
  return Array.isArray(value) ? value.filter(isId).slice(-MIGRATION_TAIL_SIZE) : [];
}

function validBoundary(value: unknown): DiscoveryCycleBoundary | null | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  const { priorIds, drawsRemaining } = value;
  if (
    !isIdList(priorIds, MAX_DECK_BOUNDARY) || !priorIds.length ||
    new Set(priorIds).size !== priorIds.length ||
    typeof drawsRemaining !== "number" || !Number.isInteger(drawsRemaining) ||
    drawsRemaining < 1 || drawsRemaining > MAX_DECK_BOUNDARY
  ) return undefined;
  return { priorIds: [...priorIds], drawsRemaining };
}

function validDeck(input: unknown): DiscoveryDeckState | null {
  if (!isRecord(input)) return null;
  const { remainingIds, seenIds, recentTailIds, catalogueFingerprint, cycleNumber, lastUsedAt } = input;
  if (
    typeof catalogueFingerprint !== "string" ||
    typeof cycleNumber !== "number" || !Number.isSafeInteger(cycleNumber) || cycleNumber < 0 ||
    typeof lastUsedAt !== "number" || !Number.isFinite(lastUsedAt) ||
    !isIdList(remainingIds, MAX_DECK_IDS) || !isIdList(seenIds, MAX_DECK_IDS) ||
    !isIdList(recentTailIds, MAX_DECK_RECENT_IDS)
  ) return null;
  const activeIds = new Set([...remainingIds, ...seenIds]);
  if (activeIds.size !== remainingIds.length + seenIds.length) return null;
  const cycleBoundary = validBoundary(input.cycleBoundary);
  return {
    remainingIds: [...remainingIds],
    seenIds: [...seenIds],
    recentTailIds: [...recentTailIds],
    catalogueFingerprint,
    cycleNumber,
    lastUsedAt,
    ...(cycleBoundary === undefined ? {} : { cycleBoundary }),
  };
}

function decks(value: unknown): DiscoveryDeckStore {
  if (!isRecord(value) || !isRecord(value.scopes)) return structuredClone(DEFAULT_STATE.discoveryDecks);
  const valid = Object.entries(value.scopes)
    .map(([scope, deck]) => [scope, validDeck(deck)] as const)
    .filter((entry): entry is readonly [string, DiscoveryDeckState] => Boolean(entry[1]))
    .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt)
    .slice(0, MAX_DISCOVERY_SCOPES);
  return { scopes: Object.fromEntries(valid), migrationRecentIds: migrationTail(value.migrationRecentIds) };
}

export function migrateClientState(input: unknown): ClientStateV2 {
  if (!isRecord(input) || (input.version !== 1 && input.version !== 2)) return structuredClone(DEFAULT_STATE);
  const prefs = isRecord(input.preferences) ? input.preferences : {};
  const history = snapshots(input.history, MAX_HISTORY_SNAPSHOTS);
  const migratedDecks = decks(input.discoveryDecks);
  if (input.version === 1) {
    migratedDecks.migrationRecentIds = migrationTail(history.map((item) => item.id));
  }
  const samplerSeed = input.samplerSeed;
  return {
    version: 2,
    preferences: {
      topics: Array.isArray(prefs.topics) ? prefs.topics as ClientStateV2["preferences"]["topics"] : DEFAULT_STATE.preferences.topics,
      mode: (typeof prefs.mode === "string" ? prefs.mode : DEFAULT_STATE.preferences.mode) as ClientStateV2["preferences"]["mode"],
      includeEvaluationPool: typeof prefs.includeEvaluationPool === "boolean" ? prefs.includeEvaluationPool : DEFAULT_STATE.preferences.includeEvaluationPool,
    },
    samplerSeed: typeof samplerSeed === "number" && Number.isFinite(samplerSeed) ? Math.abs(Math.trunc(samplerSeed)) % 0xffffffff : null,
    excludedIds: stringIds(input.excludedIds),
    saves: snapshots(input.saves, MAX_DECK_IDS),
    history,
    reports: Array.isArray(input.reports) ? input.reports.filter((report) => isRecord(report) && typeof report.id === "string" && typeof report.entryId === "string") as ClientStateV2["reports"] : [],
    discoveryDecks: migratedDecks,
  };
}

export function resetDiscoveryState(state: ClientStateV2): ClientStateV2 {
  return { ...state, history: [], discoveryDecks: structuredClone(DEFAULT_STATE.discoveryDecks) };
}

export function loadClientState(): ClientStateV2 {
  const local = storage();
  if (!local) {
    preferMemoryState = true;
    return structuredClone(memoryState);
  }
  if (preferMemoryState) return structuredClone(memoryState);
  try {
    const raw = local.getItem(KEY);
    if (!raw) {
      memoryState = structuredClone(DEFAULT_STATE);
      return structuredClone(memoryState);
    }
    memoryState = migrateClientState(JSON.parse(raw) as unknown);
    return structuredClone(memoryState);
  } catch {
    preferMemoryState = true;
    return structuredClone(memoryState);
  }
}

export function writeClientState(next: ClientStateV2) {
  memoryState = migrateClientState(next);
  const local = storage();
  if (!local) {
    preferMemoryState = true;
    return;
  }
  try { local.setItem(KEY, JSON.stringify(memoryState)); } catch {
    preferMemoryState = true;
    /* Keep the session fallback. */
  }
}

export function patchClientState(patch: Partial<ClientStateV2>): ClientStateV2 {
  const merged = migrateClientState({ ...loadClientState(), ...patch, version: 2 });
  writeClientState(merged);
  return merged;
}

export function exportClientState(): string {
  return JSON.stringify(loadClientState(), null, 2);
}

export function resetClientState() {
  memoryState = structuredClone(DEFAULT_STATE);
  preferMemoryState = false;
  const local = storage();
  if (!local) {
    preferMemoryState = true;
    return;
  }
  try { local.removeItem(KEY); } catch {
    preferMemoryState = true;
    /* Ignore storage errors. */
  }
}
