import { NextRequest, NextResponse } from "next/server";
import { processReport, type ReportInput } from "@/lib/submissions/reports";
import { validateSameOriginJson } from "@/lib/security/requestOrigin";
import { submitterKeyFromHeaders } from "@/lib/security/submitter";

export async function POST(req: NextRequest) {
  const requestRejection = validateSameOriginJson(req);
  if (requestRejection) return requestRejection;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, code: "invalid_json", message: "Invalid JSON payload." }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, code: "invalid_payload", message: "Request body must be an object." }, { status: 400 });
  }

  const result = processReport(body as ReportInput, submitterKeyFromHeaders(req.headers));
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!result.ok && result.code === "rate_limited" && "retryAfterSec" in result) {
    headers.set("Retry-After", String(result.retryAfterSec));
  }
  return NextResponse.json(result, { status: result.status, headers });
}
