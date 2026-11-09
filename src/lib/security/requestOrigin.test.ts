import { NextRequest } from "next/server";
import { expect, test } from "vitest";
import { validateSameOriginJson } from "./requestOrigin";

function request(headers: Record<string, string>) {
  return new NextRequest("https://preview.example/api/suggestions", {
    method: "POST",
    headers,
    body: "{}",
  });
}

test("allows same-origin JSON submission", () => {
  expect(
    validateSameOriginJson(
      request({ origin: "https://preview.example", "content-type": "application/json" }),
    ),
  ).toBeNull();
});

test("allows the configured HTTPS origin behind an HTTP reverse proxy", () => {
  const proxiedRequest = new NextRequest("http://127.0.0.1:3000/api/suggestions", {
    method: "POST",
    headers: {
      origin: "https://stumblr-private-preview.onrender.com",
      host: "127.0.0.1:3000",
      "x-forwarded-host": "attacker.example",
      "x-forwarded-proto": "http",
      "content-type": "application/json",
    },
    body: "{}",
  });

  expect(
    validateSameOriginJson(proxiedRequest, {
      STUMBLR_EXPECTED_ORIGIN: "https://stumblr-private-preview.onrender.com",
    }),
  ).toBeNull();
});

test("allows Render's automatic external URL without an explicit override", () => {
  const proxiedRequest = new NextRequest("http://127.0.0.1:3000/api/suggestions", {
    method: "POST",
    headers: {
      origin: "https://stumblr-private-preview.onrender.com",
      host: "attacker.example",
      "x-forwarded-host": "another-attacker.example",
      "x-forwarded-proto": "http",
      "content-type": "application/json",
    },
    body: "{}",
  });

  expect(
    validateSameOriginJson(proxiedRequest, {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://stumblr-private-preview.onrender.com",
    }),
  ).toBeNull();
});

test("gives the explicit origin override priority over Render's automatic URL", () => {
  expect(
    validateSameOriginJson(
      request({ origin: "https://preview.example", "content-type": "application/json" }),
      {
        STUMBLR_EXPECTED_ORIGIN: "https://preview.example",
        RENDER: "true",
        RENDER_EXTERNAL_URL: "https://stumblr-private-preview.onrender.com",
      },
    ),
  ).toBeNull();
});

test.each([
  "https://attacker.example",
  "https://stumblr-private-preview.onrender.com.evil.example",
  "https://stumblr-private-preview.onrender.com/path",
])("denies origin %s when the public origin is configured", (origin) => {
  expect(
    validateSameOriginJson(
      request({ origin, "content-type": "application/json" }),
      { STUMBLR_EXPECTED_ORIGIN: "https://stumblr-private-preview.onrender.com" },
    )?.status,
  ).toBe(403);
});

test.each([
  "",
  "http://preview.example",
  "javascript:alert(1)",
  "https://user:password@preview.example",
  "https://preview.example/path",
  "https://preview.example?query=yes",
  "https://preview.example#fragment",
])("fails closed when the explicit origin is malformed: %s", (explicitOrigin) => {
  expect(
    validateSameOriginJson(
      request({ origin: "https://preview.example", "content-type": "application/json" }),
      { STUMBLR_EXPECTED_ORIGIN: explicitOrigin },
    )?.status,
  ).toBe(403);
});

test("does not fall back to Render's URL when the explicit override is malformed", () => {
  expect(
    validateSameOriginJson(
      request({
        origin: "https://stumblr-private-preview.onrender.com",
        "content-type": "application/json",
      }),
      {
        STUMBLR_EXPECTED_ORIGIN: "https://preview.example/path",
        RENDER: "true",
        RENDER_EXTERNAL_URL: "https://stumblr-private-preview.onrender.com",
      },
    )?.status,
  ).toBe(403);
});

test.each([
  undefined,
  "",
  "http://stumblr-private-preview.onrender.com",
  "https://user@stumblr-private-preview.onrender.com",
  "https://stumblr-private-preview.onrender.com/path",
  "https://stumblr-private-preview.onrender.com?query=yes",
  "https://stumblr-private-preview.onrender.com#fragment",
  "https://stumblr-private-preview.onrender.com:8443",
  "https://onrender.com",
  "https://stumblr-private-preview.onrender.com.evil.example",
  "https://preview.example",
])("fails closed on Render when the automatic external URL is %s", (renderExternalUrl) => {
  expect(
    validateSameOriginJson(
      request({ origin: "https://preview.example", "content-type": "application/json" }),
      { RENDER: "true", RENDER_EXTERNAL_URL: renderExternalUrl },
    )?.status,
  ).toBe(403);
});

test.each([
  [{ "content-type": "application/json" }, 403],
  [{ origin: "https://attacker.example", "content-type": "application/json" }, 403],
  [{ origin: "null", "content-type": "application/json" }, 403],
  [{ origin: "https://preview.example", "content-type": "text/plain" }, 415],
  [{ origin: "https://preview.example" }, 415],
] as const)("rejects unsafe submission headers %s", (headers, status) => {
  expect(validateSameOriginJson(request(headers))?.status).toBe(status);
});
