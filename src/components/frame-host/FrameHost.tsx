"use client";

import { useEffect, useMemo, useRef } from "react";
import { ExternalLink } from "lucide-react";
import { CatalogueEntry } from "@/lib/catalogue/types";
import {
  FRAME_PERMISSIONS_POLICY,
  FRAME_SANDBOX,
  LOAD_TIMEOUT_MS,
} from "./framePolicies";
import { FramePhase } from "./useFrameCycle";
import { Button } from "@/components/ui/button";

type FrameHostProps = {
  entry: CatalogueEntry | null;
  phase: FramePhase;
  token: number;
  message: string | null;
  onReady: (token: number) => void;
  onTimeout: (token: number) => void;
  onError: (token: number) => void;
};

export function FrameHost({
  entry,
  phase,
  token,
  message,
  onReady,
  onTimeout,
  onError,
}: FrameHostProps) {
  const timeoutIdRef = useRef<number | null>(null);
  const outcome = entry?.fixtureOutcome;

  useEffect(() => {
    if (phase !== "loading") return;
    const timeoutMs = outcome === "timeout" ? 1200 : LOAD_TIMEOUT_MS;
    timeoutIdRef.current = window.setTimeout(() => onTimeout(token), timeoutMs);
    return () => {
      if (timeoutIdRef.current) window.clearTimeout(timeoutIdRef.current);
    };
  }, [outcome, phase, token, onTimeout]);

  useEffect(() => {
    if (phase !== "loading" || !entry) return;
    if (outcome === "error") {
      const id = window.setTimeout(() => onError(token), 150);
      return () => window.clearTimeout(id);
    }
    return;
  }, [entry, outcome, phase, token, onError]);

  const domain = useMemo(() => (entry ? entry.domain : null), [entry]);

  if (!entry) {
    return (
      <section
        className="flex h-full items-center justify-center rounded-md border border-dashed border-[color:var(--ui-border)] bg-[color:var(--surface-frame)]"
        aria-live="polite"
      >
        <p className="max-w-xl px-6 text-center text-sm text-[var(--ui-muted)]">
          The internet’s a big place. Take a wrong turn.
          <span className="block">Press Stumbl to begin.</span>
        </p>
      </section>
    );
  }

  return (
    <section
      className="flex min-h-0 flex-1 flex-col rounded-md border border-[color:var(--ui-border)] bg-[color:var(--surface-frame)]"
    >
      <header className="flex items-center justify-between gap-2 border-b border-[color:var(--ui-border)] px-3 py-2 text-xs text-[var(--ui-muted)]">
        <p className="min-w-0">
          Destination domain:{" "}
          <span data-testid="active-entry-domain" className="font-semibold text-[var(--text-main)]">
            {domain}
          </span>
          <span
            data-testid="active-entry-title"
            className="ml-2 hidden truncate text-[11px] text-[var(--ui-muted)] md:inline"
          >
            {entry.title}
          </span>
        </p>
        <a
          href={entry.canonicalUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-[var(--cta)] hover:text-[var(--cta-hover)]"
        >
          Open original <ExternalLink className="h-3 w-3" />
        </a>
      </header>

      <div className="relative flex-1 min-h-0 bg-white">
        <iframe
          key={token}
          src={outcome === "error" ? "http://127.0.0.1:9/unreachable" : entry.canonicalUrl}
          title={`Destination: ${entry.title}`}
          className={`w-full ${phase === "loading" ? "opacity-0" : phase === "ready" ? "fx-fade-in" : ""}`}
          style={{
            position: "absolute",
            inset: "0",
            width: "100%",
            height: "100%",
            display: "block",
          }}
          sandbox={FRAME_SANDBOX}
          allow={FRAME_PERMISSIONS_POLICY}
          loading="eager"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => {
            if (outcome === "timeout" || outcome === "error") return;
            onReady(token);
          }}
          onError={() => onError(token)}
        />
        {phase !== "ready" ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 px-6">
            <div className="max-w-md text-center">
              <p className="text-base font-semibold text-white">
                {phase === "loading" ? "Loading destination…" : "Destination needs attention"}
              </p>
              <p className="mt-2 text-sm text-zinc-200">
                {message ??
                  "Framed sites can block embeds or navigate internally. Use Open original if this state persists."}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      <footer className="border-t border-[color:var(--ui-border)] px-3 py-2 text-xs text-[var(--ui-muted)]">
        Internal cross-origin navigation and deep URL capture cannot be guaranteed from inside iframes.
      </footer>
    </section>
  );
}

export function ExhaustedState({ onReset }: { onReset: () => void }) {
  return (
    <section className="flex h-full items-center justify-center rounded-md border border-[color:var(--ui-border)] bg-[color:var(--surface)] px-6 text-center">
      <div className="max-w-lg">
        <h2 className="text-xl font-semibold text-[var(--text-main)]">Try another direction</h2>
        <p className="mt-2 text-sm text-[var(--ui-muted)]">
          No destinations match these interests yet. Try All topics or choose another interest.
        </p>
        <Button variant="primary" size="lg" className="mt-4 pointer-events-auto" onClick={onReset}>
          Choose interests
        </Button>
      </div>
    </section>
  );
}
