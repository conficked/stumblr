import { authenticatePublisher } from "@/lib/security/cataloguePublisher";
import { openOpsDb } from "@/lib/db/client";
import { importCandidateBatch } from "@/lib/catalogue/candidateQueue";
import { listUnqueuedSuggestions } from "@/lib/db/suggestionsRepo";
export async function POST(request: Request) {
  try { await authenticatePublisher(request.headers.get("authorization"), undefined, "collect"); } catch { return Response.json({ok:false},{status:401}); }
  if(!request.headers.get("content-type")?.startsWith("application/json"))return Response.json({ok:false},{status:415});
  const reader=request.body?.getReader();if(!reader)return Response.json({ok:false},{status:400});
  let size=0;const chunks:Uint8Array[]=[];
  while(true){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1000000){await reader.cancel();return Response.json({ok:false},{status:413});}chunks.push(next.value);}
  try{return Response.json({ok:true,...importCandidateBatch(JSON.parse(Buffer.concat(chunks).toString("utf8")))},{headers:{"Cache-Control":"no-store"}});}catch{return Response.json({ok:false},{status:400});}
}

export async function GET(request: Request) {
  try { await authenticatePublisher(request.headers.get("authorization"), undefined, "collect"); } catch { return Response.json({ok:false},{status:401}); }
  if(new URL(request.url).searchParams.get("community")==="1")return Response.json({suggestions:listUnqueuedSuggestions()},{headers:{"Cache-Control":"no-store"}});
  const rows=openOpsDb().prepare("SELECT canonical_url FROM discovery_candidates ORDER BY canonical_url LIMIT 20000").all();
  return Response.json({known_urls:rows.map(row=>String(row.canonical_url))},{headers:{"Cache-Control":"no-store"}});
}
