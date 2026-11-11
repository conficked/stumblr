import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, test } from "node:test";
import worker, { DISCOVERY_CRON, PUBLISH_CRON } from "./index.js";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function capture(status = 204) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    return new Response(status === 204 ? null : "nope", { status });
  };
  return calls;
}

const at = (iso, cron) => ({ cron, scheduledTime: Date.parse(iso) });

test("hourly discovery rechecks only every sixth UTC hour", async () => {
  const calls = capture();
  await worker.scheduled(at("2026-11-12T06:17:00Z", DISCOVERY_CRON), { GITHUB_TOKEN: "t" });
  await worker.scheduled(at("2026-11-12T07:17:00Z", DISCOVERY_CRON), { GITHUB_TOKEN: "t" });
  assert.equal(calls[0].url, "https://api.github.com/repos/conficked/stumblr/actions/workflows/discovery-manual-review.yml/dispatches");
  assert.deepEqual(calls.map(call => call.body), [
    { ref: "main", inputs: { mode: "maintenance", recheck: "true" } },
    { ref: "main", inputs: { mode: "maintenance", recheck: "false" } },
  ]);
  assert.equal(calls[0].init.headers.Authorization, "Bearer t");
});

test("publish cron dispatches a real publish", async () => {
  const calls = capture();
  await worker.scheduled(at("2026-11-12T17:37:00Z", PUBLISH_CRON), { GITHUB_TOKEN: "t" });
  assert.match(calls[0].url, /catalogue-auto-publish\.yml\/dispatches$/);
  assert.deepEqual(calls[0].body, { ref: "main", inputs: { mode: "publish" } });
});

test("a rejected dispatch fails the invocation", async () => {
  capture(401);
  await assert.rejects(worker.scheduled(at("2026-11-12T08:17:00Z", DISCOVERY_CRON), { GITHUB_TOKEN: "bad" }), /401/);
});

test("wrangler crons match the handler", () => {
  const config = readFileSync(new URL("../wrangler.toml", import.meta.url), "utf8");
  assert.match(config, new RegExp(`crons = \\["${DISCOVERY_CRON.replace(/\*/g, "\\*")}", "${PUBLISH_CRON.replace(/\*/g, "\\*")}"\\]`));
});
