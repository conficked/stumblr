import { getPendingQualificationCandidates, importQualificationEvidence } from "@/lib/catalogue/qualificationEvidence";
import { authenticatePublisher, type CollectionActor } from "@/lib/security/cataloguePublisher";
import { importRuntimeHealthEvidence, importRuntimeHttpEvidence } from "@/lib/catalogue/runtimeHealth";
import { getConfirmedRuntimeEntryIds, getConfirmedRuntimeHealthTargets } from "@/lib/catalogue/runtimeStore";
import { markReportsRechecked, pendingBrokenReportUrls } from "@/lib/submissions/reports";

const maxBodyBytes = 1024 * 1024;
const headers = { "Cache-Control": "no-store" };
const rejected = (status: number) => Response.json({ ok: false }, { status, headers });

export async function POST(request: Request) {
  let actor: CollectionActor;
  try {
    actor = await authenticatePublisher(request.headers.get("authorization"), undefined, "collect");
  } catch {
    return rejected(401);
  }

  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return rejected(415);
  const reader = request.body?.getReader();
  if (!reader) return rejected(400);
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel().catch(() => {});
        return rejected(413);
      }
      chunks.push(next.value);
    }
    const input: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size)));
    if (input && typeof input === "object" && "runtime_health" in input) {
      const rows = (input as { runtime_health?: unknown }).runtime_health;
      const transitions = importRuntimeHealthEvidence(rows, actor.runId, actor.runAttempt, getConfirmedRuntimeEntryIds());
      return Response.json({ ok: true, transitions }, { headers });
    }
    if (input && typeof input === "object" && "runtime_http" in input) {
      const confirmed = getConfirmedRuntimeEntryIds();
      const result = importRuntimeHttpEvidence((input as { runtime_http?: unknown }).runtime_http, actor.runId, actor.runAttempt, confirmed);
      return Response.json({ ok: true, ...result }, { headers });
    }
    return Response.json({ ok: true, ...importQualificationEvidence(input, actor) }, { headers });
  } catch {
    return rejected(400);
  } finally {
    reader.releaseLock();
  }
}

export async function GET(request: Request) {
  try {
    await authenticatePublisher(request.headers.get("authorization"), undefined, "collect");
  } catch {
    return rejected(401);
  }
  if (new URL(request.url).searchParams.get("runtime_health_targets") === "1") {
    const reported = pendingBrokenReportUrls();
    const targets = getConfirmedRuntimeHealthTargets(24, true, reported);
    const picked = targets.filter(target => reported.has(target.canonicalUrl)).map(target => target.canonicalUrl);
    markReportsRechecked(picked);
    return Response.json({ targets, reported: picked.length }, { headers });
  }
  const sourceFamily = new URL(request.url).searchParams.get("source_family");
  if (sourceFamily !== null && !/^[a-z0-9-]{1,100}$/.test(sourceFamily)) return rejected(400);
  return Response.json({ candidates: getPendingQualificationCandidates(sourceFamily) }, { headers });
}
