import { test, expect } from "vitest";
import { createSampler, mulberry32, sourceCluster, structuralType } from "./createSampler";
import { getCatalogue } from "@/lib/catalogue";
import { CatalogueEntry } from "@/lib/catalogue/types";
import type { DiscoveryDeck } from "./discoveryDeck";

test("sampler does not repeat entries before exhaustion", () => {
  const entries = getCatalogue({ includeEvaluation: true });
  const sampler = createSampler(42, entries, { mode: "wildcard", topics: [] });
  let state = sampler.initialState();
  const seen = new Set<string>();

  for (let i = 0; i < entries.length; i += 1) {
    const pick = sampler.next(state);
    expect(pick.kind).toBe("entry");
    if (pick.kind === "entry") {
      expect(seen.has(pick.entry.id)).toBe(false);
      seen.add(pick.entry.id);
      state = pick.state;
    }
  }

  const exhausted = sampler.next(state);
  expect(exhausted.kind).toBe("entry");
});

test("topic mode exhausts when no entries match selected topic set", () => {
  const entries = getCatalogue({ includeEvaluation: true }).filter(
    (entry) => !entry.topics.includes("nature"),
  );
  const sampler = createSampler(7, entries, { mode: "topic", topics: ["nature"] });
  const initial = sampler.initialState();
  const first = sampler.next(initial);
  expect(first.kind).toBe("exhausted");
});

test("different seeds diverge for identical prefs (fresh randomness)", () => {
  const entries = getCatalogue({ includeEvaluation: true });
  const a = createSampler(101, entries, { mode: "wildcard", topics: [] });
  const b = createSampler(202, entries, { mode: "wildcard", topics: [] });
  const seqA: string[] = [];
  const seqB: string[] = [];
  let stateA = a.initialState();
  let stateB = b.initialState();
  for (let i = 0; i < Math.min(12, entries.length); i += 1) {
    const pa = a.next(stateA);
    const pb = b.next(stateB);
    if (pa.kind === "entry") {
      seqA.push(pa.entry.id);
      stateA = pa.state;
    }
    if (pb.kind === "entry") {
      seqB.push(pb.entry.id);
      stateB = pb.state;
    }
  }
  expect(seqA.join("|")).not.toBe(seqB.join("|"));
});

test("three fresh sessions produce unique no-repeat domain-diverse sequences", () => {
  const entries = getCatalogue({ includeEvaluation: true });
  const sessionSeeds = [0x10203040, 0x50607080, 0x90a0b0c0];
  const sequences = sessionSeeds.map((seed) => {
    const sampler = createSampler(seed, entries, { mode: "wildcard", topics: [] });
    let state = sampler.initialState();
    const ids: string[] = [];
    const domains: string[] = [];
    for (let index = 0; index < Math.min(12, entries.length); index += 1) {
      const pick = sampler.next(state);
      expect(pick.kind).toBe("entry");
      if (pick.kind !== "entry") break;
      ids.push(pick.entry.id);
      domains.push(pick.entry.domain);
      state = pick.state;
    }
    expect(new Set(ids).size).toBe(ids.length);
    for (let index = 1; index < domains.length; index += 1) {
      expect(domains[index]).not.toBe(domains[index - 1]);
    }
    return ids.join("|");
  });

  expect(new Set(sessionSeeds).size).toBe(3);
  expect(new Set(sequences).size).toBe(3);
});

test("avoids consecutive same domain when alternatives exist", () => {
  const base = getCatalogue({ includeEvaluation: true })[0] as CatalogueEntry;
  const entries: CatalogueEntry[] = [
    { ...base, id: "a1", domain: "alpha.test", canonicalUrl: "https://alpha.test/1", topics: ["art"] },
    { ...base, id: "a2", domain: "alpha.test", canonicalUrl: "https://alpha.test/2", topics: ["art"] },
    { ...base, id: "b1", domain: "beta.test", canonicalUrl: "https://beta.test/1", topics: ["science"] },
  ];
  const rng = mulberry32(99);
  const sampler = createSampler(99, entries, { mode: "wildcard", topics: [] }, { rng });
  let state = sampler.initialState();
  const first = sampler.next(state);
  expect(first.kind).toBe("entry");
  if (first.kind !== "entry") return;
  state = first.state;
  const second = sampler.next(state);
  expect(second.kind).toBe("entry");
  if (second.kind !== "entry") return;
  if (first.entry.domain === "alpha.test") {
    // With an alternative domain available, second should prefer beta.
    expect(second.entry.domain).toBe("beta.test");
  }
});

test("never picks a consecutive same-domain clone while another domain is unseen", () => {
  const base = getCatalogue({ includeEvaluation: true })[0] as CatalogueEntry;
  const entries: CatalogueEntry[] = [
    { ...base, id: "a1", domain: "alpha.test", canonicalUrl: "https://alpha.test/1" },
    { ...base, id: "a2", domain: "alpha.test", canonicalUrl: "https://alpha.test/2" },
    { ...base, id: "b1", domain: "beta.test", canonicalUrl: "https://beta.test/1" },
  ];
  const sampler = createSampler(
    1,
    entries,
    { mode: "wildcard", topics: [] },
    { rng: () => 0 },
  );
  const first = sampler.next(sampler.initialState());
  expect(first.kind).toBe("entry");
  if (first.kind !== "entry") return;

  const second = sampler.next(first.state);
  expect(second.kind).toBe("entry");
  if (second.kind !== "entry") return;
  expect(second.entry.domain).toBe("beta.test");
});

test("structural helpers are stable", () => {
  const entry = getCatalogue({ includeEvaluation: true })[0] as CatalogueEntry;
  expect(structuralType(entry)).toBeTruthy();
  expect(sourceCluster(entry)).toBeTruthy();
});

test("automatically cycles repeatedly without immediate repeats or clearing long history", () => {
  const entries = getCatalogue({ includeEvaluation: true });
  const sampler = createSampler(987, entries, { mode: "wildcard", topics: [] });
  let state = sampler.initialState(); let previous = "";
  for (let i = 0; i < entries.length * 4; i++) {
    const result = sampler.next(state); expect(result.kind).toBe("entry");
    if (result.kind !== "entry") throw new Error("unexpected dead end");
    expect(result.entry.id).not.toBe(previous); previous = result.entry.id; state = result.state;
  }
  expect(state.seenIds.length).toBe(entries.length * 4);
});
test("single eligible destination gracefully cycles without looping internally", () => {
  const entry = getCatalogue({ includeEvaluation: true })[0];
  const sampler = createSampler(1, [entry], {mode: "wildcard", topics: []});
  let state = sampler.initialState();
  for(let i=0;i<20;i++){const result=sampler.next(state);expect(result.kind).toBe("entry");if(result.kind==="entry")state=result.state;}
});

test("a caller can resume the returned deck in a new sampler instance", () => {
  const entries = getCatalogue({ includeEvaluation: true }).slice(0, 6);
  const firstSampler = createSampler(123, entries, { mode: "wildcard", topics: [] }, { rng: () => 0 });
  const first = firstSampler.next(firstSampler.initialState());
  expect(first.kind).toBe("entry");
  if (first.kind !== "entry") return;

  const resumed = createSampler(456, entries, { mode: "wildcard", topics: [] }, { rng: () => 0, deck: first.deck });
  const second = resumed.next(resumed.initialState());
  expect(second.kind).toBe("entry");
  if (second.kind !== "entry") return;
  expect(second.entry.id).not.toBe(first.entry.id);
  expect(second.deck.seenIds).toContain(first.entry.id);
});

test("a runtime catalogue addition joins the active deck before recycling", () => {
  const catalogue = getCatalogue({ includeEvaluation: true }).slice(0, 3);
  const [a, b, c] = catalogue;
  if (!a || !b || !c) throw new Error("expected catalogue fixture entries");
  const sampler = createSampler(
    9,
    [...catalogue, { ...a, id: "runtime-addition", canonicalUrl: "https://runtime-addition.test" }],
    { mode: "wildcard", topics: [] },
    {
      rng: () => 0,
      deck: {
        remainingIds: [b.id, c.id], seenIds: [a.id], recentTailIds: [a.id],
        catalogueFingerprint: [a.id, b.id, c.id].sort().join("\u001f"), cycleNumber: 4, lastUsedAt: 1,
      },
    },
  );
  const result = sampler.next(sampler.initialState());
  expect(result.kind).toBe("entry");
  if (result.kind !== "entry") return;
  expect(result.newCycle).toBe(false);
  expect(result.cycleNumber).toBe(4);
  expect(result.deck.remainingIds).toContain("runtime-addition");
});

test("migration history seeds the first deck boundary and remains caller-clearable", () => {
  const entries = getCatalogue({ includeEvaluation: true }).slice(0, 4);
  let migrationRecentIds = [entries[0]?.id ?? ""];
  const sampler = createSampler(4, entries, { mode: "wildcard", topics: [] }, {
    rng: () => 0,
    recentHistory: migrationRecentIds,
  });
  const result = sampler.next(sampler.initialState());
  expect(result.kind).toBe("entry");
  if (result.kind !== "entry") return;
  expect(result.entry.id).not.toBe(entries[0]?.id);
  expect(result.deck.recentTailIds).toContain(entries[0]?.id);
  migrationRecentIds = [];
  expect(migrationRecentIds).toEqual([]);
  const resumed = createSampler(5, entries, { mode: "wildcard", topics: [] }, {
    rng: () => 0,
    deck: result.deck,
    recentHistory: migrationRecentIds,
  });
  const next = resumed.next(resumed.initialState());
  expect(next.kind).toBe("entry");
  if (next.kind === "entry") expect(next.entry.id).not.toBe(entries[0]?.id);
});

test("bundled fallback can keep drawing while an unavailable destination holds the cycle open", () => {
  const [first, second, third, fourth] = getCatalogue({ includeEvaluation: true });
  const options = { mode: "wildcard" as const, topics: [] };
  let deck: DiscoveryDeck = {
    remainingIds: [second.id, fourth.id], seenIds: [first.id, third.id],
    recentTailIds: [first.id, third.id], catalogueFingerprint: "fixture", cycleNumber: 3, lastUsedAt: 0,
    cycleBoundary: { priorIds: [first.id], drawsRemaining: 2 },
  };
  const sampler = createSampler(1, [first, second], options, {
    rng: () => 0,
    preserveUnavailableIds: true,
    deck,
  });
  let state = sampler.initialState();
  for (const expected of [second.id, first.id, second.id]) {
    const draw = sampler.next(state);
    if (draw.kind !== "entry") throw new Error("expected a bundled destination");
    expect(draw.entry.id).toBe(expected);
    expect(draw.deck.seenIds).toEqual([first.id, third.id, second.id]);
    expect(draw.deck.remainingIds).toEqual([fourth.id]);
    expect(draw.deck.cycleBoundary).toEqual({ priorIds: [first.id], drawsRemaining: 1 });
    expect(draw.cycleNumber).toBe(3);
    expect(draw.newCycle).toBe(false);
    state = draw.state;
    deck = draw.deck;
  }

  const recovered = createSampler(1, [first, second, fourth], options, { deck });
  const draw = recovered.next(recovered.initialState());
  if (draw.kind !== "entry") throw new Error("expected a recovered runtime destination");
  expect(draw.entry.id).toBe(fourth.id);
  expect(draw.cycleNumber).toBe(3);
  expect(draw.deck.seenIds).toEqual([first.id, second.id, fourth.id]);
});

test("a boundary-protected bundled draw is provisional while its runtime alternative is unavailable", () => {
  const [bundled, runtime] = getCatalogue({ includeEvaluation: true });
  const options = { mode: "wildcard" as const, topics: [] };
  const deck: DiscoveryDeck = {
    remainingIds: [bundled.id, runtime.id], seenIds: [],
    recentTailIds: [bundled.id], catalogueFingerprint: "fixture", cycleNumber: 3, lastUsedAt: 0,
    cycleBoundary: { priorIds: [bundled.id], drawsRemaining: 1 },
  };
  const fallback = createSampler(1, [bundled], options, { deck, preserveUnavailableIds: true, rng: () => 0 });

  const provisional = fallback.next(fallback.initialState());
  if (provisional.kind !== "entry") throw new Error("expected a provisional bundled destination");
  expect(provisional.entry.id).toBe(bundled.id);
  expect(provisional.deck.seenIds).toEqual([]);
  expect(provisional.deck.remainingIds).toEqual([bundled.id, runtime.id]);
  expect(provisional.deck.cycleBoundary).toEqual(deck.cycleBoundary);
  expect(provisional.cycleNumber).toBe(3);
  expect(provisional.newCycle).toBe(false);

  const recovered = createSampler(1, [bundled, runtime], options, { deck: provisional.deck, rng: () => 0 });
  const first = recovered.next(recovered.initialState());
  if (first.kind !== "entry") throw new Error("expected the recovered runtime destination");
  expect(first.entry.id).toBe(runtime.id);
  expect(first.deck.remainingIds).toEqual([bundled.id]);
  expect(first.deck.cycleBoundary).toBeNull();
  const second = recovered.next(first.state);
  if (second.kind !== "entry") throw new Error("expected the remaining bundled destination");
  expect(second.entry.id).toBe(bundled.id);
  expect(second.deck.seenIds).toEqual([runtime.id, bundled.id]);
  expect(second.cycleNumber).toBe(3);
});
