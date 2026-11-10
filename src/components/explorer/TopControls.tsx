import { ThumbsUp, ThumbsDown, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StumblrMark } from "./StumblrMark";

type TopControlsProps = {
  isLoading: boolean;
  nextDisabled: boolean;
  onNext: () => void;
  onNotForMe: () => void;
  onSave: () => void;
};

export function TopControls({ isLoading, nextDisabled, onNext, onNotForMe, onSave }: TopControlsProps) {
  return (
    <div className="hidden items-center gap-1 md:flex">
      <Button variant="primary" size="md" onClick={onNext} disabled={nextDisabled} aria-label="Stumbl" title="Stumbl">
        <StumblrMark className="mr-2 h-5 w-5" /> Stumbl
      </Button>
      <Button variant="toolbar" size="sm" onClick={onSave} aria-label="Like">
        <ThumbsUp className="mr-2 h-4 w-4" /> Like
      </Button>
      <Button variant="toolbar" size="sm" onClick={onNotForMe} aria-label="Not for me">
        <ThumbsDown className="mr-2 h-4 w-4" /> Not for me
      </Button>
      {isLoading ? (
        <p className="inline-flex items-center px-2 text-xs text-[var(--ui-muted)]">
          <Shuffle className="mr-1 h-3 w-3 animate-spin motion-reduce:animate-none" /> rotating
        </p>
      ) : null}
    </div>
  );
}
