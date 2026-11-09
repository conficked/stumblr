import { Topic } from "@/lib/catalogue/types";
import { SamplerMode } from "@/lib/sampler/createSampler";
import { Button } from "@/components/ui/button";

type PreferencesDrawerProps = {
  topics: Topic[];
  mode: SamplerMode;
  includeEvaluationPool: boolean;
  onToggleTopic: (topic: Topic) => void;
  onModeChange: (mode: SamplerMode) => void;
  onToggleEvaluationPool: () => void;
};

const TOPIC_OPTIONS: Topic[] = [
  "art",
  "science",
  "maps",
  "music",
  "games",
  "culture",
  "archives",
  "education",
  "nature",
];

export function PreferencesDrawer({
  topics,
  mode,
  includeEvaluationPool,
  onToggleTopic,
  onModeChange,
  onToggleEvaluationPool,
}: PreferencesDrawerProps) {
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold">Interests</h3>
        <p className="mt-1 text-xs text-[var(--ui-muted)]">
          Leave empty to sample all eligible topics. Each preference setup keeps its own discovery progress.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOPIC_OPTIONS.map((topic) => {
            const selected = topics.includes(topic);
            return (
              <Button
                key={topic}
                size="sm"
                variant={selected ? "primary" : "ghost"}
                onClick={() => onToggleTopic(topic)}
              >
                {topic}
              </Button>
            );
          })}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Sampling mode</h3>
        <div className="mt-2 grid grid-cols-3 gap-2">
          {(["topic", "adjacent", "wildcard"] as SamplerMode[]).map((candidate) => (
            <Button
              key={candidate}
              size="sm"
              variant={mode === candidate ? "secondary" : "ghost"}
              onClick={() => onModeChange(candidate)}
            >
              {candidate}
            </Button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold">Pool source</h3>
        <p className="mt-1 text-xs text-[var(--ui-muted)]">
          No entries are launch-qualified yet; evaluation pool is enabled by default.
        </p>
        <Button
          className="mt-2"
          size="sm"
          variant={includeEvaluationPool ? "secondary" : "ghost"}
          onClick={onToggleEvaluationPool}
        >
          {includeEvaluationPool ? "Using evaluation pool" : "Using launch-only pool"}
        </Button>
      </section>
    </div>
  );
}
