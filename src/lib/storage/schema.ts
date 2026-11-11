import { Topic } from "@/lib/catalogue/types";
import { SamplerMode } from "@/lib/sampler/createSampler";

export type EntrySnapshot = {
  id: string;
  title: string;
  canonicalUrl: string;
  domain: string;
  seenAt: string;
};

export type LocalReport = {
  id: string;
  entryId: string;
  note: string;
  type: "broken" | "report";
  createdAt: string;
  localOnly: boolean;
};

export type DiscoveryCycleBoundary = {
  priorIds: string[];
  drawsRemaining: number;
};

export type DiscoveryDeckState = {
  remainingIds: string[];
  seenIds: string[];
  recentTailIds: string[];
  /** Absent on legacy v2 decks. Null records a completed or unnecessary boundary. */
  cycleBoundary?: DiscoveryCycleBoundary | null;
  catalogueFingerprint: string;
  cycleNumber: number;
  lastUsedAt: number;
};

export type DiscoveryDeckStore = {
  scopes: Record<string, DiscoveryDeckState>;
  /** Recent migrated history used to prevent the first deck draw repeating the active item. */
  migrationRecentIds: string[];
};

export type ClientStateV2 = {
  version: 2;
  preferences: {
    topics: Topic[];
    mode: SamplerMode;
    includeEvaluationPool: boolean;
  };
  /** Per-browser exploration entropy; never derived from topic prefs alone. */
  samplerSeed: number | null;
  excludedIds: string[];
  saves: EntrySnapshot[];
  history: EntrySnapshot[];
  reports: LocalReport[];
  discoveryDecks: DiscoveryDeckStore;
};

export type ClientState = ClientStateV2;

export const MAX_HISTORY_SNAPSHOTS = 1_000;
export const MAX_DISCOVERY_SCOPES = 20;
export const MAX_DECK_IDS = 10_000;
export const MAX_DECK_BOUNDARY = 10;
export const MAX_DECK_RECENT_IDS = 2 * MAX_DECK_BOUNDARY;

export const DEFAULT_STATE: ClientStateV2 = {
  version: 2,
  preferences: {
    topics: [],
    mode: "wildcard",
    includeEvaluationPool: true,
  },
  samplerSeed: null,
  excludedIds: [],
  saves: [],
  history: [],
  reports: [],
  discoveryDecks: { scopes: {}, migrationRecentIds: [] },
};
