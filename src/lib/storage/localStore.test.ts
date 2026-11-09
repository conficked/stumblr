import { beforeEach, expect, test } from "vitest";
import { getCatalogue } from "@/lib/catalogue";
import { createSampler } from "@/lib/sampler/createSampler";
import { loadClientState, migrateClientState, patchClientState, resetClientState, resetDiscoveryState, writeClientState } from "./localStore";
import { DEFAULT_STATE } from "./schema";

beforeEach(() => {
  resetClientState();
});

test("loadClientState recovers from corrupt json", () => {
  window.localStorage.setItem("stumblr:v1", "{broken");
  expect(loadClientState().history).toEqual([]);
});

test("writeClientState persists and reloads", () => {
  const next = structuredClone(DEFAULT_STATE);
  next.preferences.includeEvaluationPool = true;
  writeClientState(next);
  expect(loadClientState().preferences.includeEvaluationPool).toBe(true);
});


test("migrates v1 state to v2 while preserving user data and seeding recent history", () => {
  const recent = { id: "recent", title: "Recent", canonicalUrl: "https://example.test", domain: "example.test", seenAt: "2026-01-01" };
  const state = migrateClientState({
    version: 1,
    preferences: { topics: ["art"], mode: "direct", includeEvaluationPool: false },
    samplerSeed: 17,
    excludedIds: ["excluded"], saves: [recent], history: [recent],
    reports: [{ id: "r", entryId: "recent", note: "note", type: "report", createdAt: "2026-01-02", localOnly: true }],
  });
  expect(state.version).toBe(2);
  expect(state.preferences).toEqual({ topics: ["art"], mode: "direct", includeEvaluationPool: false });
  expect(state.samplerSeed).toBe(17);
  expect(state.excludedIds).toEqual(["excluded"]);
  expect(state.saves).toEqual([recent]);
  expect(state.reports).toHaveLength(1);
  expect(state.discoveryDecks.migrationRecentIds).toEqual(["recent"]);
});

test("bounds history and removes malformed discovery deck state", () => {
  const history = Array.from({ length: 1005 }, (_, i) => ({ id: `id-${i}`, title: "t", canonicalUrl: "u", domain: "d", seenAt: "now" }));
  const state = migrateClientState({ version: 2, history, discoveryDecks: { scopes: { broken: { remainingIds: ["x", "x"] } } } });
  expect(state.history).toHaveLength(1000);
  expect(state.history[0].id).toBe("id-5");
  expect(state.discoveryDecks.scopes).toEqual({});
});

test("resets only discovery history and decks", () => {
  const state = migrateClientState({ version: 1, preferences: { topics: ["art"], mode: "direct", includeEvaluationPool: false }, samplerSeed: 23, excludedIds: ["x"], saves: [], history: [], reports: [] });
  state.discoveryDecks.scopes.scope = { remainingIds: ["a"], seenIds: ["b"], recentTailIds: ["c"], catalogueFingerprint: "fp", cycleNumber: 2, lastUsedAt: 10 };
  state.discoveryDecks.migrationRecentIds = ["c"];
  const reset = resetDiscoveryState(state);
  expect(reset.history).toEqual([]);
  expect(reset.discoveryDecks).toEqual({ scopes: {}, migrationRecentIds: [] });
  expect(reset.preferences).toEqual(state.preferences);
  expect(reset.samplerSeed).toBe(23);
  expect(reset.excludedIds).toEqual(["x"]);
  expect(reset.saves).toEqual(state.saves);
  expect(reset.reports).toEqual(state.reports);
});

test("writes migrated v2 state on the next patch", async () => {
  window.localStorage.setItem("stumblr:v1", JSON.stringify({ version: 1, history: [] }));
  const { patchClientState } = await import("./localStore");
  patchClientState({ samplerSeed: 42 });
  expect(JSON.parse(window.localStorage.getItem("stumblr:v1")!).version).toBe(2);
});

test.each([["eleventh draw and up to the tail limit", 21, 21], ["one-entry second draw", 1, 2]])(
  "reloads the chronological deck tail after the %s",
  (_label, poolSize, draws) => {
    const entries = getCatalogue({ includeEvaluation: true }).slice(0, poolSize);
    const drawn: string[] = [];
    for (let index = 0; index < draws; index++) {
      const state = loadClientState();
      const sampler = createSampler(12, entries, { mode: "wildcard", topics: [] }, {
        deck: state.discoveryDecks.scopes.scope,
      });
      const next = sampler.next(sampler.initialState());
      if (next.kind !== "entry") throw new Error("expected a discovery draw");
      drawn.push(next.entry.id);
      state.discoveryDecks.scopes.scope = next.deck;
      writeClientState(state);
      const reloaded = loadClientState().discoveryDecks.scopes.scope;
      expect(reloaded?.recentTailIds).toEqual(drawn.slice(-20));
      expect(reloaded?.seenIds).toEqual(drawn.slice(-Math.min(index + 1, poolSize)));
    }
  },
);

test("a preference write preserves the chronological v1 migration tail across reloads", () => {
  const history = ["a", "b", "a"].map((id) => ({
    id, title: id, canonicalUrl: "https://example.test", domain: "example.test", seenAt: "now",
  }));
  window.localStorage.setItem("stumblr:v1", JSON.stringify({ version: 1, history }));
  patchClientState({ preferences: { topics: ["science"], mode: "topic", includeEvaluationPool: true } });

  expect(loadClientState().discoveryDecks.migrationRecentIds).toEqual(["a", "b", "a"]);
});

test.each(["remainingIds", "seenIds"])("rejects duplicate IDs within a cycle's %s", (field) => {
  const state = structuredClone(DEFAULT_STATE);
  state.discoveryDecks.scopes.scope = {
    remainingIds: ["a"], seenIds: ["b"], recentTailIds: ["b", "b"],
    catalogueFingerprint: "fp", cycleNumber: 2, lastUsedAt: 10,
    [field]: ["a", "a"],
  };

  writeClientState(state);
  expect(loadClientState().discoveryDecks.scopes).toEqual({});
});

test("rejects a deck with the same ID both remaining and seen", () => {
  const state = structuredClone(DEFAULT_STATE);
  state.discoveryDecks.scopes.scope = {
    remainingIds: ["a"], seenIds: ["a"], recentTailIds: ["a"],
    catalogueFingerprint: "fp", cycleNumber: 0, lastUsedAt: 1,
  };

  writeClientState(state);
  expect(loadClientState().discoveryDecks.scopes).toEqual({});
});

test("retains only the twenty most recently used valid scope decks", () => {
  const scopes = Object.fromEntries(Array.from({ length: 22 }, (_, i) => [`scope-${i}`, {
    remainingIds: [`id-${i}`], seenIds: [], recentTailIds: [], catalogueFingerprint: "fp", cycleNumber: 0, lastUsedAt: i,
  }]));
  const state = migrateClientState({ version: 2, discoveryDecks: { scopes } });
  expect(Object.keys(state.discoveryDecks.scopes)).toHaveLength(20);
  expect(state.discoveryDecks.scopes["scope-21"]).toBeDefined();
  expect(state.discoveryDecks.scopes["scope-0"]).toBeUndefined();
});

test("keeps writes in memory when local storage is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  Object.defineProperty(window, "localStorage", { configurable: true, get: () => { throw new Error("blocked"); } });
  try {
    const state = { ...structuredClone(DEFAULT_STATE), samplerSeed: 91 };
    const deck = {
      remainingIds: ["a"], seenIds: ["b"], recentTailIds: ["b", "b"],
      catalogueFingerprint: "fp", cycleNumber: 2, lastUsedAt: 10,
    };
    state.discoveryDecks.scopes.scope = deck;
    writeClientState(state);
    deck.recentTailIds.push("caller mutation");
    expect(loadClientState().samplerSeed).toBe(91);
    expect(loadClientState().discoveryDecks.scopes.scope.recentTailIds).toEqual(["b", "b"]);
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
  }
});

test("prefers the latest session state after a storage write failure", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  const local = window.localStorage;
  local.setItem("stumblr:v1", JSON.stringify({ ...structuredClone(DEFAULT_STATE), samplerSeed: 1 }));
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: local.getItem.bind(local), removeItem: local.removeItem.bind(local), clear: local.clear.bind(local),
    setItem: () => { throw new Error("quota"); },
  } });
  try {
    writeClientState({ ...structuredClone(DEFAULT_STATE), samplerSeed: 2 });
    expect(loadClientState().samplerSeed).toBe(2);
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
  }
});

test("falls back to the latest session state after a storage read failure", () => {
  const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
  writeClientState({ ...structuredClone(DEFAULT_STATE), samplerSeed: 3 });
  Object.defineProperty(window, "localStorage", { configurable: true, value: {
    getItem: () => { throw new Error("blocked"); }, setItem: () => {}, removeItem: () => {}, clear: () => {},
  } });
  try {
    expect(loadClientState().samplerSeed).toBe(3);
  } finally {
    if (descriptor) Object.defineProperty(window, "localStorage", descriptor);
  }
});

test("full reset clears the persisted and in-memory state", () => {
  writeClientState({ ...structuredClone(DEFAULT_STATE), samplerSeed: 5 });
  resetClientState();
  expect(window.localStorage.getItem("stumblr:v1")).toBeNull();
  expect(loadClientState()).toEqual(DEFAULT_STATE);
});
