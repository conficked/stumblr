import { NextRequest, NextResponse } from "next/server";
import { Topic } from "@/lib/catalogue/types";
import { processSuggestion } from "@/lib/submissions/service";
import { validateSameOriginJson } from "@/lib/security/requestOrigin";
import { submitterKeyFromHeaders } from "@/lib/security/submitter";

export async function POST(req: NextRequest) {
  const requestRejection = validateSameOriginJson(req);
  if (requestRejection) return requestRejection;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { ok: false, code: "invalid_json", message: "Invalid JSON payload." },
      { status: 400 },
    );
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, code: "invalid_payload", message: "Request body must be an object." },
      { status: 400 },
    );
  }

  const payload = body as {
    url?: string;
    title?: string;
    note?: string;
    topics?: string[];
  };
  const allowedTopics = new Set<Topic>([
    "art",
    "science",
    "maps",
    "music",
    "games",
    "culture",
    "archives",
    "education",
    "nature",
    "tech",
  ]);
  const url = typeof payload.url === "string" ? payload.url : "";
  const topics =
    payload.topics?.filter((topic): topic is Topic => allowedTopics.has(topic as Topic)) ?? undefined;
  if (!url.trim()) {
    return NextResponse.json(
      { ok: false, code: "missing_url", message: "URL is required." },
      { status: 400 },
    );
  }

  const result = await processSuggestion(
    {
      url,
      title: payload.title,
      note: payload.note,
      topics,
    },
    submitterKeyFromHeaders(req.headers),
  );

  const headers = new Headers();
  if (!result.ok && result.code === "rate_limited" && result.retryAfterSec) {
    headers.set("Retry-After", String(result.retryAfterSec));
  }
  return NextResponse.json(result, { status: result.status, headers });
}
