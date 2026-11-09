import { authenticatePublisher } from "@/lib/security/cataloguePublisher";
import { installRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";
export async function POST(request: Request) {
  let publisher;
  try { publisher = await authenticatePublisher(request.headers.get("authorization")); } catch { return Response.json({ ok: false }, { status: 401 }); }
  if (!request.headers.get("content-type")?.startsWith("application/json")) return Response.json({ ok: false }, { status: 415 });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ ok: false }, { status: 400 });
  let size = 0; const chunks: Uint8Array[] = [];
  while (true) { const next = await reader.read(); if (next.done) break; size += next.value.byteLength; if (size > 1000000) { await reader.cancel(); return Response.json({ ok: false }, { status: 413 }); } chunks.push(next.value); }
  try { const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); return Response.json({ ok: true, ...installRuntimeCatalogue(data, publisher) }, { headers: { "Cache-Control": "no-store" } }); } catch { return Response.json({ ok: false }, { status: 400 }); }
}
