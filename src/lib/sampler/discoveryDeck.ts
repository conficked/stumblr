import type { CatalogueEntry, Topic } from "@/lib/catalogue/types";
import { MAX_DECK_BOUNDARY, MAX_DECK_RECENT_IDS } from "@/lib/storage/schema";
import type { DiscoveryCycleBoundary, DiscoveryDeckState } from "@/lib/storage/schema";
import type { SamplerMode, SamplerOptions } from "./createSampler";

export type DiscoveryDeck = DiscoveryDeckState;

export type DeckScopeOptions = {
  mode: SamplerMode;
  topics: Topic[];
  includeEvaluation: boolean;
};

export type DeckSamplerOptions = SamplerOptions & {
  recentTypes?: string[];
  recentSourceClusters?: string[];
  typeWindow?: number;
  sourceWindow?: number;
  preserveUnavailableIds?: boolean;
};

export type DeckDrawResult = {
  entry: CatalogueEntry;
  deck: DiscoveryDeck;
  newCycle: boolean;
  cycleNumber: number;
};

const adjacentTopicMap: Record<Topic, Topic[]> = {
  art: ["culture", "music"], science: ["nature", "education", "maps"],
  maps: ["science", "culture"], music: ["art", "culture"], games: ["education", "art"],
  culture: ["art", "maps", "music", "archives"], archives: ["culture", "education", "science"],
  education: ["science", "games", "archives"], nature: ["science", "maps"],
};

export function normalizeDeckScope(options: DeckScopeOptions): string {
  return JSON.stringify({
    mode: options.mode,
    topics: [...new Set(options.topics)].sort(),
    includeEvaluation: options.includeEvaluation,
  });
}

function shuffle<T>(values: T[], rng: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.max(0, Math.min(i, Math.floor(rng() * (i + 1))));
    [result[i], result[j]] = [result[j] as T, result[i] as T];
  }
  return result;
}

function fingerprint(ids: string[]): string {
  return [...ids].sort().join("\u001f");
}

function entryScore(entry: CatalogueEntry, options: SamplerOptions): number {
  if (!options.topics.length) return 1;
  const direct = options.topics.some((topic) => entry.topics.includes(topic));
  if (options.mode === "topic") return direct ? 6 : 0;
  const adjacent = new Set(options.topics.flatMap((topic) => adjacentTopicMap[topic]));
  const hasAdjacent = entry.topics.some((topic) => adjacent.has(topic));
  if (options.mode === "adjacent") return direct ? 5 : hasAdjacent ? 3 : 0;
  return direct ? 4 : hasAdjacent ? 2 : 1;
}

export function sourceCluster(entry: CatalogueEntry): string {
  const note = `${entry.provenance.sourceNote} ${entry.policyBasis ?? ""}`.toLowerCase();
  if (note.includes("useless") || note.includes("bored") || note.includes("novelty")) return "novelty";
  if (note.includes("discovered") || note.includes("public source")) return "discovered";
  if (note.includes("fixture")) return "fixture";
  return "curated";
}

export function structuralType(entry: CatalogueEntry): string {
  return entry.topics[0] ?? "culture";
}

export function reconcileDeck(
  deck: DiscoveryDeck,
  eligibleEntries: CatalogueEntry[],
  recentHistory: string[],
  rng: () => number,
  preserveUnavailableIds = false,
): DiscoveryDeck {
  const entries = new Map(eligibleEntries.map((entry) => [entry.id, entry]));
  const ids = [...entries.keys()];
  const eligible = new Set(ids);
  const keepId = (id: string) => preserveUnavailableIds || eligible.has(id);
  const seenIds = deck.seenIds.filter(keepId);
  const seen = new Set(seenIds);
  const oldRemaining = deck.remainingIds.filter((id) => keepId(id) && !seen.has(id));
  const oldRemainingSet = new Set(oldRemaining);
  const added = shuffle(ids.filter((id) => !seen.has(id) && !oldRemainingSet.has(id)), rng);
  const remainingIds = [...oldRemaining];
  // Put additions in the front half of the currently active cycle.
  const insertionLimit = Math.max(1, Math.ceil((remainingIds.length + added.length) / 2));
  for (const id of added) {
    const position = Math.floor(rng() * Math.min(insertionLimit, remainingIds.length + 1));
    remainingIds.splice(position, 0, id);
  }
  const recentTail = deck.recentTailIds.length ? deck.recentTailIds : recentHistory;
  return {
    ...deck,
    remainingIds,
    seenIds,
    recentTailIds: recentTail.filter(keepId).slice(-MAX_DECK_RECENT_IDS),
    catalogueFingerprint: fingerprint(preserveUnavailableIds ? [...seenIds, ...remainingIds] : ids),
  };
}

function startBoundary(priorIds: string[], window: number): DiscoveryCycleBoundary | null {
  return priorIds.length && window ? { priorIds, drawsRemaining: window } : null;
}

function legacyBoundary(deck: DiscoveryDeck, window: number): DiscoveryCycleBoundary | null {
  const drawn = deck.seenIds.length;
  if (drawn >= window) return null;
  // Any older IDs precede this cycle, including history from a v1 migration.
  const priorTailEnd = Math.max(0, deck.recentTailIds.length - drawn);
  const priorIds = [...new Set(deck.recentTailIds.slice(0, priorTailEnd).slice(-window))];
  return startBoundary(priorIds, window - drawn);
}

export function drawFromDeck(
  deck: DiscoveryDeck,
  entriesById: Map<string, CatalogueEntry> | Record<string, CatalogueEntry>,
  samplerOptions: DeckSamplerOptions,
  rng: () => number,
): DeckDrawResult {
  const getEntry = (id: string) => entriesById instanceof Map ? entriesById.get(id) : entriesById[id];
  const poolSize = entriesById instanceof Map ? entriesById.size : Object.keys(entriesById).length;
  let remainingIds = deck.remainingIds.filter((id) => Boolean(getEntry(id)) && !deck.seenIds.includes(id));
  let cycleNumber = deck.cycleNumber;
  let newCycle = false;
  let provisionalDraw = false;
  const tail = deck.recentTailIds;
  const boundaryWindow = Math.min(MAX_DECK_BOUNDARY, Math.floor(poolSize / 2));
  let cycleBoundary = deck.cycleBoundary === undefined ? legacyBoundary(deck, boundaryWindow) : deck.cycleBoundary;
  if (!remainingIds.length) {
    const allIds = entriesById instanceof Map ? [...entriesById.keys()] : Object.keys(entriesById);
    if (!allIds.length) throw new Error("Cannot draw from an empty discovery deck");
    remainingIds = shuffle(allIds, rng);
    // A partial pool can replay bundled entries while the authoritative cycle waits.
    provisionalDraw = !!samplerOptions.preserveUnavailableIds &&
      [...deck.remainingIds, ...deck.seenIds].some((id) => !getEntry(id));
    if (!provisionalDraw) {
      cycleBoundary = boundaryWindow ? startBoundary(deck.seenIds.slice(-boundaryWindow), boundaryWindow) : null;
      cycleNumber += 1;
      newCycle = true;
    }
  }
  let candidates = remainingIds.map((id) => ({ id, entry: getEntry(id) })).filter(
    (item): item is { id: string; entry: CatalogueEntry } => Boolean(item.entry),
  );
  if (cycleBoundary && !provisionalDraw) {
    const forbidden = new Set(cycleBoundary.priorIds);
    const separated = candidates.filter((item) => !forbidden.has(item.id));
    if (separated.length) {
      candidates = separated;
    } else if (samplerOptions.preserveUnavailableIds) {
      // An unavailable, unprotected entry can still satisfy the boundary on recovery.
      provisionalDraw = deck.remainingIds.some((id) => !getEntry(id) && !forbidden.has(id));
    }
  }
  const score = (entry: CatalogueEntry) => entryScore(entry, samplerOptions);
  const lastId = tail.at(-1);
  let pickable = candidates.filter((item) => item.id !== lastId);
  if (!pickable.length) pickable = candidates;
  const lastDomain = tail.length ? getEntry(tail[tail.length - 1] as string)?.domain : undefined;
  const alternateDomain = lastDomain ? pickable.filter((item) => item.entry.domain !== lastDomain) : [];
  if (alternateDomain.length) pickable = alternateDomain;
  const recentTypes = new Set((samplerOptions.recentTypes ?? []).slice(-(samplerOptions.typeWindow ?? 2)));
  const recentSources = new Set((samplerOptions.recentSourceClusters ?? []).slice(-(samplerOptions.sourceWindow ?? 2)));
  const weighted = pickable.map((item) => {
    const type = structuralType(item.entry);
    const cluster = sourceCluster(item.entry);
    let weight = score(item.entry);
    if (recentTypes.has(type) && pickable.some((other) => structuralType(other.entry) !== type)) weight *= 0.25;
    if (recentSources.has(cluster) && pickable.some((other) => sourceCluster(other.entry) !== cluster)) weight *= 0.35;
    return { ...item, weight: Math.max(weight, 0.001) };
  });
  const total = weighted.reduce((sum, item) => sum + item.weight, 0);
  let dart = rng() * total;
  let selected = weighted[weighted.length - 1];
  for (const candidate of weighted) {
    dart -= candidate.weight;
    if (dart <= 0) { selected = candidate; break; }
  }
  if (!selected) throw new Error("Cannot draw from an empty discovery deck");
  const persistedRemaining = samplerOptions.preserveUnavailableIds && !newCycle ? deck.remainingIds : remainingIds;
  const seenIds = newCycle ? [] : deck.seenIds;
  const nextBoundary = cycleBoundary && cycleBoundary.drawsRemaining > 1
    ? { ...cycleBoundary, drawsRemaining: cycleBoundary.drawsRemaining - 1 }
    : null;
  const nextTail = [...tail, selected.id].slice(-MAX_DECK_RECENT_IDS);
  return {
    entry: selected.entry,
    newCycle,
    cycleNumber,
    deck: {
      ...deck,
      remainingIds: provisionalDraw ? deck.remainingIds : persistedRemaining.filter((id) => id !== selected.id),
      seenIds: provisionalDraw ? seenIds : [...seenIds, selected.id],
      recentTailIds: nextTail,
      cycleBoundary: provisionalDraw ? cycleBoundary : nextBoundary,
      cycleNumber,
    },
  };
}
