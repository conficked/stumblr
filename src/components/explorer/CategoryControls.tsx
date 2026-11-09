import { Shuffle, Tags, FilterX } from "lucide-react";
import { SamplerMode } from "@/lib/sampler/createSampler";
import { Button } from "@/components/ui/button";

type CategoryControlsProps = {
  selectedCount: number;
  mode: SamplerMode;
  includeEvaluationPool: boolean;
  onResetAllTopics: () => void;
  onModeChange: (mode: SamplerMode) => void;
  onOpenPreferences: () => void;
};

export function CategoryControls({
  selectedCount,
  mode,
  includeEvaluationPool,
  onResetAllTopics,
  onModeChange,
  onOpenPreferences,
}: CategoryControlsProps) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label="Discovery controls">
      <Button
        size="sm"
        variant="toolbar"
        aria-label="All topics"
        className="h-10 px-2 text-xs"
        onClick={onResetAllTopics}
      >
        <FilterX className="mr-1 h-3.5 w-3.5" /> All topics
      </Button>
      <Button
        size="sm"
        variant="toolbar"
        aria-label="Choose interests"
        className="h-10 px-2 text-xs"
        onClick={onOpenPreferences}
      >
        <Tags className="mr-1 h-3.5 w-3.5" /> Interests {selectedCount > 0 ? `(${selectedCount})` : "(all)"}
      </Button>
      <div className="ml-auto flex items-center gap-1">
        {(["topic", "adjacent", "wildcard"] as SamplerMode[]).map((candidate) => (
          <Button
            key={candidate}
            size="sm"
            variant={mode === candidate ? "secondary" : "toolbar"}
            className="h-10 px-2 text-[11px]"
            aria-label={`Set discovery mode ${candidate}`}
            onClick={() => onModeChange(candidate)}
          >
            {candidate === "wildcard" ? <Shuffle className="mr-1 h-3.5 w-3.5" /> : null}
            {candidate}
          </Button>
        ))}
      </div>
      <p className="w-full text-[11px] text-zinc-300">
        {includeEvaluationPool
          ? "Using private evaluation pool. Pending community suggestions are reviewed before any rotation inclusion."
          : "Launch-only pool can be empty; switch to evaluation pool or all topics when exhausted."}
      </p>
    </div>
  );
}
