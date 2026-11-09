import { expect, test } from "vitest";
import { buildSecurityHeaders } from "./headers";

test("security headers include frame-src allowlist and restrictive permissions policy", () => {
  const headers = buildSecurityHeaders(["https://example.org"]);
  expect(headers["Content-Security-Policy"]).toContain(
    "frame-src 'self' https://example.org",
  );
  expect(headers["Permissions-Policy"]).toContain("camera=()");
});

test("fixtures can opt in to self frame ancestors for local iframe testing", () => {
  const headers = buildSecurityHeaders(["https://example.org"], { frameAncestors: "'self'" });
  expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
});
