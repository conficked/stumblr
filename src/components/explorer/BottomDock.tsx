import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Replay, useReplay } from "@/components/ui/replay";
import { StumblrMark } from "./StumblrMark";

type BottomDockProps = {
  liked: boolean;
  nextDisabled: boolean;
  onNext: () => void;
  onLike: () => void;
  onNotForMe: () => void;
};

export function BottomDock({ liked, nextDisabled, onNext, onLike, onNotForMe }: BottomDockProps) {
  const [spins, spin] = useReplay();
  const [pops, pop] = useReplay();
  const [nudges, nudge] = useReplay();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--ui-border)] bg-[color:var(--toolbar-bg)] px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden"
      aria-label="Mobile controls"
    >
      <div className="grid grid-cols-4 gap-2">
        <Button size="lg" variant="primary" onClick={() => { spin(); onNext(); }} disabled={nextDisabled} aria-label="Stumbl" title="Stumbl" className="col-span-2 whitespace-nowrap px-2 text-base font-semibold">
          <span className="mr-2 inline-flex"><Replay count={spins} effect="fx-spin"><StumblrMark className="h-6 w-6" /></Replay></span> Stumbl
        </Button>
        <Button size="lg" variant="toolbar" onClick={() => { pop(); onLike(); }} aria-label="Like" aria-pressed={liked} title={liked ? "Liked" : "Like"}>
          <Replay count={pops} effect="fx-pop"><ThumbsUp className="h-6 w-6" fill={liked ? "currentColor" : "none"} /></Replay>
        </Button>
        <Button size="lg" variant="toolbar" onClick={() => { nudge(); onNotForMe(); }} aria-label="Not for me" title="Not for me">
          <Replay count={nudges} effect="fx-nudge"><ThumbsDown className="h-6 w-6" /></Replay>
        </Button>
      </div>
    </nav>
  );
}
