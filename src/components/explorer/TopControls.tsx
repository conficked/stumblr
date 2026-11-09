import { Sparkles, Bookmark, ThumbsDown, Shuffle, Tags, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";

type TopControlsProps = {
  isLoading: boolean;
  nextDisabled: boolean;
  onNext: () => void;
  onNotForMe: () => void;
  onSave: () => void;
  onOpenPreferences: () => void;
  onOpenSuggest: () => void;
};

export function TopControls({
  isLoading,
  nextDisabled,
  onNext,
  onNotForMe,
  onSave,
  onOpenPreferences,
  onOpenSuggest,
}: TopControlsProps) {
  return (
    <div className="hidden items-center gap-1 md:flex">
      <Button variant="primary" size="md" onClick={onNext} disabled={nextDisabled} aria-label="Stumbl" title="Stumbl">
        <Sparkles className="mr-2 h-4 w-4" /> Stumbl
      </Button>
      <Button variant="toolbar" size="sm" onClick={onSave} aria-label="Save">
        <Bookmark className="mr-2 h-4 w-4" /> Save
      </Button>
      <Button variant="toolbar" size="sm" onClick={onNotForMe} aria-label="Not for me">
        <ThumbsDown className="mr-2 h-4 w-4" /> Not for me
      </Button>
      <Button variant="toolbar" size="sm" onClick={onOpenPreferences} aria-label="Discovery categories">
        <Tags className="mr-2 h-4 w-4" /> Categories
      </Button>
      <Button variant="toolbar" size="sm" onClick={onOpenSuggest} aria-label="Suggest a site">
        <Link2 className="mr-2 h-4 w-4" /> Suggest
      </Button>
      {isLoading ? (
        <p className="inline-flex items-center px-2 text-xs text-[var(--ui-muted)]">
          <Shuffle className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" /> rotating
        </p>
      ) : null}
    </div>
  );
}
