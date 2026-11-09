/** @vitest-environment node */
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { proxy } from "./proxy";

const originalEnv = { ...process.env };
const authorization = `Basic ${Buffer.from("preview-user:dummy-password").toString("base64")}`;

beforeEach(() => {
  process.env.STUMBLR_BASIC_AUTH_USERNAME = "preview-user";
  process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 =
    "WdRiVx/TTKTXj5g/XKZ/3sUz5XbpQXVXuevX4SWkgss=";
});

afterEach(() => {
  process.env = { ...originalEnv };
});

function request(path: string, host = "preview.example", auth?: string) {
  return new NextRequest(`https://${host}${path}`, {
    headers: auth ? { authorization: auth } : undefined,
  });
}

describe("private access proxy", () => {
  test.each(["/", "/api/suggestions", "/brand/stumblr-symbol.svg", "/_next/static/chunk.js"])(
    "challenges an unauthorized app, API, or asset request: %s",
    (path) => {
      const response = proxy(request(path));
      expect(response.status).toBe(401);
      expect(response.headers.get("www-authenticate")).toBe('Basic realm="Stumblr Private Preview", charset="UTF-8"');
      expect(response.headers.get("cache-control")).toBe("no-store");
    },
  );

  test("does not trust or bypass a direct-origin hostname", () => {
    expect(proxy(request("/", "stumblr-private.onrender.com")).status).toBe(401);
  });

  test.each(["/%68ealthz", "/healthz/", "/healthz%2fanything"])(
    "does not treat an encoded or extended health path as public: %s",
    (path) => {
      expect(proxy(request(path)).status).toBe(401);
    },
  );

  test("allows only exact health path through the proxy", () => {
    expect(proxy(request("/healthz")).status).toBe(200);
  });

  test("fails closed on non-health paths when configuration is absent", () => {
    delete process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
    expect(proxy(request("/", "preview.example", authorization)).status).toBe(503);
  });

  test("allows valid credentials regardless of hostname", () => {
    const response = proxy(request("/", "stumblr-private.onrender.com", authorization));
    expect(response.status).toBe(200);
  });
});

 test("explicit public mode requires no credentials", () => {
  process.env.STUMBLR_ACCESS_MODE = "public";
  delete process.env.STUMBLR_BASIC_AUTH_USERNAME;
  delete process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
  expect(proxy(request("/")).status).toBe(200);
  expect(proxy(request("/api/suggestions")).status).toBe(200);
 });
 test("unknown access mode never enables public access", () => {
  process.env.STUMBLR_ACCESS_MODE = "PUBLIC";
  delete process.env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
  expect(proxy(request("/")).status).toBe(503);
 });
