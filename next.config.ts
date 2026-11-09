import type { NextConfig } from "next";
import { getCatalogue, getFrameAllowlist } from "./src/lib/catalogue";
import { buildSecurityHeaders } from "./src/lib/security/headers";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingExcludes: {
    "/*": [
      "data/**/*.sqlite",
      "data/**/*.sqlite-*",
      "data/**/*.sqlite3",
      "data/**/*.sqlite3-*",
      "data/**/*.db",
      "data/**/*.db-*",
    ],
  },
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    useTypeScriptCli: false,
  },
  async headers() {
    const allowlist = getFrameAllowlist(getCatalogue({ includeEvaluation: true }));
    const headers = buildSecurityHeaders(allowlist);
    const fixtureHeaders = buildSecurityHeaders(allowlist, { frameAncestors: "'self'" });

    return [
      {
        source: "/fixtures/:path*",
        headers: Object.entries(fixtureHeaders).map(([key, value]) => ({
          key,
          value,
        })),
      },
      {
        source: "/((?!fixtures/).*)",
        headers: Object.entries(headers).filter(([key]) => key !== "Content-Security-Policy").map(([key, value]) => ({
          key,
          value,
        })),
      },
    ];
  },
};

export default nextConfig;
