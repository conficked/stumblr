#!/usr/bin/env node

import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const standalone = path.join(root, ".next", "standalone");
const port = 43127;
const dummyUsername = "preview-test-user";
const dummyPassword = "dummy-test-password";
const dummyVerifier = "oGvKJjYMqUOG7TuRhYFqyOHSc7Wo5uVA/+J4ihfi2Pg=";
const dummyAuthorization = `Basic ${Buffer.from(`${dummyUsername}:${dummyPassword}`).toString("base64")}`;
let temporaryDirectory;

function request(pathname, { authorization, host = "127.0.0.1", origin, contentType, forwardedHost, forwardedProto, method = "GET", body } = {}) {
  return new Promise((resolve, reject) => {
    const headers = { Host: host };
    if (authorization) headers.Authorization = authorization;
    if (origin) headers.Origin = origin;
    if (contentType) headers["Content-Type"] = contentType;
    if (forwardedHost) headers["X-Forwarded-Host"] = forwardedHost;
    if (forwardedProto) headers["X-Forwarded-Proto"] = forwardedProto;
    if (body) headers["Content-Length"] = Buffer.byteLength(body);
    const req = http.request(
      { hostname: "127.0.0.1", port, path: pathname, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer() {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try {
      return await request("/healthz");
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("standalone server did not accept connections on isolated port");
}

async function runServer({ authConfigured, originEnv }, checks) {
  const env = {
    ...process.env,
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    STUMBLR_DB_PATH: path.join(temporaryDirectory, "stumblr-ops.sqlite"),
    ...originEnv,
  };
  delete env.STUMBLR_BASIC_AUTH_USERNAME;
  delete env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256;
  if (!("STUMBLR_EXPECTED_ORIGIN" in originEnv)) delete env.STUMBLR_EXPECTED_ORIGIN;
  if (!("STUMBLR_ACCESS_MODE" in originEnv)) delete env.STUMBLR_ACCESS_MODE;
  if (!("RENDER" in originEnv)) delete env.RENDER;
  if (!("RENDER_EXTERNAL_URL" in originEnv)) delete env.RENDER_EXTERNAL_URL;
  if (authConfigured) {
    env.STUMBLR_BASIC_AUTH_USERNAME = dummyUsername;
    env.STUMBLR_BASIC_AUTH_PASSWORD_SHA256 = dummyVerifier;
  }

  const server = spawn(process.execPath, ["server.js"], {
    cwd: standalone,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const logs = [];
  server.stdout.on("data", (chunk) => logs.push(chunk));
  server.stderr.on("data", (chunk) => logs.push(chunk));
  try {
    await waitForServer();
    await checks();
  } catch (error) {
    const safeLogs = [dummyAuthorization, dummyUsername, dummyPassword, dummyVerifier].reduce(
      (output, value) => output.replaceAll(value, "[REDACTED]"),
      Buffer.concat(logs).toString("utf8"),
    );
    throw new Error(`${error.message}\nserver output:\n${safeLogs}`);
  } finally {
    if (server.exitCode === null && server.signalCode === null) {
      server.kill("SIGTERM");
      await new Promise((resolve) => server.once("exit", resolve));
    }
  }
}

function expectStatus(actual, expected, label) {
  if (actual.status !== expected) {
    throw new Error(
      `${label}: expected HTTP ${expected}, received ${actual.status} (${responseDiagnostic(actual)})`,
    );
  }
}

function responseDiagnostic(response) {
  if (response.status === 401 && response.headers["www-authenticate"]) return "auth_challenge";
  try {
    const code = JSON.parse(response.body.toString("utf8")).code;
    if (typeof code === "string" && /^[a-z_]+$/.test(code)) return `response_code=${code}`;
  } catch {
    // A non-JSON response has no safe application code to report.
  }
  return "response_code=unavailable";
}

function expectEmptyBody(actual, label) {
  if (actual.body.length !== 0) {
    throw new Error(`${label}: expected an empty response body, received ${actual.body.length} bytes`);
  }
}

function expectResponseCode(actual, expected, label) {
  let body;
  try {
    body = JSON.parse(actual.body.toString("utf8"));
  } catch {
    throw new Error(`${label}: expected JSON response_code=${expected}, received non-JSON body`);
  }
  if (body?.code !== expected) {
    throw new Error(`${label}: expected response_code=${expected}, received ${String(body?.code)}`);
  }
}

async function expectCanonicalHealthRedirect(finalStatus, label) {
  const redirect = await request("/healthz/");
  expectStatus(redirect, 308, `${label} redirect`);
  if (redirect.headers.location !== "/healthz") {
    throw new Error(
      `${label} redirect: expected Location /healthz, received ${redirect.headers.location ?? "no Location header"}`,
    );
  }

  const health = await request(redirect.headers.location);
  expectStatus(health, finalStatus, `${label} final health`);
  expectEmptyBody(health, `${label} final health`);
  if (health.headers["cache-control"] !== "no-store") {
    throw new Error(
      `${label} final health: expected Cache-Control no-store, received ${health.headers["cache-control"] ?? "no header"}`,
    );
  }
}

try {
  await mkdir(path.join(standalone, ".next"), { recursive: true });
  await cp(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true, force: true });
  await cp(path.join(root, "public"), path.join(standalone, "public"), { recursive: true, force: true });
  temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "stumblr-render-private-"));

  await runServer({
    authConfigured: false,
    originEnv: {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://stumblr-private-preview.onrender.com",
    },
  }, async () => {
    const health = await request("/healthz");
    expectStatus(health, 503, "missing-config health");
    expectEmptyBody(health, "missing-config health");
    await expectCanonicalHealthRedirect(503, "missing-config canonical health");
    expectStatus(await request("/"), 503, "missing-config app");
  });

  await runServer({
    authConfigured: true,
    originEnv: {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://stumblr-private-preview.onrender.com",
    },
  }, async () => {
    const health = await request("/healthz");
    expectStatus(health, 204, "configured health");
    expectEmptyBody(health, "configured health");
    await expectCanonicalHealthRedirect(204, "configured canonical health");
    for (const pathname of ["/", "/api/suggestions", "/brand/stumblr-symbol.svg", "/_next/static/chunks/webpack.js", "/%68ealthz"]) {
      expectStatus(await request(pathname), 401, `unauthorized ${pathname}`);
    }
    expectStatus(await request("/", { host: "stumblr-private.onrender.com" }), 401, "direct-origin host");
    expectStatus(await request("/", { authorization: dummyAuthorization }), 200, "authorized app");
    expectStatus(await request("/brand/stumblr-symbol.svg", { authorization: dummyAuthorization }), 200, "authorized asset");
    expectStatus(
      await request("/api/suggestions", {
        authorization: dummyAuthorization,
        method: "POST",
        origin: "https://stumblr-private-preview.onrender.com",
        contentType: "application/json",
        body: "not-json",
      }),
      400,
      "authorized same-origin API",
    );
    expectStatus(
      await request("/api/suggestions", {
        authorization: dummyAuthorization,
        host: "attacker.example",
        origin: "https://stumblr-private-preview.onrender.com",
        forwardedHost: "another-attacker.example",
        forwardedProto: "http",
        contentType: "application/json",
        method: "POST",
        body: "not-json",
      }),
      400,
      "authorized configured origin ignores untrusted host",
    );
    const legitimateJson = await request("/api/suggestions", {
      authorization: dummyAuthorization,
      host: "spoofed-host.invalid",
      origin: "https://stumblr-private-preview.onrender.com",
      forwardedHost: "spoofed-forwarded-host.invalid",
      forwardedProto: "http",
      contentType: "application/json; charset=utf-8",
      method: "POST",
      body: JSON.stringify({ url: "https://weavesilk.com/" }),
    });
    expectStatus(legitimateJson, 200, "authorized legitimate JSON with Render origin");
    expectResponseCode(legitimateJson, "already_in_catalogue", "authorized legitimate JSON with Render origin");
    expectStatus(
      await request("/api/suggestions", {
        authorization: dummyAuthorization,
        method: "POST",
        origin: "https://attacker.invalid",
        contentType: "application/json",
        body: "{}",
      }),
      403,
      "cross-origin API",
    );
    const missingOrigin = await request("/api/suggestions", {
      authorization: dummyAuthorization,
      contentType: "application/json",
      method: "POST",
      body: "{}",
    });
    expectStatus(missingOrigin, 403, "missing-origin API");
    expectResponseCode(missingOrigin, "origin_required", "missing-origin API");

    const wrongMedia = await request("/api/suggestions", {
      authorization: dummyAuthorization,
      origin: "https://stumblr-private-preview.onrender.com",
      contentType: "text/plain",
      method: "POST",
      body: "{}",
    });
    expectStatus(wrongMedia, 415, "non-JSON API");
    expectResponseCode(wrongMedia, "unsupported_media_type", "non-JSON API");
  });

  await runServer({
    authConfigured: true,
    originEnv: {
      RENDER: "true",
      RENDER_EXTERNAL_URL: "https://attacker.invalid",
    },
  }, async () => {
    expectStatus(await request("/healthz"), 503, "malformed-render-origin health");
    expectStatus(
      await request("/api/suggestions", {
        authorization: dummyAuthorization,
        host: "stumblr-private-preview.onrender.com",
        origin: "https://stumblr-private-preview.onrender.com",
        forwardedHost: "stumblr-private-preview.onrender.com",
        forwardedProto: "https",
        contentType: "application/json",
        method: "POST",
        body: JSON.stringify({ url: "https://weavesilk.com/" }),
      }),
      403,
      "malformed Render automatic origin cannot use request headers",
    );
  });

  await runServer({ authConfigured: false, originEnv: {
    RENDER: "true", RENDER_EXTERNAL_URL: "https://stumblr-public.onrender.com",
    STUMBLR_ACCESS_MODE: "public", STUMBLR_EXPECTED_ORIGIN: "https://stumblr.dev",
  } }, async () => {
    expectStatus(await request("/"), 200, "public UI without password");
    expectStatus(await request("/healthz"), 204, "public readiness without password");
    expectStatus(await request("/api/catalogue"), 200, "public reviewed catalogue read");
    expectStatus(await request("/api/catalogue/ingest", {method:"POST", contentType:"application/json",body:"{}"}),401,"unauthorized reviewed import denied");
    expectStatus(await request("/api/catalogue/candidates", {method:"POST", contentType:"application/json",body:"[]"}),401,"unauthorized raw import denied");
    expectStatus(await request("/api/catalogue/candidates"),401,"pending review queue remains private");
    for (const pathname of ["/api/admin", "/api/review", "/admin", "/review", "/data/stumblr-ops.sqlite", "/.env"]) {
      expectStatus(await request(pathname), 404, "no exposed private endpoint " + pathname);
    }
    const post = (body, origin = "https://stumblr.dev") => request("/api/suggestions", {
      method: "POST", contentType: "application/json", origin, body: JSON.stringify(body),
    });
    expectStatus(await post({ url: "https://weavesilk.com/" }, "https://attacker.invalid"), 403, "public cross-origin denied");
    expectStatus(await post({}), 400, "public missing URL validation");
    expectStatus(await post({ url: "http://127.0.0.1/" }), 400, "public unsafe URL rejected");
    const accepted = await post({ url: "https://weavesilk.com/" });
    expectStatus(accepted, 200, "public valid submission accepted");
    expectResponseCode(accepted, "already_in_catalogue", "public existing URL");
    const queued = await post({ url: "https://www.iana.org/domains/reserved" });
    expectStatus(queued, 201, "public fresh suggestion queued only");
    expectResponseCode(queued, "queued", "public fresh suggestion pending review");
    const duplicate = await post({ url: "https://www.iana.org/domains/reserved" });
    expectResponseCode(duplicate, "already_pending", "public queue persistence");
    for (let index = 0; index < 8; index++) await post({ url: "invalid" });
    expectStatus(await post({ url: "invalid" }), 429, "public rate limit retained");
  });

  console.log("render-private-http-check: PASS (isolated port, temp DB, credential values suppressed)");
} finally {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
}
