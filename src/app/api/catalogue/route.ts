import { connection } from "next/server";
import { readRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";
export async function GET() { await connection(); return Response.json(readRuntimeCatalogue(), { headers: { "Cache-Control": "no-store" } }); }
