import { CatalogueEntry } from "@/lib/catalogue/types";

export type FramePhase =
  | "idle"
  | "loading"
  | "ready"
  | "timeout"
  | "blocked"
  | "error"
  | "exhausted";

export type LoadToken = number;

export type FrameState = {
  phase: FramePhase;
  activeToken: LoadToken;
  activeEntry: CatalogueEntry | null;
  note: string | null;
};

export function createFrameCycle(initial?: Partial<FrameState>) {
  let state: FrameState = {
    phase: "idle",
    activeToken: 0,
    activeEntry: null,
    note: null,
    ...initial,
  };

  return {
    getState: () => state,
    startLoad: (entry: CatalogueEntry) => {
      state = {
        phase: "loading",
        activeToken: state.activeToken + 1,
        activeEntry: entry,
        note: null,
      };
      return state.activeToken;
    },
    resolveLoad: (
      token: LoadToken,
      outcome: { kind: Exclude<FramePhase, "idle" | "loading" | "exhausted">; note?: string },
    ) => {
      if (token !== state.activeToken) return state;
      state = {
        ...state,
        phase: outcome.kind,
        note: outcome.note ?? null,
      };
      return state;
    },
    setExhausted: (message: string) => {
      state = { ...state, phase: "exhausted", note: message };
      return state;
    },
  };
}
