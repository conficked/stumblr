import { EntrySnapshot } from "@/lib/storage/schema";
import { Button } from "@/components/ui/button";

type HistoryDrawerProps = {
  history: EntrySnapshot[];
  onRevisit: (entry: EntrySnapshot) => void;
  onRemove: (id: string) => void;
  onReset: () => void;
  onExport: () => void;
};

export function HistoryDrawer({
  history,
  onRevisit,
  onRemove,
  onReset,
  onExport,
}: HistoryDrawerProps) {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={onExport}>
          Export JSON
        </Button>
        <Button variant="danger" size="sm" onClick={onReset}>
          Reset discovery history
        </Button>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-[var(--ui-muted)]">No history yet. Press Stumbl to start exploring.</p>
      ) : (
        <ul className="space-y-2">
          {[...history].reverse().map((item) => (
            <li key={item.seenAt} className="rounded-md border border-[color:var(--ui-border)] bg-white p-3">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-[var(--ui-muted)]">{item.domain}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => onRevisit(item)}>
                  Revisit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onRemove(item.id)}>
                  Remove
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
