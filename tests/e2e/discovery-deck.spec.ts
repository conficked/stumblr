import { expect, test } from "@playwright/test";
import { getCatalogue } from "../../src/lib/catalogue";
import type { ClientState } from "../../src/lib/storage/schema";

test.describe.configure({ mode: "serial" });

const STORAGE_KEY = "stumblr:v1";

async function clickNext(page: import("@playwright/test").Page) {
  const mobileDock = page.getByRole("navigation", { name: "Mobile controls" });
  const isMobile = await mobileDock.isVisible();
  const button = isMobile
    ? mobileDock.getByRole("button", { name: "Stumbl", exact: true })
    : page.locator("button[aria-label='Stumbl']:visible").first();
  await expect(button).toBeVisible();
  await expect(button).toBeEnabled();
  // The Next.js dev-indicator portal overlaps the mobile dock in local dev.
  await page.evaluate(() => {
    const portal = document.querySelector("nextjs-portal");
    if (portal instanceof HTMLElement) portal.style.pointerEvents = "none";
  });
  const frame = page.locator("iframe[title^='Destination:']");
  const currentTitle = await frame.count() ? await frame.getAttribute("title") : null;
  await button.click({ force: isMobile });
  await page.waitForTimeout(350);
  await expect(frame).toBeAttached();
  if (currentTitle) await expect(frame).not.toHaveAttribute("title", currentTitle);
  return (await frame.getAttribute("title"))?.replace("Destination: ", "") ?? "";
}

async function clearFixtureState(page: import("@playwright/test").Page) {
  await page.goto("/fixtures-lab");
  await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
  await page.reload();
}

async function readClientState(page: import("@playwright/test").Page) {
  const state = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STORAGE_KEY);
  return state as ClientState;
}

async function pickTopic(page: import("@playwright/test").Page, topic: string) {
  const desktopPreferences = page.locator("button[aria-label='Open topics']:visible").first();
  let scope: import("@playwright/test").Page | import("@playwright/test").Locator = page;
  if (await desktopPreferences.isVisible().catch(() => false)) {
    await desktopPreferences.click();
    scope = page.locator("[role='dialog']").filter({ hasText: "Choose what you want to stumble into." }).last();
  } else {
    await page.locator("button[aria-label='Open utility menu']:visible").first().click();
    const menuDialog = page.locator("[role='dialog']").last();
    await menuDialog.getByRole("tab", { name: "Topics" }).click();
    scope = menuDialog;
  }
  await scope.getByRole("button", { name: topic }).first().click();
  await page.keyboard.press("Escape");
}

async function openHistory(page: import("@playwright/test").Page) {
  const desktopHistory = page.locator("button[aria-label='Open history']:visible").first();
  if (await desktopHistory.isVisible().catch(() => false)) {
    await desktopHistory.click();
    const dialog = page.getByRole("dialog").last();
    return dialog.getByRole("button", { name: "Reset discovery history" }).locator("xpath=../..");
  }
  await page.locator("button[aria-label='Open utility menu']:visible").first().click();
  const menu = page.getByRole("dialog").last();
  await menu.getByRole("tab", { name: "History" }).click();
  return menu.getByRole("button", { name: "Reset discovery history" }).locator("xpath=../..");
}

test("desktop and mobile keep two deterministic cycles unique, separated, and resumable", async ({ page }) => {
  await clearFixtureState(page);
  const sequence: string[] = [];

  for (let index = 0; index < 7; index += 1) sequence.push(await clickNext(page));
  await page.reload();
  for (let index = 0; index < 5; index += 1) sequence.push(await clickNext(page));

  expect(sequence).toHaveLength(12);
  const firstCycle = sequence.slice(0, 6);
  const secondCycle = sequence.slice(6, 12);
  expect(new Set(firstCycle).size).toBe(firstCycle.length);
  expect(new Set(secondCycle).size).toBe(secondCycle.length);
  expect(new Set(firstCycle)).toEqual(new Set(secondCycle));

  // The six-entry fixture uses the sampler's proportional half-pool boundary.
  const boundaryDistance = Math.floor(firstCycle.length / 2);
  const forbidden = firstCycle.slice(-boundaryDistance);
  expect(secondCycle.slice(0, boundaryDistance).filter((id) => forbidden.includes(id))).toEqual([]);
});

test("a v1 history record seeds the first deck draw and migrates to v2", async ({ page }) => {
  await page.addInitScript(() => {
    if (window !== window.top) return;
    window.localStorage.setItem("stumblr:v1", JSON.stringify({
      version: 1,
      preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
      samplerSeed: 17,
      excludedIds: [],
      saves: [],
      history: [{
        id: "fixture-ok-a",
        title: "Fixture OK A",
        canonicalUrl: "/fixtures/ok",
        domain: "fixtures.local",
        seenAt: "2026-11-08T00:00:00.000Z",
      }],
      reports: [],
    }));
  });
  await page.goto("/fixtures-lab");

  const firstDraw = await clickNext(page);
  expect(firstDraw).not.toBe("Fixture OK A");
  const migrated = await page.evaluate((key) => JSON.parse(window.localStorage.getItem(key) ?? "null"), STORAGE_KEY) as {
    version: number;
    history: Array<{ id: string }>;
    discoveryDecks: { migrationRecentIds: string[] };
  };
  expect(migrated.version).toBe(2);
  expect(migrated.history.map((item) => item.id)).toContain("fixture-ok-a");
  expect(migrated.discoveryDecks.migrationRecentIds).toEqual([]);
});

test("selected-topic cycles stay unique and separate their boundary", async ({ page }) => {
  await clearFixtureState(page);
  await page.evaluate((key) => window.localStorage.setItem(key, JSON.stringify({
    version: 2,
    preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
    samplerSeed: 3,
    excludedIds: [], saves: [], history: [], reports: [],
    discoveryDecks: { scopes: {}, migrationRecentIds: [] },
  })), STORAGE_KEY);
  await page.reload();
  await pickTopic(page, "science");
  const sequence: string[] = [];
  for (let index = 0; index < 6; index += 1) sequence.push(await clickNext(page));

  expect(new Set(sequence.slice(0, 3)).size).toBe(3);
  expect(new Set(sequence.slice(3, 6)).size).toBe(3);
  expect(new Set(sequence.slice(0, 3))).toEqual(new Set(sequence.slice(3, 6)));
  expect(sequence.slice(2, 3)).not.toContain(sequence[3]);

  await clickNext(page);
  const notice = page.getByRole("status");
  await expect(notice.getByText("New cycle")).toBeVisible();
  const preferencesBeforeBroadening = await readClientState(page);
  expect(preferencesBeforeBroadening.preferences.topics).toEqual(["science"]);
  await expect(page.locator("iframe[title^='Destination:']")).toBeAttached();

  await notice.getByRole("button", { name: "Broaden topics" }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  const broadened = await readClientState(page);
  expect(broadened.preferences.topics).toEqual([]);

  await clickNext(page);
  const broadenedDestination = await page.getByRole("link", { name: "Open original" }).getAttribute("href");
  expect(broadenedDestination).toMatch(/^\/fixtures\/(?:blocked|timeout|error)/);
});

test("removing history preserves the deck while reset clears the visible log", async ({ page }) => {
  await clearFixtureState(page);
  const firstCycle: string[] = [];
  for (let index = 0; index < 3; index += 1) firstCycle.push(await clickNext(page));

  const history = await openHistory(page);
  const removedTitle = firstCycle[1];
  const stateBeforeRemoval = await readClientState(page);
  await history.getByRole("listitem").filter({ hasText: removedTitle }).getByRole("button", { name: `Remove ${removedTitle}` }).click();
  await expect(history.getByRole("listitem").filter({ hasText: removedTitle })).toHaveCount(0);
  const stateAfterRemoval = await readClientState(page);
  expect(stateAfterRemoval.discoveryDecks).toEqual(stateBeforeRemoval.discoveryDecks);
  expect(stateAfterRemoval.history).toHaveLength(stateBeforeRemoval.history.length - 1);
  await page.keyboard.press("Escape");

  for (let index = 0; index < 3; index += 1) firstCycle.push(await clickNext(page));
  expect(new Set(firstCycle).size).toBe(6);

  await page.locator("button[aria-label='Like']:visible").first().click({ force: true });
  // Like and Not for me cancel each other on one entry, so dislike the next one.
  firstCycle.push(await clickNext(page));
  await page.locator("button[aria-label='Not for me']:visible").first().click({ force: true });
  await pickTopic(page, "science");

  const desktopReport = page.locator("button[aria-label='Open report']:visible").first();
  let reportScope: import("@playwright/test").Page | import("@playwright/test").Locator = page;
  if (await desktopReport.isVisible().catch(() => false)) {
    await desktopReport.click();
    reportScope = page.getByRole("dialog").last();
  } else {
    await page.locator("button[aria-label='Open utility menu']:visible").first().click();
    reportScope = page.getByRole("dialog").last();
    await reportScope.getByRole("tab", { name: "Report" }).click();
  }
  await reportScope.locator("textarea#report-note").fill("Reset preservation fixture report.");
  await reportScope.getByRole("button", { name: "Send report" }).click();
  await expect(reportScope.locator("li", { hasText: "Broken site" })).toBeVisible();
  await page.keyboard.press("Escape");

  const stateBeforeReset = await readClientState(page);
  expect(stateBeforeReset.preferences.topics).toEqual(["science"]);
  expect(stateBeforeReset.saves.length).toBeGreaterThan(0);
  expect(stateBeforeReset.excludedIds).toContain(stateBeforeReset.history.at(-1)?.id);
  expect(stateBeforeReset.reports).toHaveLength(1);

  const historyAfterRemoval = await openHistory(page);
  await expect(historyAfterRemoval.locator("ul > li")).toHaveCount(stateBeforeReset.history.length);
  await historyAfterRemoval.getByRole("button", { name: "Reset discovery history" }).click();
  await expect(historyAfterRemoval.getByText("No history yet. Press Stumbl to start exploring.")).toBeVisible();
  await expect(historyAfterRemoval.locator("ul > li")).toHaveCount(0);
  const stateAfterReset = await readClientState(page);
  expect(stateAfterReset.history).toEqual([]);
  expect(stateAfterReset.discoveryDecks).toEqual({ scopes: {}, migrationRecentIds: [] });
  expect(stateAfterReset.preferences).toEqual(stateBeforeReset.preferences);
  expect(stateAfterReset.saves).toEqual(stateBeforeReset.saves);
  expect(stateAfterReset.excludedIds).toEqual(stateBeforeReset.excludedIds);
  expect(stateAfterReset.reports).toEqual(stateBeforeReset.reports);
});

const runtimeAddition = {
  id: "e2e-runtime-addition",
  title: "E2E Runtime Addition",
  canonicalUrl: "https://runtime-addition.example/",
  domain: "runtime-addition.example",
  topics: ["science"],
  description: "A deterministic runtime catalogue fixture.",
  status: "evaluation_only",
  policyBasis: null,
  provenance: { sourceNote: "E2E fixture", reviewer: "Playwright", reviewedAt: "2026-11-08T00:00:00.000Z" },
  embedEvidence: { observedHeaders: "E2E fixture", observedRenderResult: "rendered", observedAt: "2026-11-08T00:00:00.000Z", device: "desktop" },
};

test("the first ten draws avoid the prior cycle's last ten across a reload", async ({ page }) => {
  const entries = Array.from({ length: 20 }, (_, index) => {
    const domain = `e2e-cycle-${index}.example`;
    return { ...runtimeAddition, id: `e2e-cycle-${index}`, title: `Cycle ${index}`, domain, canonicalUrl: `https://${domain}/` };
  });
  const priorIds = entries.map(({ id }) => id);
  const scope = JSON.stringify({ mode: "wildcard", topics: [], includeEvaluation: true });
  const bundledIds = getCatalogue({ includeEvaluation: true }).map(({ id }) => id);
  await page.addInitScript(({ scope, priorIds, bundledIds }) => {
    if (window !== window.top || window.localStorage.getItem("stumblr:v1")) return;
    window.localStorage.setItem("stumblr:v1", JSON.stringify({
      version: 2,
      preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
      samplerSeed: 12,
      excludedIds: bundledIds, saves: [], history: [], reports: [],
      discoveryDecks: {
        migrationRecentIds: [],
        scopes: { [scope]: {
          remainingIds: [], seenIds: priorIds, recentTailIds: priorIds.slice(-10),
          catalogueFingerprint: [...priorIds].sort().join("\u001f"), cycleNumber: 0, lastUsedAt: 1,
        } },
      },
    }));
  }, { scope, priorIds, bundledIds });
  await page.route("**/api/catalogue", (route) => route.fulfill({ json: { entries } }));
  await page.route("https://e2e-cycle-*.example/**", (route) => route.fulfill({ body: "Boundary fixture" }));
  await page.goto("/");
  const drawn: string[] = [];
  for (let index = 0; index < 10; index++) {
    if (index === 4) await page.reload();
    drawn.push(await clickNext(page));
  }
  const allowed = entries.slice(0, 10).map(({ title }) => title);
  expect([...drawn].sort()).toEqual(allowed.sort());
});

test("a runtime catalogue addition joins the active cycle before any entry is recycled", async ({ page }) => {
  let publishAddition = false;
  await page.route("**/api/catalogue", async (route) => {
    await route.fulfill({
      status: 200,
      json: {
        entries: publishAddition ? [runtimeAddition] : [],
      },
    });
  });
  await page.goto("/");
  await pickTopic(page, "science");

  const seen = new Set<string>();
  for (let index = 0; index < 3; index += 1) seen.add(await clickNext(page));

  publishAddition = true;
  await page.reload();
  let addedEntrySeen = false;
  for (let index = 0; index < 80; index += 1) {
    const title = await clickNext(page);
    if (title === "E2E Runtime Addition") {
      addedEntrySeen = true;
      break;
    }
    expect(seen.has(title), `entry recycled before runtime addition: ${title}`).toBe(false);
    seen.add(title);
  }
  expect(addedEntrySeen).toBe(true);
});

test("waiting for the runtime catalogue preserves an already seen runtime entry", async ({ page }) => {
  const scope = JSON.stringify({ mode: "wildcard", topics: [], includeEvaluation: true });
  const deck = {
    remainingIds: [], seenIds: [runtimeAddition.id], recentTailIds: [runtimeAddition.id],
    catalogueFingerprint: runtimeAddition.id, cycleNumber: 0, lastUsedAt: 1,
  };
  await page.addInitScript(({ scope, deck }) => {
    if (window !== window.top) return;
    window.localStorage.setItem("stumblr:v1", JSON.stringify({
      version: 2,
      preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
      samplerSeed: 12,
      excludedIds: [], saves: [], history: [], reports: [],
      discoveryDecks: { scopes: { [scope]: deck }, migrationRecentIds: [] },
    }));
  }, { scope, deck });
  const pending = Promise.withResolvers<void>();
  await page.route("**/api/catalogue", async (route) => {
    await pending.promise;
    await route.fulfill({ status: 200, json: { entries: [runtimeAddition] } });
  });
  const request = page.waitForRequest("**/api/catalogue");
  await page.goto("/");
  await request;
  try {
    const stumbl = page.locator("button[aria-label='Stumbl']:visible").first();
    await stumbl.evaluate((button: HTMLButtonElement) => button.click());
    await expect(stumbl).toBeDisabled({ timeout: 1000 });
    const beforeResolution = await readClientState(page);
    expect(beforeResolution.history).toEqual([]);
    expect(beforeResolution.discoveryDecks.scopes[scope]).toEqual(deck);
  } finally {
    pending.resolve();
  }

  expect(await clickNext(page)).not.toBe(runtimeAddition.title);
  const resolved = await readClientState(page);
  expect(resolved.history).toHaveLength(1);
  const activeDeck = resolved.discoveryDecks.scopes[scope];
  expect(activeDeck.cycleNumber).toBe(0);
  expect(activeDeck.seenIds).toEqual([runtimeAddition.id, resolved.history[0].id]);
  expect(activeDeck.remainingIds).not.toContain(runtimeAddition.id);
});

for (const failure of ["network failure", "invalid schema", "stalled response"]) {
  test(`a catalogue ${failure} allows bundled draws and preserves runtime progress on reload`, async ({ page }) => {
    const bundled = getCatalogue({ includeEvaluation: true });
    const [first, second] = bundled;
    const excludedIds = bundled.slice(2).map(({ id }) => id);
    const remaining = {
      ...runtimeAddition, id: "e2e-runtime-remaining", title: "E2E Runtime Remaining",
      domain: "runtime-remaining.example", canonicalUrl: "https://runtime-remaining.example/",
    };
    const scope = JSON.stringify({ mode: "wildcard", topics: [], includeEvaluation: true });
    const deck = {
      remainingIds: [first.id, second.id, remaining.id],
      seenIds: [runtimeAddition.id], recentTailIds: [runtimeAddition.id],
      catalogueFingerprint: "fixture", cycleNumber: 3, lastUsedAt: 1,
    };
    await page.addInitScript(({ scope, deck, excludedIds }) => {
      if (window !== window.top || window.localStorage.getItem("stumblr:v1")) return;
      window.localStorage.setItem("stumblr:v1", JSON.stringify({
        version: 2,
        preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
        samplerSeed: 12,
        excludedIds, saves: [], history: [], reports: [],
        discoveryDecks: { scopes: { [scope]: deck }, migrationRecentIds: [] },
      }));
    }, { scope, deck, excludedIds });

    let recovered = false;
    const stalled = Promise.withResolvers<void>();
    if (failure === "stalled response") await page.clock.install();
    await page.route("**/api/catalogue", async (route) => {
      if (recovered) {
        await route.fulfill({ json: { entries: [runtimeAddition, remaining] } });
      } else if (failure === "stalled response") {
        await stalled.promise;
      } else if (failure === "invalid schema") {
        await route.fulfill({ json: { entries: [null] } });
      } else {
        await route.abort();
      }
    });
    const request = page.waitForRequest("**/api/catalogue");
    await page.goto("/");
    await request;
    try {
      if (failure === "stalled response") {
        const stumbl = page.locator("button[aria-label='Stumbl']:visible").first();
        await expect(stumbl).toBeDisabled();
        await page.clock.fastForward(3_001);
        await expect(stumbl).toBeEnabled({ timeout: 1_500 });
      }
      expect([first.title, second.title]).toContain(await clickNext(page));
      const fallback = await readClientState(page);
      const fallbackDeck = fallback.discoveryDecks.scopes[scope];
      expect(fallbackDeck.seenIds).toEqual([runtimeAddition.id, fallback.history[0].id]);
      expect(fallbackDeck.remainingIds).toContain(remaining.id);
    } finally {
      stalled.resolve();
    }

    recovered = true;
    await page.reload();
    const next = await clickNext(page);
    const last = await clickNext(page);
    expect([next, last]).toContain(remaining.title);
    const final = await readClientState(page);
    expect(final.history.map(({ id }) => id).sort()).toEqual([first.id, second.id, remaining.id].sort());
    expect(final.discoveryDecks.scopes[scope].cycleNumber).toBe(3);
    expect(final.discoveryDecks.scopes[scope].seenIds.filter((id) => id === runtimeAddition.id)).toEqual([runtimeAddition.id]);
  });
}

test("a boundary-protected fallback draw leaves the recovered runtime entry first", async ({ page }) => {
  const [bundled, ...otherBundled] = getCatalogue({ includeEvaluation: true });
  const excludedIds = otherBundled.map(({ id }) => id);
  const scope = JSON.stringify({ mode: "wildcard", topics: [], includeEvaluation: true });
  const deck = {
    remainingIds: [bundled.id, runtimeAddition.id], seenIds: [], recentTailIds: [bundled.id],
    catalogueFingerprint: "fixture", cycleNumber: 3, lastUsedAt: 1,
    cycleBoundary: { priorIds: [bundled.id], drawsRemaining: 1 },
  };
  await page.addInitScript(({ scope, deck, excludedIds }) => {
    if (window !== window.top || window.localStorage.getItem("stumblr:v1")) return;
    window.localStorage.setItem("stumblr:v1", JSON.stringify({
      version: 2,
      preferences: { topics: [], mode: "wildcard", includeEvaluationPool: true },
      samplerSeed: 12,
      excludedIds, saves: [], history: [], reports: [],
      discoveryDecks: { scopes: { [scope]: deck }, migrationRecentIds: [] },
    }));
  }, { scope, deck, excludedIds });
  let recovered = false;
  await page.route("**/api/catalogue", (route) => recovered
    ? route.fulfill({ json: { entries: [runtimeAddition] } })
    : route.abort());
  await page.goto("/");

  expect(await clickNext(page)).toBe(bundled.title);
  const fallbackDeck = (await readClientState(page)).discoveryDecks.scopes[scope];
  expect(fallbackDeck).toMatchObject({
    remainingIds: deck.remainingIds, seenIds: [], cycleNumber: 3, cycleBoundary: deck.cycleBoundary,
  });

  recovered = true;
  await page.reload();
  expect(await clickNext(page)).toBe(runtimeAddition.title);
  expect(await clickNext(page)).toBe(bundled.title);
  const resumed = (await readClientState(page)).discoveryDecks.scopes[scope];
  expect(resumed).toMatchObject({
    remainingIds: [], seenIds: [runtimeAddition.id, bundled.id], cycleNumber: 3, cycleBoundary: null,
  });
});
