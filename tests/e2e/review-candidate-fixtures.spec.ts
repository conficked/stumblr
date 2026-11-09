import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const execute = promisify(execFile);
const script = path.resolve("scripts/qualify_review_candidates.mjs");
function documentIdentity(value: string) {
  return { final_url_origin: new URL(value).origin, final_url_sha256: createHash("sha256").update(value).digest("hex") };
}

type Evidence = {
  canonical_url: string;
  render_result: string;
  meaningful_text_length: number;
  document_http_status: number | null;
  final_url_identity: ReturnType<typeof documentIdentity> | null;
  functionality_result: string;
  network_failure_reasons: string[];
  interaction_evidence: { attempted: boolean; visible_state_changed: boolean };
  observed_at: string;
  device: string;
  console_failure_reasons: string[];
  frame_failure_reasons: string[];
};

test.describe("review candidate qualification", () => {
  test.describe.configure({ mode: "serial" });
  let server: Server;
  let harnessServer: Server;
  let privateServer: Server;
  let privateOrigin: string;
  let privateHTTPSOrigin: string;
  let destinationOrigin: string;
  let privateConnections = 0;
  let loopRequests = 0;
  let readinessClicks = 0;
  const longTerminal = "/long-terminal?" + "x".repeat(5500);
  const oversizedTerminal = "/long-terminal?" + "x".repeat(18000);
  const fixtureFlags = () => ["--host-origin", hostOrigin, "--fixture-origins", JSON.stringify([hostOrigin, destinationOrigin])];
  let hostOrigin: string;
  let directory: string;
  let input: string;
  let original: string;
  let rows: Evidence[];
  const fixtures = ["meaningful", "blank", "login", "denied", "csp-denied", "timeout", "interactive", "nested-denied", "nested-failed", "not-found", "unavailable", "passwordless", "canvas", "redirect-meaningful"];

  test.beforeAll(async () => {
    directory = await mkdtemp(path.join(tmpdir(), "review-qualification-"));
    privateServer = createServer((_request, response) => response.end("Private trap must never be accessed"));
    privateServer.on("connection", () => { privateConnections += 1; });
    await new Promise<void>((resolve) => privateServer.listen(0, "127.0.0.1", resolve));
    const privateAddress = privateServer.address();
    if (!privateAddress || typeof privateAddress === "string") throw new Error("private server missing address");
    privateOrigin = `http://127.0.0.1:${privateAddress.port}`;
    privateHTTPSOrigin = privateOrigin.replace("http:", "https:");
    server = createServer({ maxHeaderSize: 32768 }, (request, response) => {
      const fixture = request.url?.slice(1);
      if (fixture === "timeout") return;
      if (fixture === "readiness-click") {
        readinessClicks += 1;
        response.end("Recorded one control action");
        return;
      }
      if (fixture === "redirect-loop") {
        loopRequests += 1;
        response.writeHead(302, { Location: "/redirect-loop" });
        response.end();
        return;
      }
      if (fixture === "oversized-headers") {
        response.setHeader("X-Fixture-Large", "x".repeat(20000));
        response.end("Headers exceed the bounded preflight limit");
        return;
      }
      if (fixture === "worker.js") {
        response.setHeader("Content-Type", "application/javascript");
        response.end(`importScripts(${JSON.stringify(privateHTTPSOrigin + "/worker-hit")});`);
        return;
      }
      if (fixture === "network-failure") {
        request.socket.destroy();
        return;
      }
      response.setHeader("Content-Type", "text/html");
      if (fixture === "long-document-redirect") {
        response.writeHead(302, { Location: longTerminal });
        response.end();
        return;
      }
      if (fixture === "oversized-document-navigation") {
        response.end(`<!doctype html><script>location.replace(${JSON.stringify(oversizedTerminal)})</script>`);
        return;
      }
      if (fixture?.startsWith("long-terminal?")) {
        response.end("<h1>Explore the night sky</h1><p>This meaningful document was reached through an unusually long same-origin URL.</p><script>console.error(location.href)</script>");
        return;
      }
      if (fixture === "redirect-private" || fixture === "redirect-meaningful") {
        response.writeHead(302, { Location: fixture === "redirect-private" ? privateHTTPSOrigin + "/redirect-hit" : "/meaningful" });
        response.end();
        return;
      }
      if (fixture === "terminal-300") {
        response.statusCode = 300;
        response.setHeader("Location", "/meaningful");
      }
      if (fixture === "redirect-no-location") response.statusCode = 302;
      if (fixture === "not-found") response.statusCode = 404;
      if (fixture === "unavailable") response.statusCode = 503;
      if (fixture === "denied") response.setHeader("X-Frame-Options", "DENY");
      if (fixture === "csp-denied") response.setHeader("Content-Security-Policy", "frame-ancestors 'none'");
      const bodies: Record<string, string> = {
        meaningful: "<h1>Explore the night sky</h1><p>Discover constellations, their stories and the stars visible above your city tonight. This guide is open for everyone to explore.</p><script>console.error('fixture console failure')</script>",
        "nested-denied": '<h1>Open astronomy guide</h1><p>This meaningful destination remains readable when embedded advertisements refuse framing.</p><iframe src="/denied"></iframe><iframe src="/csp-denied"></iframe>',
        "nested-failed": '<h1>Open astronomy guide</h1><p>This meaningful destination remains readable when an unrelated child frame cannot connect.</p><iframe src="/network-failure"></iframe>',
        "terminal-300": '<h1>Multiple choices</h1><p>This terminal redirect-class response is not successful content, even when it contains enough visible text.</p><button type="button" onclick="document.body.textContent=\'Unexpected action\'">Choose</button>',
        "redirect-no-location": '<h1>Redirect unavailable</h1><p>This response has no Location header and must retain its status instead of being treated as working content.</p>',
        "not-found": "<h1>Page not found</h1><p>The requested destination no longer exists. This long error explanation is not a working application.</p>",
        unavailable: "<h1>Service unavailable</h1><p>The application is down for maintenance. This long error explanation is not a working application.</p>",
        passwordless: '<h1>Sign in to continue</h1><p>Use your account to access this application.</p><label>Email<input type="email"></label><button type="button" onclick="document.body.textContent=\'Authentication clicked\'">Continue with Google</button>',
        "delayed-render": '<script>setTimeout(() => { document.body.innerHTML = "<h1>Hydrated astronomy guide</h1><p>The application has now rendered enough visible content to explore its open astronomy guide.</p>"; }, 250)</script>',
        "delayed-control": '<script>setTimeout(() => { document.body.innerHTML = `<button type="button" onclick="document.querySelector(\'output\').textContent=\'The control changed visible state exactly once\';fetch(\'/readiness-click\')">Try</button><output></output>`; }, 250)</script>',
        "never-render": '<script>setInterval(() => { document.body.dataset.tick = String(Date.now()); }, 25)</script>',
        canvas: '<canvas width="200" height="100" style="background:blue"></canvas>',
        "script-private": `<h1>Redirecting to a private network</h1><script>location.href=${JSON.stringify(privateHTTPSOrigin + "/script-hit")}</script>`,
        "nested-private": `<h1>Open astronomy guide</h1><p>This readable destination includes an untrusted child which must not reach an undeclared loopback origin.</p><iframe src="${privateHTTPSOrigin}/nested-hit"></iframe>`,
        "subresource-private": `<h1>Open astronomy guide</h1><p>Required scripts cannot be assumed functional when unsafe resource requests have been blocked.</p><script src="${privateHTTPSOrigin}/script.js"></script><img src="${privateHTTPSOrigin}/image.png"><link rel="stylesheet" href="${privateHTTPSOrigin}/style.css"><link rel="preconnect" href="${privateHTTPSOrigin}"><script>fetch(${JSON.stringify(privateHTTPSOrigin + "/fetch-hit")}).catch(()=>{});new WebSocket(${JSON.stringify(privateOrigin.replace("http:", "ws:") + "/socket-hit")});new Worker('/worker.js');try{new RTCPeerConnection()}catch{}</script>`,
        blank: "<p hidden>This hidden text must not count as meaningful visible content.</p>",
        login: "<h1>Sign in</h1><form><label>Email<input type=email></label><label>Password<input type=password></label><button>Log in</button></form>",
        denied: "<h1>This destination explicitly refuses embedding.</h1>",
        "csp-denied": "<h1>This destination refuses embedding with CSP.</h1>",
        interactive: "<h1>Color playground</h1><p>Press the control to reveal a new color and explore how this little playground changes.</p><button type=button onclick=\"document.querySelector('output').textContent='The selected color is now blue'\">Change color</button><output>The selected color is red</output>",
      };
      response.end(`<!doctype html><html><body>${bodies[fixture ?? ""] ?? ""}</body></html>`);
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("fixture server missing address");
    destinationOrigin = `http://127.0.0.1:${address.port}`;
    harnessServer = createServer((_request, response) => {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><html><body></body></html>");
    });
    await new Promise<void>((resolve) => harnessServer.listen(0, "::1", resolve));
    const hostAddress = harnessServer.address();
    if (!hostAddress || typeof hostAddress === "string") throw new Error("harness server missing address");
    hostOrigin = `http://[::1]:${hostAddress.port}`;
    input = path.join(directory, "candidates.json");
    original = JSON.stringify(fixtures.map((fixture) => ({ canonical_url: `http://127.0.0.1:${address.port}/${fixture}`, review_status: "pending" })));
    await writeFile(input, original);
  });

  test.afterAll(async () => {
    privateServer?.closeAllConnections();
    await new Promise<void>((resolve) => privateServer?.close(() => resolve()));
    harnessServer?.closeAllConnections();
    await new Promise<void>((resolve) => harnessServer?.close(() => resolve()));
    server?.closeAllConnections();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  // Catches missing qualifier, altered candidate state, and missing device observations.
  test("emits evidence for a bounded candidate artifact without changing its review state", async () => {
    const output = path.join(directory, "evidence.json");
    const result = await execute(process.execPath, [script, input, output, ...fixtureFlags(), "--max-candidates", "14", "--timeout-ms", "1500", "--budget-ms", "45000"])
      .then(() => 0, (error) => error.code);
    expect(result).toBe(0);
    rows = JSON.parse(await readFile(output, "utf8"));
    expect(rows).toHaveLength(28);
    expect(await readFile(input, "utf8")).toBe(original);
    for (const row of rows) {
      expect(["desktop", "mobile"]).toContain(row.device);
      expect(Number.isNaN(Date.parse(row.observed_at))).toBe(false);
      expect(row).not.toHaveProperty("review_status");
    }
  });

  test("waits for delayed evidence and probes a delayed control once, with bounded blank-page grace", async () => {
    const hydrationInput = path.join(directory, "hydration.json");
    const output = path.join(directory, "hydration-evidence.json");
    await writeFile(hydrationInput, JSON.stringify(["delayed-render", "delayed-control", "never-render"].map((name) => ({ canonical_url: destinationOrigin + "/" + name }))));
    const started = Date.now();
    await execute(process.execPath, [script, hydrationInput, output, ...fixtureFlags(), "--max-candidates", "3", "--timeout-ms", "2000", "--budget-ms", "12000"], { timeout: 15000 });
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(Date.now() - started).toBeLessThan(12000);
    expect(evidence).toHaveLength(6);
    for (const row of evidence) {
      expect(row.document_http_status).toBe(200);
      if (row.canonical_url.endsWith("/delayed-render")) {
        expect(row.render_result, JSON.stringify(row)).toBe("text_observed");
        expect(row.meaningful_text_length).toBeGreaterThan(40);
        expect(row.interaction_evidence.attempted).toBe(false);
      } else if (row.canonical_url.endsWith("/delayed-control")) {
        expect(row.render_result, JSON.stringify(row)).toBe("interaction_observed");
        expect(row.interaction_evidence).toMatchObject({ attempted: true, visible_state_changed: true });
      } else {
        expect(row.render_result, JSON.stringify(row)).toBe("blank");
        expect(row.meaningful_text_length).toBe(0);
        expect(row.interaction_evidence.attempted).toBe(false);
        expect(row.frame_failure_reasons).toEqual([]);
      }
    }
    expect(readinessClicks).toBe(2);
  });

  test("records terminal 3xx documents as errors and only the final response of followed redirects", async () => {
    const redirectsInput = path.join(directory, "terminal-redirects.json");
    const output = path.join(directory, "terminal-redirects-evidence.json");
    await writeFile(redirectsInput, JSON.stringify(["terminal-300", "redirect-no-location", "redirect-meaningful"].map((name) => ({ canonical_url: destinationOrigin + "/" + name }))));
    await execute(process.execPath, [script, redirectsInput, output, ...fixtureFlags(), "--max-candidates", "3", "--timeout-ms", "1500", "--budget-ms", "12000"]);
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(evidence).toHaveLength(6);
    for (const row of evidence) {
      if (row.canonical_url.endsWith("/redirect-meaningful")) {
        expect(row.document_http_status).toBe(200);
        expect(row.final_url_identity).toEqual(documentIdentity(destinationOrigin + "/meaningful"));
        expect(row.render_result).toBe("text_observed");
      } else {
        expect(row.document_http_status, JSON.stringify(row)).toBe(row.canonical_url.endsWith("/terminal-300") ? 300 : 302);
        expect(row.final_url_identity).toEqual(documentIdentity(row.canonical_url));
        expect(row.render_result).toBe("http_error");
      }
      expect(row.functionality_result).toBe("not_demonstrated");
      expect(row.interaction_evidence.attempted).toBe(false);
    }
  });

  test("emits bounded long document URLs and keeps oversized terminal evidence importable", async () => {
    const urlInput = path.join(directory, "long-document-urls.json");
    const output = path.join(directory, "long-document-evidence.json");
    const candidates = ["long-document-redirect", "oversized-document-navigation"];
    await writeFile(urlInput, JSON.stringify(candidates.map(name => ({ canonical_url: destinationOrigin + "/" + name }))));
    await execute(process.execPath, [script, urlInput, output, ...fixtureFlags(), "--max-candidates", "2", "--timeout-ms", "2500", "--budget-ms", "15000"]);
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(evidence).toHaveLength(4);
    for (const row of evidence) {
      expect(row.document_http_status).toBe(200);
      if (row.canonical_url.endsWith("/long-document-redirect")) {
        expect(row.final_url_identity).toEqual(documentIdentity(destinationOrigin + longTerminal));
        expect(JSON.stringify(row)).not.toContain("/long-terminal?");
        expect(row.render_result).toBe("text_observed");
      } else {
        expect(row.final_url_identity === null, "oversized final URL must be omitted").toBe(true);
        expect(row.render_result).toBe("inconclusive");
        expect(row.frame_failure_reasons).toContain("final document URL exceeds evidence limit");
      }
    }
  });

  for (const [fixture, expected] of [
    ["meaningful", "text_observed"], ["blank", "blank"], ["login", "login_only"],
    ["denied", "frame_denied"], ["csp-denied", "frame_denied"], ["timeout", "timeout"], ["interactive", "interaction_observed"], ["nested-denied", "text_observed"], ["nested-failed", "text_observed"], ["not-found", "http_error"], ["unavailable", "http_error"], ["passwordless", "login_only"], ["canvas", "inconclusive"], ["redirect-meaningful", "text_observed"],
  ]) {
    // Catches false render positives, ignored embedding headers, and unbounded loads.
    test(`classifies ${fixture} as ${expected} on both devices`, () => {
      const observations = rows.filter((row) => row.canonical_url.endsWith(`/${fixture}`));
      expect(observations).toHaveLength(2);
      for (const row of observations) {
        expect(row.render_result, JSON.stringify(row)).toBe(expected);
        if (expected === "frame_denied" || expected === "timeout") expect(row.frame_failure_reasons.length).toBeGreaterThan(0);
        if (fixture.startsWith("nested-")) {
          expect(row.meaningful_text_length).toBeGreaterThan(40);
          expect(row.frame_failure_reasons.some((reason) => reason.startsWith("nested: "))).toBe(true);
        }
        if (fixture === "nested-denied") expect(row.console_failure_reasons.some((reason) => /x-frame-options|frame-ancestors/i.test(reason))).toBe(true);
        if (fixture === "blank") expect(row.meaningful_text_length).toBe(0);
        if (fixture === "meaningful") expect(row.console_failure_reasons).toContain("browser console error");
        if (fixture === "interactive") expect(row.interaction_evidence).toMatchObject({ attempted: true, visible_state_changed: true });
        if (fixture === "login" || fixture === "passwordless") expect(row.interaction_evidence.attempted).toBe(false);
        if (fixture === "not-found" || fixture === "unavailable") {
          expect(row.document_http_status).toBe(fixture === "not-found" ? 404 : 503);
          expect(row.functionality_result).toBe("not_demonstrated");
          expect(row.interaction_evidence.attempted).toBe(false);
        }
        if (fixture === "meaningful") expect(row.functionality_result).toBe("not_demonstrated");
        if (fixture === "interactive") expect(row.functionality_result).toBe("demonstrated");
        if (fixture === "canvas") expect(row.functionality_result).toBe("inconclusive");
        if (fixture === "redirect-meaningful") {
          expect(row.document_http_status).toBe(200);
          expect(row.final_url_identity).toEqual(documentIdentity(destinationOrigin + "/meaningful"));
        }
      }
    });
  }


  test("blocks private candidates and all redirect, script, nested and subresource egress before connection", async () => {
    const networkInput = path.join(directory, "network.json");
    const output = path.join(directory, "network-evidence.json");
    const urls = [privateOrigin + "/candidate-hit", ...["redirect-private", "script-private", "nested-private", "subresource-private"].map((name) => destinationOrigin + "/" + name)];
    await writeFile(networkInput, JSON.stringify(urls.map((url) => ({ canonical_url: url }))));
    await execute(process.execPath, [script, networkInput, output, ...fixtureFlags(), "--max-candidates", "5", "--timeout-ms", "2000"]);
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(privateConnections).toBe(0);
    expect(evidence).toHaveLength(10);
    for (const row of evidence) {
      expect(row.network_failure_reasons.length).toBeGreaterThan(0);
      if (row.canonical_url.endsWith("/nested-private")) expect(row.render_result, JSON.stringify(row)).toBe("text_observed");
      else if (row.canonical_url.endsWith("/subresource-private")) {
        expect(row.render_result, JSON.stringify(row)).toBe("inconclusive");
        expect(row.network_failure_reasons).toContain("resource: alternate transport disabled");
      }
      else expect(row.render_result, JSON.stringify(row)).toBe("network_blocked");
    }
  });

  test("blocks HTTP and private/reserved IP literals in normal mode", async () => {
    const networkInput = path.join(directory, "normal-network.json");
    const output = path.join(directory, "normal-network-evidence.json");
    const urls = [privateOrigin + "/normal-hit", "https://localhost/", "https://127.0.0.1/", "https://10.0.0.1/", "https://169.254.169.254/", "https://192.168.1.1/", "https://100.64.0.1/", "https://192.0.2.1/", "https://[::1]/", "https://[::ffff:127.0.0.1]/", "https://[fe80::1]/", "https://[2001:db8::1]/"];
    await writeFile(networkInput, JSON.stringify(urls.map((url) => ({ canonical_url: url }))));
    await execute(process.execPath, [script, networkInput, output, "--max-candidates", String(urls.length)]);
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(privateConnections).toBe(0);
    expect(evidence).toHaveLength(urls.length * 2);
    for (const row of evidence) {
      expect(row.render_result, JSON.stringify(row)).toBe("network_blocked");
      expect(row.document_http_status).toBeNull();
      expect(row.network_failure_reasons.length).toBeGreaterThan(0);
    }
  });

  test("bounds redirect preflight hops and response headers", async () => {
    const preflightInput = path.join(directory, "preflight-bounds.json");
    const output = path.join(directory, "preflight-bounds-evidence.json");
    await writeFile(preflightInput, JSON.stringify(["redirect-loop", "oversized-headers"].map((name) => ({ canonical_url: destinationOrigin + "/" + name }))));
    await execute(process.execPath, [script, preflightInput, output, ...fixtureFlags(), "--max-candidates", "2"]);
    const evidence: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(loopRequests).toBe(6);
    expect(evidence).toHaveLength(4);
    for (const row of evidence) {
      expect(row.render_result).toBe("network_blocked");
      expect(row.document_http_status).toBeNull();
    }
    expect(evidence.filter((row) => row.canonical_url.endsWith("/redirect-loop")).every((row) => row.network_failure_reasons.includes("candidate: redirect_limit"))).toBe(true);
  });

  test("requires explicit safe fixture-origin declarations", async () => {
    for (const origins of [[hostOrigin, "http://10.0.0.1"], [hostOrigin, "http://localhost"], [destinationOrigin], []]) {
      const result = await execute(process.execPath, [script, input, path.join(directory, "invalid-origins.json"), "--host-origin", hostOrigin, "--fixture-origins", JSON.stringify(origins), "--max-candidates", "1"])
        .then(() => 0, (error) => error.code);
      expect(result).toBe(1);
      await expect(readFile(path.join(directory, "invalid-origins.json"))).rejects.toThrow();
    }
  });

  test("caps observations at the requested candidate count", async () => {
    const output = path.join(directory, "bounded.json");
    await execute(process.execPath, [script, input, output, ...fixtureFlags(), "--max-candidates", "1"]);
    const bounded: Evidence[] = JSON.parse(await readFile(output, "utf8"));
    expect(bounded).toHaveLength(2);
    expect(bounded.every((row) => row.canonical_url.endsWith("/meaningful"))).toBe(true);
  });

  test("rejects non-loopback harness overrides", async () => {
    for (const origin of ["https://example.com", "http://127.0.0.1.evil.example", "http://user:secret@127.0.0.1", "file:///tmp/host"]) {
      const result = await execute(process.execPath, [script, input, path.join(directory, "unsafe.json"), "--max-candidates", "1", "--host-origin", origin, "--fixture-origins", JSON.stringify([origin, destinationOrigin])])
        .then(() => 0, (error) => error.code);
      expect(result).toBe(1);
      await expect(readFile(path.join(directory, "unsafe.json"))).rejects.toThrow();
    }
  });

  test("rejects zero and oversized limits before browsing", async () => {
    for (const count of ["0", "221"]) {
      const result = await execute(process.execPath, [script, input, path.join(directory, "invalid.json"), "--max-candidates", count])
        .then(() => 0, (error) => error.code);
      expect(result).toBe(1);
      await expect(readFile(path.join(directory, "invalid.json"))).rejects.toThrow();
    }
  });
});
