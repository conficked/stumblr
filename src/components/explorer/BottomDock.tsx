import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StumblrMark } from "./StumblrMark";

type BottomDockProps = {
  nextDisabled: boolean;
  onNext: () => void;
  onLike: () => void;
  onNotForMe: () => void;
};

export function BottomDock({ nextDisabled, onNext, onLike, onNotForMe }: BottomDockProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--ui-border)] bg-[color:var(--toolbar-bg)] px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden"
      aria-label="Mobile controls"
    >
      <div className="grid grid-cols-4 gap-2">
        <Button size="lg" variant="primary" onClick={onNext} disabled={nextDisabled} aria-label="Stumbl" title="Stumbl" className="col-span-2 whitespace-nowrap px-2 text-base font-semibold">
          <StumblrMark className="mr-2 h-6 w-6" /> Stumbl
        </Button>
        <Button size="lg" variant="toolbar" onClick={onLike} aria-label="Like" title="Like">
          <ThumbsUp className="h-6 w-6" />
        </Button>
        <Button size="lg" variant="toolbar" onClick={onNotForMe} aria-label="Not for me" title="Not for me">
          <ThumbsDown className="h-6 w-6" />
        </Button>
      </div>
    </nav>
  );
}
