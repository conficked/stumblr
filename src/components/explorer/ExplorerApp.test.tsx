import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getCatalogue } from "@/lib/catalogue";
import type { CatalogueEntry } from "@/lib/catalogue/types";
import { normalizeDeckScope } from "@/lib/sampler/discoveryDeck";
import { loadClientState, resetClientState, writeClientState } from "@/lib/storage/localStore";
import { DEFAULT_STATE } from "@/lib/storage/schema";
import { ExplorerApp } from "./ExplorerApp";

beforeEach(() => {
  resetClientState();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("Like stores entry without marking notForMe signal", async () => {
  const user = userEvent.setup();
  render(<ExplorerApp catalogueOverride={getCatalogue({ includeEvaluation: true })} />);

  await user.click(screen.getAllByRole("button", { name: /^stumbl$/i })[0]);
  await user.click(screen.getAllByRole("button", { name: /^like$/i })[0]);

  expect(screen.getAllByText(/added to liked/i).length).toBeGreaterThan(0);
  expect(screen.queryByText(/not for me recorded/i)).not.toBeInTheDocument();
});

test("creates the session seed on the first Stumbl interaction, not during render", async () => {
  const user = userEvent.setup();
  const getRandomValues = vi.spyOn(globalThis.crypto, "getRandomValues");

  render(<ExplorerApp catalogueOverride={getCatalogue({ includeEvaluation: true })} />);

  expect(getRandomValues).not.toHaveBeenCalled();

  await user.click(screen.getAllByRole("button", { name: /^stumbl$/i })[0]);

  expect(JSON.parse(window.localStorage.getItem("stumblr:v1") ?? "null").samplerSeed).toEqual(
    expect.any(Number),
  );
});

test("does not expose pool counts while retaining evaluation disclosure", () => {
  const catalogueOverride = Array.from({ length: 73 }, (_, index) => ({
    id: `private-${index}`,
    title: `Private ${index}`,
    canonicalUrl: `https://example${index}.org/`,
    domain: `example${index}.org`,
    topics: ["culture" as const],
    description: "Private evaluation fixture.",
    status: "evaluation_only" as const,
    policyBasis: null,
    provenance: { sourceNote: "fixture", reviewer: "test", reviewedAt: "2026-11-08" },
    embedEvidence: {
      observedHeaders: "fixture",
      observedRenderResult: "untested" as const,
      observedAt: "2026-11-08",
      device: "desktop" as const,
    },
  }));

  render(<ExplorerApp catalogueOverride={catalogueOverride} />);

  expect(screen.queryByText(/73\s+eligible/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/pool:\s*73/i)).not.toBeInTheDocument();
  expect(screen.getAllByText(/evaluation pool/i).length).toBeGreaterThan(0);
});

test("uses approved tagline and removes the notice strip", () => {
  render(<ExplorerApp catalogueOverride={getCatalogue({ includeEvaluation: true })} />);
  expect(screen.getAllByRole("heading", { name: "Stumblr" }).length).toBeGreaterThan(0);
  expect(screen.getAllByText("Explore the internet as your forefathers intended").length).toBeGreaterThan(0);
  expect(screen.getAllByText("Press Stumbl to begin.").length).toBeGreaterThan(0);
  expect(screen.queryByText("Private evaluation content is not launch-qualified.")).not.toBeInTheDocument();
  expect(screen.queryByText("Destination sites may track visitors independently.")).not.toBeInTheDocument();
});

test("persists the active discovery deck as each Stumbl is recorded", async () => {
  const user = userEvent.setup();
  const catalogueOverride = Array.from({ length: 3 }, (_, index) => ({
    id: `deck-${index}`, title: `Deck ${index}`, canonicalUrl: `https://deck${index}.example/`,
    domain: `deck${index}.example`, topics: ["culture" as const], description: "Fixture",
    status: "evaluation_only" as const, policyBasis: null,
    provenance: { sourceNote: "fixture", reviewer: "test", reviewedAt: "2026-11-08" },
    embedEvidence: { observedHeaders: "fixture", observedRenderResult: "untested" as const, observedAt: "2026-11-08", device: "desktop" as const },
  }));
  render(<ExplorerApp catalogueOverride={catalogueOverride} />);

  await user.click(screen.getAllByRole("button", { name: /^stumbl$/i })[0]);

  await waitFor(() => {
    const state = JSON.parse(window.localStorage.getItem("stumblr:v1") ?? "null");
    expect(Object.keys(state.discoveryDecks.scopes)).toHaveLength(1);
    const activeDeck = Object.values(state.discoveryDecks.scopes)[0] as { recentTailIds: string[] };
    expect(activeDeck.recentTailIds.length).toBeGreaterThan(0);
  });
});

test.each(["structural type", "source cluster"])("the next Stumbl uses recent %s after History removal and reload", async (dimension) => {
  const user = userEvent.setup();
  const [base] = getCatalogue({ includeEvaluation: true });
  const entries = ["first", "repeat-characteristic", "alternate"].map((id, index): CatalogueEntry => ({
    ...base, id, title: id, canonicalUrl: `https://${id}.example/`, domain: `${id}.example`,
    topics: dimension === "structural type" && index === 2 ? ["science"] : ["art"],
    provenance: { ...base.provenance, sourceNote: dimension === "source cluster" && index === 2 ? "discovered" : "fixture" },
  }));
  const scope = normalizeDeckScope({ mode: "wildcard", topics: [], includeEvaluation: true });
  const seeded = structuredClone(DEFAULT_STATE);
  // With this seed the first candidate wins at equal weights, but a recent penalty makes the alternate win.
  seeded.samplerSeed = 12;
  seeded.discoveryDecks.scopes[scope] = {
    remainingIds: ["first", "repeat-characteristic", "alternate"],
    seenIds: [], recentTailIds: [], catalogueFingerprint: "fixture", cycleNumber: 0, lastUsedAt: 1,
  };
  writeClientState(seeded);
  const { unmount } = render(<ExplorerApp catalogueOverride={entries} />);
  const stumbl = () => user.click(screen.getAllByRole("button", { name: /^stumbl$/i })[0]);

  await stumbl();
  expect(screen.getByTestId("active-entry-title")).toHaveTextContent(/^first$/);
  await user.click(screen.getByRole("button", { name: "Open history" }));
  await user.click(screen.getByRole("button", { name: "Remove first" }));
  expect(loadClientState().history).toEqual([]);
  unmount();

  render(<ExplorerApp catalogueOverride={entries} />);
  await stumbl();
  expect(screen.getByTestId("active-entry-title")).toHaveTextContent(/^alternate$/);
  await stumbl();
  expect(screen.getByTestId("active-entry-title")).toHaveTextContent(/^repeat-characteristic$/);
  expect(loadClientState().discoveryDecks.scopes[scope].seenIds).toEqual(["first", "alternate", "repeat-characteristic"]);
});

test.each(["network failure", "invalid JSON", "invalid schema", "stalled response"])(
  "preserves runtime deck progress after %s and a healthy reload",
  async (failure) => {
    vi.useFakeTimers();
    const entries = getCatalogue({ includeEvaluation: true });
    const [bundled, otherBundled] = entries;
    const runtimeEntries = ["runtime-seen", "runtime-remaining"].map((id) => ({
      ...bundled, id, title: id, canonicalUrl: `https://${id}.example/`, domain: `${id}.example`,
      status: "evaluation_only", policyBasis: null,
      provenance: { sourceNote: "runtime fixture", reviewer: "test", reviewedAt: "2026-11-08T00:00:00.000Z" },
      embedEvidence: { observedHeaders: "fixture", observedRenderResult: "rendered", observedAt: "2026-11-08T00:00:00.000Z", device: "desktop" },
    }));
    const [seen, remaining] = runtimeEntries;
    const scope = normalizeDeckScope({ mode: "wildcard", topics: [], includeEvaluation: true });
    const state = structuredClone(DEFAULT_STATE);
    state.samplerSeed = 12;
    state.excludedIds = entries.slice(2).map(({ id }) => id);
    state.discoveryDecks.scopes[scope] = {
      remainingIds: [bundled.id, otherBundled.id, remaining.id],
      seenIds: [seen.id], recentTailIds: [seen.id], catalogueFingerprint: "fixture", cycleNumber: 4, lastUsedAt: 1,
    };
    writeClientState(state);

    const fetchCatalogue = vi.fn<typeof fetch>();
    const stalled = Promise.withResolvers<Response>();
    if (failure === "network failure") fetchCatalogue.mockRejectedValueOnce(new Error("unavailable"));
    if (failure === "invalid JSON") fetchCatalogue.mockResolvedValueOnce(new Response("{"));
    if (failure === "invalid schema") fetchCatalogue.mockResolvedValueOnce(Response.json({ entries: [null] }));
    if (failure === "stalled response") fetchCatalogue.mockReturnValueOnce(stalled.promise);
    vi.stubGlobal("fetch", fetchCatalogue);
    const { unmount } = render(<ExplorerApp />);
    const stumbl = () => screen.getAllByRole("button", { name: /^stumbl$/i })[0];

    await act(async () => {
      if (failure === "stalled response") await vi.advanceTimersByTimeAsync(3_001);
    });
    expect(stumbl()).toBeEnabled();
    if (failure === "stalled response") {
      expect(fetchCatalogue.mock.calls[0][1]?.signal?.aborted).toBe(true);
      await act(async () => stalled.resolve(Response.json({ entries: runtimeEntries })));
    }
    fireEvent.click(stumbl());
    const fallback = loadClientState();
    expect(fallback.history).toHaveLength(1);
    const fallbackId = fallback.history[0].id;
    expect([bundled.id, otherBundled.id]).toContain(fallbackId);
    expect(fallback.discoveryDecks.scopes[scope].seenIds).toEqual([seen.id, fallbackId]);
    expect(fallback.discoveryDecks.scopes[scope].remainingIds).toContain(remaining.id);

    unmount();
    fetchCatalogue.mockResolvedValueOnce(Response.json({ entries: runtimeEntries }));
    render(<ExplorerApp />);
    await act(async () => {});
    expect(stumbl()).toBeEnabled();
    fireEvent.click(stumbl());
    fireEvent.click(stumbl());

    const recovered = loadClientState();
    expect(recovered.history.map(({ id }) => id).sort()).toEqual([bundled.id, otherBundled.id, remaining.id].sort());
    const recoveredDeck = recovered.discoveryDecks.scopes[scope];
    expect(recoveredDeck.cycleNumber).toBe(4);
    expect(recoveredDeck.remainingIds).toEqual([]);
    expect(recoveredDeck.seenIds.filter((id) => id === seen.id)).toEqual([seen.id]);
  },
);
