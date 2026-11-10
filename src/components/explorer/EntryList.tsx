import { useState } from "react";
import { X } from "lucide-react";
import { EntrySnapshot } from "@/lib/storage/schema";
import { Button } from "@/components/ui/button";

const PAGE = 20;

type EntryListProps = {
  entries: EntrySnapshot[];
  empty: string;
  onRevisit: (entry: EntrySnapshot) => void;
  onRemove: (id: string) => void;
};

// Newest first, one compact row per site; long lists page in by twenties.
export function EntryList({ entries, empty, onRevisit, onRemove }: EntryListProps) {
  const [shown, setShown] = useState(PAGE);
  if (entries.length === 0) return <p className="text-sm text-[var(--ui-muted)]">{empty}</p>;
  const newest = [...entries].reverse();
  return (
    <div>
      <ul className="divide-y divide-[color:var(--ui-border)] rounded-md border border-[color:var(--ui-border)] bg-white">
        {newest.slice(0, shown).map((item) => (
          <li key={`${item.id}-${item.seenAt}`} className="flex items-center">
            <button
              type="button"
              onClick={() => onRevisit(item)}
              className="min-h-11 min-w-0 flex-1 px-3 py-2 text-left hover:bg-[color:var(--surface-soft)]"
              aria-label={`Open ${item.title}`}
            >
              <span className="block truncate text-sm font-medium">{item.title}</span>
              <span className="block truncate text-xs text-[var(--ui-muted)]">{item.domain}</span>
            </button>
            <button
              type="button"
              onClick={() => onRemove(item.id)}
              className="flex h-11 w-11 shrink-0 items-center justify-center text-[var(--ui-muted)] hover:text-[var(--text-main)]"
              aria-label={`Remove ${item.title}`}
            >
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {newest.length > shown ? (
        <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setShown(shown + PAGE)}>
          Show more ({newest.length - shown} older)
        </Button>
      ) : null}
    </div>
  );
}
