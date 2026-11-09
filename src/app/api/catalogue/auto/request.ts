import { z } from "zod";
import { AutoPublicationConflict } from "@/lib/catalogue/autoPublisher";
import { authenticatePublisher, type AutoPublishActor } from "@/lib/security/cataloguePublisher";

const MAX_BODY_BYTES = 16 * 1024;
const headers = { "Cache-Control": "no-store" };
const rejected = (status: number) => Response.json({ ok: false }, { status, headers });

export const autoReleaseRevision = z.string().regex(/^[a-f0-9]{40}:[1-9][0-9]{0,19}:[1-9][0-9]{0,15}$/);
export const catalogueRevision = z.union([
  z.string().regex(/^[a-f0-9]{40}$/), autoReleaseRevision,
  z.string().regex(/^[a-f0-9]{40}:[1-9][0-9]{0,19}:[1-9][0-9]{0,15}:rollback$/),
]);

export function autoPublicationPost<Schema extends z.ZodType>(
  schema: Schema, operation: (actor: AutoPublishActor, input: z.output<Schema>) => object,
) {
  return async (request: Request) => {
    let actor: AutoPublishActor;
    try {
      actor = await authenticatePublisher(request.headers.get("authorization"), undefined, "auto_publish");
    } catch {
      return rejected(401);
    }

    if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") return rejected(415);
    const reader = request.body?.getReader();
    if (!reader) return rejected(400);
    let input: z.output<Schema>;
    try {
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.byteLength;
        if (size > MAX_BODY_BYTES) {
          await reader.cancel().catch(() => {});
          return rejected(413);
        }
        chunks.push(next.value);
      }
      input = schema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks, size))));
    } catch {
      return rejected(400);
    } finally {
      reader.releaseLock();
    }

    try {
      return Response.json({ ok: true, ...operation(actor, input) }, { headers });
    } catch (error) {
      if (error instanceof AutoPublicationConflict) return rejected(409);
      if (error instanceof RangeError) return rejected(400);
      return rejected(500);
    }
  };
}
