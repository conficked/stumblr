"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Image from "next/image";
import { Clock3, Flag, Link2, Menu, Tags, ThumbsUp } from "lucide-react";
import { getCatalogue } from "@/lib/catalogue";
import { runtimeCatalogueSchema } from "@/lib/catalogue/runtimeSchema";
import { CatalogueEntry, Topic } from "@/lib/catalogue/types";
import {
  exportClientState,
  loadClientState,
  resetDiscoveryState,
  writeClientState,
} from "@/lib/storage/localStore";
import { ClientState, DEFAULT_STATE, EntrySnapshot, MAX_DISCOVERY_SCOPES, MAX_HISTORY_SNAPSHOTS } from "@/lib/storage/schema";
import { createSampler, MAX_SAMPLER_HISTORY, sourceCluster, structuralType, type SamplerMode, type SamplerState } from "@/lib/sampler/createSampler";
import { normalizeDeckScope } from "@/lib/sampler/discoveryDeck";
import { Drawer } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { BottomDock } from "./BottomDock";
import { TopControls } from "./TopControls";
import { HistoryDrawer } from "./HistoryDrawer";
import { SavesDrawer } from "./SavesDrawer";
import { ReportDrawer } from "./ReportDrawer";
import { PreferencesDrawer } from "./PreferencesDrawer";
import { SuggestionDrawer } from "./SuggestionDrawer";
import { ExhaustedState, FrameHost } from "../frame-host/FrameHost";
import { createFrameCycle } from "../frame-host/useFrameCycle";

function createExplorationSeed(): number {
  if (typeof crypto !== "undefined" && "getRandomValues" in crypto) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] >>> 0;
  }
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function toSnapshot(entry: CatalogueEntry): EntrySnapshot {
  return {
    id: entry.id,
    title: entry.title,
    canonicalUrl: entry.canonicalUrl,
    domain: entry.domain,
    seenAt: new Date().toISOString(),
  };
}

function hydrate(): ClientState {
  if (typeof window === "undefined") {
    return structuredClone(DEFAULT_STATE);
  }
  return loadClientState();
}

type ExplorerAppProps = {
  catalogueOverride?: CatalogueEntry[];
  modeLabel?: string;
};

type RuntimeCatalogue =
  | { kind: "pending" }
  | { kind: "fallback" }
  | { kind: "ready"; entries: CatalogueEntry[] };

const CATALOGUE_DEADLINE_MS = 3_000;

// Chosen topics are a filter; with none chosen, everything is in play.
function samplerModeFor(topics: readonly Topic[]): SamplerMode {
  return topics.length > 0 ? "topic" : "wildcard";
}

type MenuTab = "topics" | "liked" | "history" | "suggest" | "report";
const MENU_TABS: ReadonlyArray<readonly [MenuTab, string]> = [
  ["topics", "Topics"], ["liked", "Liked"], ["history", "History"], ["suggest", "Suggest"], ["report", "Report"],
];

export function ExplorerApp({ catalogueOverride, modeLabel }: ExplorerAppProps) {
  const [runtimeCatalogue, setRuntimeCatalogue] = useState<RuntimeCatalogue>({ kind: "pending" });
  useEffect(() => {
    if (catalogueOverride) return;
    const controller = new AbortController();
    const deadline = window.setTimeout(() => {
      controller.abort();
      setRuntimeCatalogue({ kind: "fallback" });
    }, CATALOGUE_DEADLINE_MS);
    const applyFallback = () => {
      if (!controller.signal.aborted) setRuntimeCatalogue({ kind: "fallback" });
    };
    fetch("/api/catalogue", { cache: "no-store", signal: controller.signal })
      .then((response) => response.ok ? response.json() : null)
      .then((data) => {
        if (controller.signal.aborted) return;
        const result = runtimeCatalogueSchema.safeParse(data);
        if (result.success) setRuntimeCatalogue({ kind: "ready", entries: result.data.entries });
        else applyFallback();
      })
      .catch(applyFallback)
      .finally(() => window.clearTimeout(deadline));
    return () => {
      window.clearTimeout(deadline);
      controller.abort();
    };
  }, [catalogueOverride]);
  const [clientState, setClientState] = useState<ClientState>(hydrate);
  const [activeEntry, setActiveEntry] = useState<CatalogueEntry | null>(null);
  const [token, setToken] = useState(0);
  const [phase, setPhase] = useState<
    "idle" | "loading" | "ready" | "timeout" | "blocked" | "error" | "exhausted"
  >("idle");
  const [note, setNote] = useState<string | null>(null);
  const [openHistory, setOpenHistory] = useState(false);
  const [openSaves, setOpenSaves] = useState(false);
  const [menuTab, setMenuTab] = useState<MenuTab>("topics");
  const [openReport, setOpenReport] = useState(false);
  const [openPrefs, setOpenPrefs] = useState(false);
  const [openUtility, setOpenUtility] = useState(false);
  const [openSuggest, setOpenSuggest] = useState(false);
  const [newCycleNotice, setNewCycleNotice] = useState(false);

  // Every destination is in the reviewed evaluation pool; launch-only is empty.
  const includeEvaluation = true;
  const usesRuntimeCatalogue = !catalogueOverride && includeEvaluation;
  const waitingForCatalogue = usesRuntimeCatalogue && runtimeCatalogue.kind === "pending";
  const preserveUnavailableIds = usesRuntimeCatalogue && runtimeCatalogue.kind === "fallback";

  const entries = useMemo(() => {
    if (catalogueOverride) return catalogueOverride;
    const bundled = getCatalogue({ includeEvaluation });
    if (!includeEvaluation || runtimeCatalogue.kind !== "ready") return bundled;
    return bundled.concat(runtimeCatalogue.entries.filter((item) =>
      !bundled.some((base) => base.id === item.id || base.canonicalUrl === item.canonicalUrl || base.domain === item.domain),
    ));
  }, [catalogueOverride, includeEvaluation, runtimeCatalogue]);

  const eligibleEntries = useMemo(
    () => entries.filter((entry) => !clientState.excludedIds.includes(entry.id)),
    [entries, clientState.excludedIds],
  );

  const frameCycle = useMemo(() => createFrameCycle(), []);

  const persist = useCallback((next: ClientState) => {
    setClientState(next);
    writeClientState(next);
  }, []);

  const toggleTopic = useCallback((topic: Topic) => {
    const { topics } = clientState.preferences;
    const next = topics.includes(topic) ? topics.filter((value) => value !== topic) : [...topics, topic];
    persist({ ...clientState, preferences: { ...clientState.preferences, topics: next } });
  }, [clientState, persist]);

  const clearTopics = useCallback(() => {
    persist({ ...clientState, preferences: { ...clientState.preferences, topics: [] } });
  }, [clientState, persist]);

  const applyNext = useCallback(() => {
    if (waitingForCatalogue) return;
    const explorationSeed = clientState.samplerSeed ?? createExplorationSeed();
    const withSeed: ClientState =
      clientState.samplerSeed == null
        ? { ...clientState, samplerSeed: explorationSeed }
        : clientState;
    const mode = samplerModeFor(withSeed.preferences.topics);
    const scope = normalizeDeckScope({
      mode,
      topics: withSeed.preferences.topics,
      includeEvaluation,
    });
    const oldDeck = withSeed.discoveryDecks.scopes[scope];
    const sampler = createSampler(explorationSeed, eligibleEntries, {
      mode,
      topics: withSeed.preferences.topics,
    }, {
      deck: oldDeck,
      preserveUnavailableIds,
      recentHistory: oldDeck ? [] : withSeed.discoveryDecks.migrationRecentIds,
    });
    const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
    const previousIds = oldDeck?.recentTailIds ?? withSeed.discoveryDecks.migrationRecentIds;
    const previousEntries = previousIds.flatMap((id) => entriesById.get(id) ?? []).slice(-MAX_SAMPLER_HISTORY);
    const priorState: SamplerState = {
      seenIds: previousEntries.map((entry) => entry.id),
      seenDomains: previousEntries.map((entry) => entry.domain),
      recentTypes: previousEntries.map(structuralType),
      recentSourceClusters: previousEntries.map(sourceCluster),
      exhausted: false,
    };
    const result = sampler.next(priorState);
    if (result.kind === "exhausted") {
      const exhausted = frameCycle.setExhausted(
        withSeed.preferences.topics.length > 0
          ? "Try All topics or another interest to keep exploring."
          : "Try another category to keep exploring.",
      );
      setPhase(exhausted.phase);
      setNote(exhausted.note);
      if (withSeed !== clientState) persist(withSeed);
      return;
    }

    const startToken = frameCycle.startLoad(result.entry);
    const snapshot = toSnapshot(result.entry);
    const newestUse = Math.max(Date.now(), ...Object.values(withSeed.discoveryDecks.scopes).map(deck => deck.lastUsedAt + 1));
    const scopes = { ...withSeed.discoveryDecks.scopes, [scope]: { ...result.deck, lastUsedAt: newestUse } };
    const retainedScopes = Object.fromEntries(Object.entries(scopes)
      .sort((a, b) => b[1].lastUsedAt - a[1].lastUsedAt).slice(0, MAX_DISCOVERY_SCOPES));
    const nextState: ClientState = {
      ...withSeed,
      history: [...withSeed.history, snapshot].slice(-MAX_HISTORY_SNAPSHOTS),
      discoveryDecks: {
        scopes: retainedScopes,
        migrationRecentIds: oldDeck ? withSeed.discoveryDecks.migrationRecentIds : [],
      },
    };
    persist(nextState);
    setActiveEntry(result.entry);
    setToken(startToken);
    setPhase("loading");
    setNote(null);
    setNewCycleNotice(result.newCycle && withSeed.preferences.topics.length > 0);
  }, [clientState, eligibleEntries, entries, frameCycle, persist, preserveUnavailableIds, waitingForCatalogue]);

  const handleSave = useCallback(() => {
    if (!activeEntry) return;
    const snapshot = toSnapshot(activeEntry);
    const deduped = clientState.saves.filter((item) => item.id !== snapshot.id);
    persist({ ...clientState, saves: [...deduped, snapshot] });
    setNote("Added to Liked.");
  }, [activeEntry, clientState, persist]);

  const handleNotForMe = useCallback(() => {
    if (!activeEntry) return;
    if (clientState.excludedIds.includes(activeEntry.id)) return;
    persist({
      ...clientState,
      excludedIds: [...clientState.excludedIds, activeEntry.id],
    });
    setNote("Not for me recorded locally.");
  }, [activeEntry, clientState, persist]);

  const handleReport = useCallback(
    ({ note: reportNote, type }: { note: string; type: "broken" | "report" }) => {
      const entryId = activeEntry?.id ?? "none";
      const next = {
        ...clientState,
        reports: [
          ...clientState.reports,
          {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            entryId,
            note: reportNote,
            type,
            createdAt: new Date().toISOString(),
            localOnly: true as const,
          },
        ],
      };
      persist(next);
      setNote("Report saved locally.");
    },
    [activeEntry, clientState, persist],
  );

  return (
    <main
      aria-label="Stumblr Explorer"
      className="mx-auto flex min-h-screen w-full flex-col bg-[color:var(--background)] pb-24 md:pb-3"
    >
      <header className="sticky top-0 z-20 border-b border-[color:var(--ui-border)] bg-[color:var(--toolbar-bg)] text-white shadow-sm">
        <div className="mx-auto flex items-center justify-between gap-2 px-3 py-2 md:px-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Image
                src="/brand/stumblr-symbol.svg"
                alt=""
                width={28}
                height={28}
                className="h-7 w-7 shrink-0"
              />
              <h1 className="text-lg font-semibold leading-none text-white md:text-xl">Stumblr</h1>
            </div>
            <p data-testid="brand-tagline" className="mt-1 max-w-sm text-[11px] leading-snug text-zinc-400">Explore the internet as your forefathers intended</p>
            {modeLabel ? (
              <p className="text-[11px] leading-none text-zinc-400">{modeLabel}</p>
            ) : null}
          </div>
          <TopControls
            isLoading={phase === "loading"}
            nextDisabled={waitingForCatalogue}
            onNext={applyNext}
            onNotForMe={handleNotForMe}
            onSave={handleSave}
          />

          <Button
            size="sm"
            variant="toolbar"
            aria-label="Open utility menu"
            className="md:hidden"
            onClick={() => setOpenUtility(true)}
          >
            <Menu className="mr-1 h-4 w-4" /> Menu
          </Button>

          <div className="hidden items-center gap-1 md:flex">
            <Button size="sm" variant="toolbar" aria-label="Open topics" onClick={() => setOpenPrefs(true)}>
              <Tags className="mr-1 h-4 w-4" /> Topics{clientState.preferences.topics.length > 0 ? ` (${clientState.preferences.topics.length})` : ""}
            </Button>
            <Button size="sm" variant="toolbar" aria-label="Open liked" onClick={() => setOpenSaves(true)}>
              <ThumbsUp className="mr-1 h-4 w-4" /> Liked
            </Button>
            <Button size="sm" variant="toolbar" aria-label="Open history" onClick={() => setOpenHistory(true)}>
              <Clock3 className="mr-1 h-4 w-4" /> History
            </Button>
            <Button size="sm" variant="toolbar" aria-label="Suggest a site" onClick={() => setOpenSuggest(true)}>
              <Link2 className="mr-1 h-4 w-4" /> Suggest
            </Button>
            <Button size="sm" variant="toolbar" aria-label="Open report" onClick={() => setOpenReport(true)}>
              <Flag className="mr-1 h-4 w-4" /> Report
            </Button>
          </div>
        </div>
      </header>

      <Drawer
        title="History"
        description="Local revisit log for this device."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openHistory}
        onOpenChange={setOpenHistory}
      >
          <HistoryDrawer
            history={clientState.history}
            onExport={() => {
              const blob = new Blob([exportClientState()], { type: "application/json" });
              const link = document.createElement("a");
              link.href = URL.createObjectURL(blob);
              link.download = "stumblr-local-state.json";
              link.click();
              URL.revokeObjectURL(link.href);
            }}
            onRemove={(id) =>
              persist({
                ...clientState,
                history: clientState.history.filter((item) => item.id !== id),
              })
            }
            onReset={() => {
              persist(resetDiscoveryState(clientState));
              setNewCycleNotice(false);
              setPhase("idle");
            }}
            onRevisit={(snapshot) => {
              const found = entries.find((entry) => entry.id === snapshot.id);
              if (!found) return;
              const startToken = frameCycle.startLoad(found);
              setActiveEntry(found);
              setToken(startToken);
              setPhase("loading");
              setOpenHistory(false);
            }}
          />
      </Drawer>

      <Drawer
        title="Liked"
        description="Sites you liked, kept on this device."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openSaves}
        onOpenChange={setOpenSaves}
      >
          <SavesDrawer
            saves={clientState.saves}
            onRemove={(id) =>
              persist({
                ...clientState,
                saves: clientState.saves.filter((item) => item.id !== id),
              })
            }
            onRevisit={(snapshot) => {
              const found = entries.find((entry) => entry.id === snapshot.id);
              if (!found) return;
              const startToken = frameCycle.startLoad(found);
              setActiveEntry(found);
              setToken(startToken);
              setPhase("loading");
              setOpenSaves(false);
            }}
          />
      </Drawer>

      <Drawer
        title="Report"
        description="Local-only moderation notes for this draft."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openReport}
        onOpenChange={setOpenReport}
      >
          <ReportDrawer reports={clientState.reports} onSubmit={handleReport} />
      </Drawer>

      <Drawer
        title="Topics"
        description="Choose what you want to stumble into."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openPrefs}
        onOpenChange={setOpenPrefs}
      >
          <PreferencesDrawer
            topics={clientState.preferences.topics}
            onToggleTopic={toggleTopic}
            onClearTopics={clearTopics}
          />
      </Drawer>

      <Drawer
        title="Suggest a site"
        description="Community suggestions are queued for private review."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openSuggest}
        onOpenChange={setOpenSuggest}
      >
        <SuggestionDrawer
          onSubmitted={() => {
            setNote("Suggestion queued for private review.");
          }}
        />
      </Drawer>

      {newCycleNotice ? (
        <div role="status" className="mx-4 mt-2 flex items-center gap-3 rounded border p-2 text-sm">
          <span>New cycle</span>
          <Button size="sm" variant="secondary" onClick={() => {
            persist({ ...clientState, preferences: { ...clientState.preferences, topics: [], mode: "wildcard" } });
            setNewCycleNotice(false);
          }}>Broaden topics</Button>
        </div>
      ) : null}
      {note ? <p className="px-4 pt-2 text-sm text-[var(--ui-muted)]">{note}</p> : null}

      <div className="flex min-h-0 flex-1 flex-col px-2 pt-2 md:px-4">
        {phase === "exhausted" && !activeEntry ? (
          <ExhaustedState
            onReset={() => {
              setOpenPrefs(true);
            }}
          />
        ) : (
          <FrameHost
            entry={activeEntry}
            phase={phase}
            token={token}
            message={note}
            onReady={(currentToken) => {
              const next = frameCycle.resolveLoad(currentToken, { kind: "ready" });
              setPhase(next.phase);
              setNote(next.note);
            }}
            onTimeout={(currentToken) => {
              const next = frameCycle.resolveLoad(currentToken, {
                kind: "timeout",
                note: "This destination timed out in-frame. Try Stumbl or Open original.",
              });
              setPhase(next.phase);
              setNote(next.note);
            }}
            onError={(currentToken) => {
              const next = frameCycle.resolveLoad(currentToken, {
                kind: "error",
                note: "The frame failed to load. Publishers can block framing by policy.",
              });
              setPhase(next.phase);
              setNote(next.note);
            }}
          />
        )}
      </div>

      <BottomDock
        nextDisabled={waitingForCatalogue}
        onNext={applyNext}
        onLike={handleSave}
        onNotForMe={handleNotForMe}
      />

      <Drawer
        title="Menu"
        description="Topics, liked sites, history and more."
        trigger={<button type="button" className="hidden" aria-hidden="true" />}
        open={openUtility}
        onOpenChange={setOpenUtility}
      >
        <div role="tablist" aria-label="Menu sections" className="mb-4 flex gap-1 overflow-x-auto rounded-md bg-[color:var(--surface-soft)] p-1">
          {MENU_TABS.map(([tab, label]) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={menuTab === tab}
              onClick={() => setMenuTab(tab)}
              className={`min-h-10 flex-1 whitespace-nowrap rounded px-3 text-sm font-medium ${menuTab === tab ? "bg-white text-[var(--text-main)] shadow-sm" : "text-[var(--ui-muted)]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div role="tabpanel" aria-label={MENU_TABS.find(([tab]) => tab === menuTab)?.[1]}>
          {menuTab === "topics" ? (
            <PreferencesDrawer
                topics={clientState.preferences.topics}
                onToggleTopic={toggleTopic}
                onClearTopics={clearTopics}
              />
          ) : menuTab === "liked" ? (
            <SavesDrawer
                saves={clientState.saves}
                onRemove={(id) =>
                  persist({
                    ...clientState,
                    saves: clientState.saves.filter((item) => item.id !== id),
                  })
                }
                onRevisit={(snapshot) => {
                  const found = entries.find((entry) => entry.id === snapshot.id);
                  if (!found) return;
                  const startToken = frameCycle.startLoad(found);
                  setActiveEntry(found);
                  setToken(startToken);
                  setPhase("loading");
                  setOpenUtility(false);
                }}
              />
          ) : menuTab === "history" ? (
            <HistoryDrawer
                history={clientState.history}
                onExport={() => {
                  const blob = new Blob([exportClientState()], { type: "application/json" });
                  const link = document.createElement("a");
                  link.href = URL.createObjectURL(blob);
                  link.download = "stumblr-local-state.json";
                  link.click();
                  URL.revokeObjectURL(link.href);
                }}
                onRemove={(id) =>
                  persist({
                    ...clientState,
                    history: clientState.history.filter((item) => item.id !== id),
                  })
                }
                onReset={() => {
                  persist(resetDiscoveryState(clientState));
                  setNewCycleNotice(false);
                  setPhase("idle");
                }}
                onRevisit={(snapshot) => {
                  const found = entries.find((entry) => entry.id === snapshot.id);
                  if (!found) return;
                  const startToken = frameCycle.startLoad(found);
                  setActiveEntry(found);
                  setToken(startToken);
                  setPhase("loading");
                  setOpenUtility(false);
                }}
              />
          ) : menuTab === "suggest" ? (
            <SuggestionDrawer
                onSubmitted={() => {
                  setNote("Suggestion queued for private review.");
                  setOpenUtility(false);
                }}
              />
          ) : (
            <ReportDrawer reports={clientState.reports} onSubmit={handleReport} />
          )}
        </div>
      </Drawer>
    </main>
  );
}
