"use client";

import { useMemo, useState } from "react";
import { Topic } from "@/lib/catalogue/types";
import { Button } from "@/components/ui/button";

type SuggestionDrawerProps = {
  onSubmitted?: () => void;
};

const TOPICS: Topic[] = [
  "art",
  "science",
  "maps",
  "music",
  "games",
  "culture",
  "archives",
  "education",
  "nature",
  "tech",
];

type SuggestionResult = {
  ok: boolean;
  code: string;
  message: string;
  suggestionId?: string | null;
};

export function SuggestionDrawer({ onSubmitted }: SuggestionDrawerProps) {
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [note, setNote] = useState("");
  const [topics, setTopics] = useState<Topic[]>([]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SuggestionResult | null>(null);

  const canSubmit = useMemo(() => url.trim().length > 0 && !busy, [url, busy]);

  const toggleTopic = (topic: Topic) => {
    setTopics((prev) =>
      prev.includes(topic) ? prev.filter((item) => item !== topic) : [...prev, topic],
    );
  };

  const onSubmit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url,
          title: title || undefined,
          note: note || undefined,
          topics,
        }),
      });
      const body = (await response.json().catch(() => null)) as SuggestionResult | null;
      if (!body) {
        setResult({
          ok: false,
          code: "invalid_response",
          message: "Suggestion endpoint returned an invalid response.",
        });
      } else {
        setResult(body);
        if (body.ok) {
          onSubmitted?.();
          setUrl("");
          setTitle("");
          setNote("");
          setTopics([]);
        }
      }
    } catch {
      setResult({
        ok: false,
        code: "network_error",
        message: "Unable to submit suggestion in this environment.",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ui-muted)]">
        Suggest a site for curation review. Suggestions are queued privately on this VM and never auto-published.
      </p>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-[var(--text-main)]">URL (https)</span>
        <input
          type="url"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://example.org/path"
          className="h-11 w-full rounded-sm border border-[color:var(--ui-border)] bg-white px-3 text-sm text-[var(--text-main)]"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-[var(--text-main)]">Title (optional)</span>
        <input
          type="text"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={120}
          className="h-11 w-full rounded-sm border border-[color:var(--ui-border)] bg-white px-3 text-sm text-[var(--text-main)]"
        />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-semibold text-[var(--text-main)]">Why it belongs (optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={600}
          rows={4}
          className="w-full rounded-sm border border-[color:var(--ui-border)] bg-white px-3 py-2 text-sm text-[var(--text-main)]"
        />
      </label>
      <section>
        <h3 className="text-xs font-semibold text-[var(--text-main)]">Topics (optional)</h3>
        <div className="mt-2 flex flex-wrap gap-2">
          {TOPICS.map((topic) => (
            <Button
              key={topic}
              size="sm"
              variant={topics.includes(topic) ? "primary" : "ghost"}
              onClick={() => toggleTopic(topic)}
            >
              {topic}
            </Button>
          ))}
        </div>
      </section>
      <Button variant="secondary" size="md" disabled={!canSubmit} onClick={onSubmit}>
        {busy ? "Submitting…" : "Submit suggestion"}
      </Button>
      {result ? (
        <p
          className={result.ok ? "text-sm text-emerald-700" : "text-sm text-rose-700"}
          data-testid="suggestion-result"
        >
          {result.message}
        </p>
      ) : null}
      <p className="text-xs text-[var(--ui-muted)]">
        Private draft only. This queue is durable for this VM, pending review, and not a global production backend.
      </p>
    </div>
  );
}
