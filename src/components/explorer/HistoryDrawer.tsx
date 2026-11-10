import { EntrySnapshot } from "@/lib/storage/schema";
import { Button } from "@/components/ui/button";
import { EntryList } from "./EntryList";

type HistoryDrawerProps = {
  history: EntrySnapshot[];
  onRevisit: (entry: EntrySnapshot) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onExport: () => void;
};

export function HistoryDrawer({ history, onRevisit, onRemove, onReset, onExport }: HistoryDrawerProps) {
  return (
    <div className="space-y-3">
      <EntryList
        entries={history}
        empty="No history yet. Press Stumbl to start exploring."
        onRevisit={onRevisit}
        onRemove={onRemove}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" onClick={onExport}>
          Export JSON
        </Button>
        <Button variant="danger" size="sm" onClick={onReset}>
          Reset discovery history
        </Button>
      </div>
    </div>
  );
}
