import { test, expect } from "@playwright/test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execute = promisify(execFile);
const revision = `${"a".repeat(40)}:1234:1`;
const readingText = "A guide to distant constellations and the stories people told about the stars above them. ".repeat(7);

async function listen(server: Server) {
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server address is missing");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server: Server) {
  server.closeAllConnections();
  await new Promise<void>(resolve => server.close(() => resolve()));
}

test("proves fresh additions in desktop and mobile sandboxes and reports only hard failures for rollback", async () => {
  test.setTimeout(45_000);
  const directory = await mkdtemp(join(tmpdir(), "stumblr-production-proof-"));
  const destination = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    if (request.url === "/frame-denied") response.setHeader("X-Frame-Options", "DENY");
    const bodies: Record<string, string> = {
      "/interactive": `<h1>Color playground</h1><button type="button" onclick="document.querySelector('output').textContent='The new color is now blue'">Change color</button><output>The current color is red</output>`,
      "/reading": `<article><h1>Mapping the night sky</h1><p>${readingText}</p></article>`,
      "/blank": "<p hidden>Hidden text is insufficient.</p>",
      "/frame-denied": `<article>${readingText}</article>`,
      "/already-live": "",
    };
    response.end(`<!doctype html><body>${bodies[request.url ?? ""]}</body>`);
  });
  const destinationOrigin = await listen(destination);
  const fresh = ["interactive", "reading", "blank", "frame-denied"];
  const expectedRevision = "b".repeat(40);
  const entries = [...fresh, "already-live"].map(id => ({
    id, canonicalUrl: `${destinationOrigin}/${id}`, status: "evaluation_only",
  }));
  const api = createServer((request, response) => {
    if (request.url !== "/api/catalogue") {
      response.setHeader("Content-Type", "text/html");
      response.end("<!doctype html><body></body>");
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ revision: expectedRevision, entries: [entries.at(-1)] }));
  });
  const origin = await listen(api);
  try {
    const output = join(directory, "proof.json");
    const input = join(directory, "stage.json");
    await writeFile(input, JSON.stringify({
      status: "pending", revision, expectedRevision, addedIds: fresh, entries, entryCount: entries.length,
      contentSecurityPolicy: `frame-src ${destinationOrigin}`,
    }));
    const run = await execute(process.execPath, [
      "scripts/verify_auto_publication.mjs", "--base-url", origin, "--revision", revision,
      "--candidate-ids", JSON.stringify(fresh), "--output", output,
    ], { timeout: 35_000, env: { ...process.env, STUMBLR_AUTO_PROOF_INPUT: input } }).then(() => ({ code: 0, stderr: "" }), error => ({ code: error.code, stderr: error.stderr }));
    const proof = JSON.parse(await readFile(output, "utf8"));
    expect(run.code, `${run.stderr} ${JSON.stringify(proof)}`).toBe(2);
    expect(proof).toMatchObject({
      revision, entryCount: 5, failedIds: ["blank", "frame-denied"], unverifiedIds: [],
      rollbackPayload: { releaseRevision: revision, failedIds: ["blank", "frame-denied"] },
      candidates: [
        { id: "interactive", devices: { desktop: "interaction_observed", mobile: "interaction_observed" } },
        { id: "reading", devices: { desktop: "text_observed", mobile: "text_observed" } },
        { id: "blank", devices: { desktop: "blank", mobile: "blank" } },
        { id: "frame-denied", devices: { desktop: "frame_denied", mobile: "frame_denied" } },
      ],
    });
    expect(JSON.stringify(proof)).not.toContain(destinationOrigin);

    const mismatched = join(directory, "wrong-revision.json");
    const wrongRevision = revision.replace(":1234:", ":1235:");
    const wrong = await execute(process.execPath, [
      "scripts/verify_auto_publication.mjs", "--base-url", origin, "--revision", wrongRevision,
      "--candidate-ids", JSON.stringify(fresh), "--output", mismatched,
    ]).then(() => 0, error => error.code);
    expect(wrong).toBe(1);
    expect(JSON.parse(await readFile(mismatched, "utf8"))).toMatchObject({ rollbackPayload: null, status: "unverified" });
  } finally {
    await close(api);
    await close(destination);
    await rm(directory, { recursive: true, force: true });
  }
});


test("rejects a fresh cross-origin redirect blocked by the Stumblr frame policy", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stumblr-proof-redirect-"));
  const destination = createServer((_request, response) => {
    response.writeHead(302, { Location: `${apiOrigin}/off-origin-reading` });
    response.end();
  });
  const destinationOrigin = await listen(destination);
  const api = createServer((request, response) => {
    if (request.url === "/api/catalogue") {
      response.writeHead(200, {
        "Content-Type": "application/json",
        "Content-Security-Policy": `frame-src ${destinationOrigin}`,
      });
      response.end(JSON.stringify({
        revision, entries: [{ id: "redirected", canonicalUrl: destinationOrigin + "/redirect", status: "evaluation_only" }],
      }));
    } else {
      response.end(`<!doctype html><body><article>${readingText}</article></body>`);
    }
  });
  const apiOrigin = await listen(api);
  try {
    const output = join(directory, "proof.json");
    const code = await execute(process.execPath, [
      "scripts/verify_auto_publication.mjs", "--base-url", apiOrigin, "--revision", revision,
      "--candidate-ids", '["redirected"]', "--output", output,
    ]).then(() => 0, error => error.code);
    expect(code).toBe(2);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      rollbackPayload: { releaseRevision: revision, failedIds: ["redirected"] }, unverifiedIds: [],
    });
  } finally {
    await close(api);
    await close(destination);
    await rm(directory, { recursive: true, force: true });
  }
});

test("a reset confined to header preflight is unverified and cannot request selective rollback", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stumblr-proof-reset-"));
  const destination = createServer((request, response) => {
    if (request.url === "/blank") {
      response.end("<!doctype html><body></body>");
      return;
    }
    if (request.headers["user-agent"] === "StumblrReviewQualifier/1.0") {
      request.socket.destroy();
      return;
    }
    response.end(`<!doctype html><body><article>${readingText}</article></body>`);
  });
  const destinationOrigin = await listen(destination);
  const api = createServer((request, response) => {
    if (request.url === "/api/catalogue") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        revision, entries: [
          { id: "preflight-reset", canonicalUrl: destinationOrigin + "/reading", status: "evaluation_only" },
          { id: "blank", canonicalUrl: destinationOrigin + "/blank", status: "evaluation_only" },
        ],
      }));
    } else response.end("<!doctype html><body></body>");
  });
  const apiOrigin = await listen(api);
  try {
    expect((await fetch(destinationOrigin + "/reading")).ok).toBe(true);
    const output = join(directory, "proof.json");
    const code = await execute(process.execPath, [
      "scripts/verify_auto_publication.mjs", "--base-url", apiOrigin, "--revision", revision,
      "--candidate-ids", '["preflight-reset","blank"]', "--output", output,
    ]).then(() => 0, error => error.code);
    expect(code).toBe(1);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      status: "unverified", failedIds: ["blank"], unverifiedIds: ["preflight-reset"], rollbackPayload: null,
    });
  } finally {
    await close(api);
    await close(destination);
    await rm(directory, { recursive: true, force: true });
  }
});


test("the browser applies the staged frame-src header to a direct destination", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stumblr-proof-csp-"));
  const destination = createServer((_request, response) => response.end(`<!doctype html><body>${readingText}</body>`));
  const destinationOrigin = await listen(destination);
  const api = createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "application/json", "Content-Security-Policy": "frame-src 'none'" });
    response.end(JSON.stringify({
      revision, entries: [{ id: "blocked-by-stumblr", canonicalUrl: destinationOrigin + "/reading", status: "evaluation_only" }],
    }));
  });
  const apiOrigin = await listen(api);
  try {
    const output = join(directory, "proof.json");
    const code = await execute(process.execPath, [
      "scripts/verify_auto_publication.mjs", "--base-url", apiOrigin, "--revision", revision,
      "--candidate-ids", '["blocked-by-stumblr"]', "--output", output,
    ]).then(() => 0, error => error.code);
    expect(code).toBe(2);
    expect(JSON.parse(await readFile(output, "utf8"))).toMatchObject({
      rollbackPayload: { releaseRevision: revision, failedIds: ["blocked-by-stumblr"] },
      candidates: [{ devices: { desktop: "frame_denied", mobile: "frame_denied" } }],
    });
  } finally {
    await close(api);
    await close(destination);
    await rm(directory, { recursive: true, force: true });
  }
});
