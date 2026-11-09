import { CatalogueEntry, Topic } from "@/lib/catalogue/types";
import { drawFromDeck, reconcileDeck, sourceCluster, structuralType, type DiscoveryDeck } from "./discoveryDeck";

export { sourceCluster, structuralType } from "./discoveryDeck";
export const MAX_SAMPLER_HISTORY = 8;

export type SamplerMode = "topic" | "adjacent" | "wildcard";

export type SamplerOptions = {
  mode: SamplerMode;
  topics: Topic[];
};

export type SamplerState = {
  seenIds: string[];
  seenDomains: string[];
  recentTypes: string[];
  recentSourceClusters: string[];
  exhausted: boolean;
};

export type SamplerPickResult =
  | {
      kind: "entry";
      entry: CatalogueEntry;
      state: SamplerState;
      deck: DiscoveryDeck;
      newCycle: boolean;
      cycleNumber: number;
    }
  | { kind: "exhausted"; state: SamplerState };

export type SamplerExtras = {
  /** Injected RNG for deterministic tests only. Production should omit. */
  rng?: () => number;
  typeWindow?: number;
  sourceWindow?: number;
  /** Persisted caller-owned deck to resume for this preference scope. */
  deck?: DiscoveryDeck;
  /** A partial catalogue can draw known IDs without dropping unavailable membership. */
  preserveUnavailableIds?: boolean;
  /** One-time migration/history seed for a newly initialized scope. */
  recentHistory?: string[];
};

type Sampler = {
  next: (state: SamplerState) => SamplerPickResult;
  initialState: () => SamplerState;
};

const adjacentTopicMap: Record<Topic, Topic[]> = {
  art: ["culture", "music"],
  science: ["nature", "education", "maps"],
  maps: ["science", "culture"],
  music: ["art", "culture"],
  games: ["education", "art"],
  culture: ["art", "maps", "music", "archives"],
  archives: ["culture", "education", "science"],
  education: ["science", "games", "archives"],
  nature: ["science", "maps"],
};

export function mulberry32(seed: number) {
  return function random() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function scoreEntry(entry: CatalogueEntry, opts: SamplerOptions): number {
  if (opts.topics.length === 0) return 1;

  const hasDirectTopic = opts.topics.some((topic) => entry.topics.includes(topic));
  if (opts.mode === "topic") return hasDirectTopic ? 6 : 0;

  if (opts.mode === "adjacent") {
    if (hasDirectTopic) return 5;
    const adjacent = new Set(opts.topics.flatMap((topic) => adjacentTopicMap[topic]));
    const hasAdjacent = entry.topics.some((topic) => adjacent.has(topic));
    return hasAdjacent ? 3 : 0;
  }

  if (hasDirectTopic) return 4;
  const adjacent = new Set(opts.topics.flatMap((topic) => adjacentTopicMap[topic]));
  const hasAdjacent = entry.topics.some((topic) => adjacent.has(topic));
  return hasAdjacent ? 2 : 1;
}

/**
 * A scope-local sampler. Supply `extras.deck` to resume persisted progress and
 * persist each entry result's updated deck. Deterministic when `extras.rng` or
 * the seed-backed mulberry generator is supplied.
 */
export function createSampler(
  seed: number,
  entries: CatalogueEntry[],
  opts: SamplerOptions,
  extras: SamplerExtras = {},
): Sampler {
  const random = extras.rng ?? mulberry32(seed);
  const typeWindow = extras.typeWindow ?? 2;
  const sourceWindow = extras.sourceWindow ?? 2;

  const scored = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, opts) }))
    .filter((item) => item.score > 0);

  const fallbackAllowed = opts.mode === "wildcard" || opts.topics.length === 0;
  const pool =
    scored.length > 0
      ? scored
      : fallbackAllowed
        ? entries.map((entry) => ({ entry, score: 1 }))
        : [];
  let deck: DiscoveryDeck | undefined = extras.deck;
  let hasReconciled = false;

  return {
    initialState: () => ({
      seenIds: [],
      seenDomains: [],
      recentTypes: [],
      recentSourceClusters: [],
      exhausted: false,
    }),
    next: (state) => {
      if (pool.length === 0) return { kind: "exhausted", state: { ...state, exhausted: true } };
      const eligible = pool.map((item) => item.entry);
      deck ??= {
        remainingIds: [],
        seenIds: [],
        recentTailIds: [],
        catalogueFingerprint: "",
        cycleNumber: 0,
        lastUsedAt: 0,
      };
      deck = reconcileDeck(
        deck,
        eligible,
        hasReconciled ? [] : extras.recentHistory ?? state.seenIds,
        random,
        extras.preserveUnavailableIds,
      );
      hasReconciled = true;
      const result = drawFromDeck(
        deck,
        new Map(eligible.map((entry) => [entry.id, entry])),
        {
          ...opts,
          recentTypes: state.recentTypes,
          recentSourceClusters: state.recentSourceClusters,
          typeWindow,
          sourceWindow,
          preserveUnavailableIds: extras.preserveUnavailableIds,
        },
        random,
      );
      deck = result.deck;
      const pick = {
        entry: result.entry,
        type: structuralType(result.entry),
        cluster: sourceCluster(result.entry),
      };

      return {
        kind: "entry",
        entry: pick.entry,
        deck,
        newCycle: result.newCycle,
        cycleNumber: result.cycleNumber,
        state: {
          seenIds: [...state.seenIds, pick.entry.id],
          seenDomains: [...state.seenDomains, pick.entry.domain],
          recentTypes: [...state.recentTypes, pick.type].slice(-MAX_SAMPLER_HISTORY),
          recentSourceClusters: [...state.recentSourceClusters, pick.cluster].slice(-MAX_SAMPLER_HISTORY),
          exhausted: false,
        },
      };
    },
  };
}
