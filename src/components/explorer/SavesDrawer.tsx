import { EntrySnapshot } from "@/lib/storage/schema";
import { EntryList } from "./EntryList";

type SavesDrawerProps = {
  saves: EntrySnapshot[];
  onRevisit: (entry: EntrySnapshot) => void;
  onRemove: (id: string) => void;
};

export function SavesDrawer({ saves, onRevisit, onRemove }: SavesDrawerProps) {
  return (
    <EntryList
      entries={saves}
      empty="Nothing liked yet. Tap the thumbs up on a site to keep it here."
      onRevisit={onRevisit}
      onRemove={onRemove}
    />
  );
}
