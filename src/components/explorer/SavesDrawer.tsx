import { EntrySnapshot } from "@/lib/storage/schema";
import { Button } from "@/components/ui/button";

type SavesDrawerProps = {
  saves: EntrySnapshot[];
  onRevisit: (entry: EntrySnapshot) => void;
  onRemove: (id: string) => void;
};

export function SavesDrawer({ saves, onRevisit, onRemove }: SavesDrawerProps) {
  return (
    <div>
      {saves.length === 0 ? (
        <p className="text-sm text-[var(--ui-muted)]">
          No saved destinations yet. Save is local-only and does not affect recommendations.
        </p>
      ) : (
        <ul className="space-y-2">
          {[...saves].reverse().map((item) => (
            <li key={item.seenAt} className="rounded-md border border-[color:var(--ui-border)] bg-white p-3">
              <p className="font-medium">{item.title}</p>
              <p className="text-xs text-[var(--ui-muted)]">{item.domain}</p>
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={() => onRevisit(item)}>
                  Open in frame
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
