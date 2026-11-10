import { ThumbsUp, ThumbsDown, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Replay, useReplay } from "@/components/ui/replay";
import { StumblrMark } from "./StumblrMark";

type TopControlsProps = {
  isLoading: boolean;
  liked: boolean;
  nextDisabled: boolean;
  onNext: () => void;
  onNotForMe: () => void;
  onSave: () => void;
};

export function TopControls({ isLoading, liked, nextDisabled, onNext, onNotForMe, onSave }: TopControlsProps) {
  const [spins, spin] = useReplay();
  const [pops, pop] = useReplay();
  const [nudges, nudge] = useReplay();
  return (
    <div className="hidden items-center gap-1 md:flex">
      <Button
        variant="primary"
        size="md"
        onClick={() => { spin(); onNext(); }}
        disabled={nextDisabled}
        aria-label="Stumbl"
        title="Stumbl"
        className="hover:-translate-y-0.5 hover:shadow-md"
      >
        <span className="mr-2 inline-flex"><Replay count={spins} effect="fx-spin"><StumblrMark className="h-5 w-5" /></Replay></span> Stumbl
      </Button>
      <Button variant="toolbar" size="sm" onClick={() => { pop(); onSave(); }} aria-label="Like" aria-pressed={liked}>
        <span className="mr-2 inline-flex"><Replay count={pops} effect="fx-pop"><ThumbsUp className="h-4 w-4" fill={liked ? "currentColor" : "none"} /></Replay></span> {liked ? "Liked" : "Like"}
      </Button>
      <Button variant="toolbar" size="sm" onClick={() => { nudge(); onNotForMe(); }} aria-label="Not for me">
        <span className="mr-2 inline-flex"><Replay count={nudges} effect="fx-nudge"><ThumbsDown className="h-4 w-4" /></Replay></span> Not for me
      </Button>
      {/* Always laid out so the header never shifts when loading starts or ends. */}
      <p
        aria-hidden={!isLoading}
        className={`inline-flex items-center px-2 text-xs text-[var(--ui-muted)] transition-opacity duration-150 ${isLoading ? "opacity-100" : "invisible opacity-0"}`}
      >
        <Shuffle className={`mr-1 h-3 w-3 ${isLoading ? "animate-spin motion-reduce:animate-none" : ""}`} /> rotating
      </p>
    </div>
  );
}
