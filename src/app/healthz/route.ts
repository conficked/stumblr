import { buildHealthResponse } from "@/lib/security/readiness";
import { connection } from "next/server";

export async function GET() {
  await connection();
  return buildHealthResponse(process.env);
}

