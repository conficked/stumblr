import { expect, test } from "vitest";
import { getCatalogue } from "@/lib/catalogue";
import { CatalogueEntry } from "@/lib/catalogue/types";
import {
  drawFromDeck,
  normalizeDeckScope,
  reconcileDeck,
} from "./discoveryDeck";

const sample = getCatalogue({ includeEvaluation: true })[0] as CatalogueEntry;
const entry = (id: string, domain = `${id}.test`): CatalogueEntry => ({
  ...sample,
  id,
  domain,
  canonicalUrl: `https://${domain}/`,
});
const blank = () => ({
  remainingIds: [] as string[], seenIds: [] as string[], recentTailIds: [] as string[],
  catalogueFingerprint: "", cycleNumber: 0, lastUsedAt: 0,
});

test("normalizes topic order and separates preference scopes", () => {
  const base = { mode: "adjacent" as const, includeEvaluation: true };
  expect(normalizeDeckScope({ ...base, topics: ["science", "art"] })).toBe(
    normalizeDeckScope({ ...base, topics: ["art", "science"] }),
  );
  expect(normalizeDeckScope({ ...base, topics: ["art", "science"] })).not.toBe(
    normalizeDeckScope({ ...base, mode: "wildcard", topics: ["art", "science"] }),
  );
  expect(normalizeDeckScope({ ...base, topics: ["art", "science"], includeEvaluation: false })).not.toBe(
    normalizeDeckScope({ ...base, topics: ["art", "science"] }),
  );
});

test("reconciles removals and injects additions into the active cycle before recycling", () => {
  const old = { ...blank(), remainingIds: ["b", "c", "removed"], seenIds: ["a"], recentTailIds: ["a"], catalogueFingerprint: "old" };
  const result = reconcileDeck(old, [entry("a"), entry("b"), entry("c"), entry("new")], [], () => 0);
  expect(result.remainingIds).toContain("new");
  expect(result.remainingIds).not.toContain("removed");
  expect(result.seenIds).toEqual(["a"]);
  expect(result.cycleNumber).toBe(0);
  expect(result.remainingIds.indexOf("new")).toBeLessThan(Math.ceil(result.remainingIds.length / 2));
});

test("keeps an active Review Focus cycle when evaluation catalogue entries are added", () => {
  const before = [entry("review-a"), entry("review-b")];
  const active = reconcileDeck(blank(), before, [], () => 0);
  const after = reconcileDeck(active, [...before, entry("review-new")], [], () => 0);
  expect(after.cycleNumber).toBe(0);
  expect(after.remainingIds).toContain("review-new");
  expect(after.remainingIds).toContain("review-a");
  expect(after.remainingIds).toContain("review-b");
});

test("each eligible id is drawn once before a cycle repeats", () => {
  const entries = [entry("a"), entry("b"), entry("c"), entry("d")];
  let deck = reconcileDeck(blank(), entries, [], () => 0);
  const ids: string[] = [];
  for (let i = 0; i < entries.length; i++) {
    const result = drawFromDeck(deck, new Map(entries.map((item) => [item.id, item])), { mode: "wildcard", topics: [] }, () => 0);
    ids.push(result.entry.id);
    deck = result.deck;
    expect(result.newCycle).toBe(false);
  }
  expect(new Set(ids).size).toBe(entries.length);
  const next = drawFromDeck(deck, new Map(entries.map((item) => [item.id, item])), { mode: "wildcard", topics: [] }, () => 0);
  expect(next.newCycle).toBe(true);
  expect(next.cycleNumber).toBe(1);
  expect(next.entry.id).not.toBe(ids.at(-1));
});

test.each([[4, 2], [20, 10], [30, 10]])(
  "keeps the whole boundary separated for a pool of %i with a window of %i",
  (size, separation) => {
    const entries = Array.from({ length: size }, (_, i) => entry(`id-${i}`));
    const firstCycle = entries.map(({ id }) => id);
    const forbidden = firstCycle.slice(-separation);
    let deck = { ...blank(), seenIds: firstCycle, recentTailIds: firstCycle.slice(-20) };
    const map = new Map(entries.map((item) => [item.id, item]));
    const secondCycle: string[] = [];
    for (let i = 0; i < size; i++) {
      const picked = drawFromDeck(deck, map, { mode: "wildcard", topics: [] }, () => 0);
      secondCycle.push(picked.entry.id);
      deck = picked.deck;
    }

    expect(secondCycle.slice(0, separation).filter((id) => forbidden.includes(id))).toEqual([]);
    expect(new Set(secondCycle)).toEqual(new Set(firstCycle));
  },
);

test("resumes the unfinished boundary of a legacy v2 deck", () => {
  const entries = Array.from({ length: 20 }, (_, i) => entry(`legacy-${i}`));
  const previousIds = entries.map(({ id }) => id);
  const deck = {
    ...blank(),
    remainingIds: ["legacy-10", ...previousIds.filter((id) => id !== "legacy-10" && id !== "legacy-0")],
    seenIds: ["legacy-0"],
    recentTailIds: [...previousIds.slice(-19), "legacy-0"],
    cycleNumber: 1,
  };
  const result = drawFromDeck(
    deck,
    new Map(entries.map((item) => [item.id, item])),
    { mode: "wildcard", topics: [] },
    () => 0,
  );
  expect(result.entry.id).toBe("legacy-1");
});

test("one and two item pools keep drawing indefinitely", () => {
  for (const count of [1, 2]) {
    const entries = Array.from({ length: count }, (_, i) => entry(`small-${count}-${i}`));
    let deck = reconcileDeck(blank(), entries, [], () => 0);
    for (let i = 0; i < 12; i++) {
      const result = drawFromDeck(deck, new Map(entries.map((item) => [item.id, item])), { mode: "wildcard", topics: [] }, () => 0);
      expect(entries.map((item) => item.id)).toContain(result.entry.id);
      deck = result.deck;
    }
  }
});

test("diversity penalties select a different structural type without repeating seen ids", () => {
  const same = { ...entry("same-type"), topics: ["art"] as CatalogueEntry["topics"] };
  const alternate = { ...entry("different-type"), topics: ["science"] as CatalogueEntry["topics"] };
  const deck = {
    ...blank(), remainingIds: [same.id, alternate.id], catalogueFingerprint: "active",
  };
  const result = drawFromDeck(
    deck,
    new Map([[same.id, same], [alternate.id, alternate]]),
    { mode: "wildcard", topics: [], recentTypes: ["art"] },
    () => 0.5,
  );
  expect(result.entry.id).toBe(alternate.id);
  expect(result.deck.remainingIds).toEqual([same.id]);
});
