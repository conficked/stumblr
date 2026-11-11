import { NextRequest, NextResponse } from "next/server";
import { processReport, type ReportInput } from "@/lib/submissions/reports";
import { validateSameOriginJson } from "@/lib/security/requestOrigin";

function submitterTokenFromRequest(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for") ?? "";
  const primaryIp = forwarded.split(",")[0]?.trim();
  const ua = req.headers.get("user-agent") ?? "unknown";
  return `${primaryIp || "no-ip"}|${ua.slice(0, 80)}`;
}

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

  const result = processReport(body as ReportInput, submitterTokenFromRequest(req));
  const headers = new Headers({ "Cache-Control": "no-store" });
  if (!result.ok && result.code === "rate_limited" && "retryAfterSec" in result) {
    headers.set("Retry-After", String(result.retryAfterSec));
  }
  return NextResponse.json(result, { status: result.status, headers });
}
