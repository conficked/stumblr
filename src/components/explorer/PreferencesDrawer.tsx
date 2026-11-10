import { Check } from "lucide-react";
import { Topic } from "@/lib/catalogue/types";
import { Button } from "@/components/ui/button";

type PreferencesDrawerProps = {
  topics: Topic[];
  onToggleTopic: (topic: Topic) => void;
  onClearTopics: () => void;
};

const TOPIC_OPTIONS: Topic[] = ["art", "science", "maps", "music", "games", "culture", "archives", "education", "nature", "tech"];

export function PreferencesDrawer({ topics, onToggleTopic, onClearTopics }: PreferencesDrawerProps) {
  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--ui-muted)]">
        {topics.length === 0
          ? "Exploring everything. Pick topics to only see those."
          : `Only showing ${topics.length === 1 ? "this topic" : "these topics"}.`}
      </p>
      <div className="flex flex-wrap gap-2">
        {TOPIC_OPTIONS.map((topic) => {
          const selected = topics.includes(topic);
          return (
            <button
              key={topic}
              type="button"
              aria-pressed={selected}
              onClick={() => onToggleTopic(topic)}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium capitalize transition-colors ${
                selected
                  ? "border-[var(--cta)] bg-[var(--cta)] text-white"
                  : "border-[color:var(--ui-border)] bg-white text-[var(--text-main)] hover:bg-[color:var(--surface-soft)]"
              }`}
            >
              {selected ? <Check className="mr-1.5 h-4 w-4" /> : null}
              {topic}
            </button>
          );
        })}
      </div>
      {topics.length > 0 ? (
        <Button variant="ghost" size="sm" onClick={onClearTopics}>
          Clear topics and explore everything
        </Button>
      ) : null}
    </div>
  );
}
