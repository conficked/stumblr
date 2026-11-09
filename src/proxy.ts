import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import {
  authorizeBasicHeader,
  readPrivateAccessConfig,
} from "@/lib/security/privateAccess";

import { getCatalogue, getFrameAllowlist } from "@/lib/catalogue";
import { readRuntimeCatalogue } from "@/lib/catalogue/runtimeStore";
import { buildSecurityHeaders } from "@/lib/security/headers";
function approvedResponse(request: NextRequest) {
  const response = NextResponse.next();
  if (!request.nextUrl.pathname.startsWith("/fixtures/")) {
    const entries = getCatalogue({ includeEvaluation: true }).concat(readRuntimeCatalogue().entries);
    response.headers.set("Content-Security-Policy", buildSecurityHeaders(getFrameAllowlist(entries))["Content-Security-Policy"]);
  }
  return response;
}
const PRIVATE_CACHE_HEADERS = {
  "Cache-Control": "no-store",
  Pragma: "no-cache",
};

export function proxy(request: NextRequest) {
  if (request.nextUrl.pathname === "/healthz") {
    return NextResponse.next();
  }

  if (process.env.STUMBLR_ACCESS_MODE === "public") {
    return approvedResponse(request);
  }

  const config = readPrivateAccessConfig(process.env);
  if (!config.ok) {
    return new NextResponse(null, {
      status: 503,
      headers: PRIVATE_CACHE_HEADERS,
    });
  }

  if (!authorizeBasicHeader(request.headers.get("authorization"), config)) {
    return new NextResponse(null, {
      status: 401,
      headers: {
        ...PRIVATE_CACHE_HEADERS,
        "WWW-Authenticate": 'Basic realm="Stumblr Private Preview", charset="UTF-8"',
      },
    });
  }

  return approvedResponse(request);
}

export const config = {
  matcher: "/:path*",
};
