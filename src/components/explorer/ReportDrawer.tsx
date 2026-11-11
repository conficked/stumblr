import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { LocalReport } from "@/lib/storage/schema";

type ReportDrawerProps = {
  reports: LocalReport[];
  onSubmit: (payload: { note: string; type: "broken" | "report" }) => Promise<void>;
};

export function ReportDrawer({ reports, onSubmit }: ReportDrawerProps) {
  const [note, setNote] = useState("");
  const [type, setType] = useState<"broken" | "report">("broken");
  const [sending, setSending] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = note.trim();
    if ((!trimmed && type === "report") || sending) return;
    setSending(true);
    try {
      await onSubmit({ note: trimmed, type });
      setNote("");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="rounded-md border border-[color:var(--ui-border)] bg-[color:var(--surface-soft)] p-3 text-xs text-[var(--ui-muted)]">
        Reports go to Stumblr for the site you are viewing. A broken-site report moves it to the front of the next automatic health check, and sites that keep failing are taken out of rotation.
      </p>
      <form className="space-y-2" onSubmit={handleSubmit}>
        <label htmlFor="report-type" className="block text-xs text-[var(--ui-muted)]">
          Type
        </label>
        <select
          id="report-type"
          value={type}
          onChange={(event) => setType(event.target.value as "broken" | "report")}
          className="w-full rounded-md border border-[color:var(--ui-border)] bg-white px-3 py-2 text-sm"
        >
          <option value="broken">Broken site</option>
          <option value="report">Content report</option>
        </select>
        <label htmlFor="report-note" className="block text-xs text-[var(--ui-muted)]">
          Note
        </label>
        <textarea
          id="report-note"
          className="min-h-24 w-full rounded-md border border-[color:var(--ui-border)] bg-white px-3 py-2 text-sm"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder={type === "broken" ? "Optional: what went wrong?" : "What happened?"}
        />
        <Button size="sm" type="submit" disabled={sending}>
          {sending ? "Sending..." : "Send report"}
        </Button>
      </form>
      <div>
        <h3 className="text-sm font-semibold">Your reports</h3>
        {reports.length === 0 ? (
          <p className="mt-1 text-xs text-[var(--ui-muted)]">No reports saved yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {[...reports].reverse().map((record) => (
              <li key={record.id} className="rounded-md border border-[color:var(--ui-border)] bg-white p-2 text-xs">
                <p className="font-semibold">
                  {record.type === "broken" ? "Broken site" : "Content report"}
                  {record.localOnly ? " (not sent)" : ""}
                </p>
                {record.note ? <p className="text-[var(--ui-muted)]">{record.note}</p> : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
