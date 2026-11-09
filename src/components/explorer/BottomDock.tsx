import { Bookmark, Menu, Sparkles, ThumbsDown } from "lucide-react";
import { Button } from "@/components/ui/button";

type BottomDockProps = {
  nextDisabled: boolean;
  onNext: () => void;
  onSave: () => void;
  onNotForMe: () => void;
  onUtility: () => void;
};

export function BottomDock({
  nextDisabled,
  onNext,
  onSave,
  onNotForMe,
  onUtility,
}: BottomDockProps) {
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 border-t border-[color:var(--ui-border)] bg-[color:var(--toolbar-bg)] px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2 backdrop-blur md:hidden"
      aria-label="Mobile controls"
    >
      <div className="grid grid-cols-4 gap-2">
        <Button size="lg" variant="primary" onClick={onNext} disabled={nextDisabled} aria-label="Stumbl" title="Stumbl" className="whitespace-nowrap px-2 text-[13px]">
          <Sparkles className="mr-1 h-4 w-4" /> Stumbl
        </Button>
        <Button size="lg" variant="secondary" onClick={onSave} aria-label="Save" className="whitespace-nowrap px-2 text-[13px]">
          <Bookmark className="mr-1 h-4 w-4" /> Save
        </Button>
        <Button size="lg" variant="toolbar" onClick={onNotForMe} aria-label="Not for me" className="whitespace-nowrap px-2 text-[12px]">
          <ThumbsDown className="mr-1 h-4 w-4" /> Not for me
        </Button>
        <Button size="lg" variant="toolbar" onClick={onUtility} aria-label="Open utility menu" className="whitespace-nowrap px-2 text-[13px]">
          <Menu className="mr-1 h-4 w-4" /> Menu
        </Button>
      </div>
    </nav>
  );
}
