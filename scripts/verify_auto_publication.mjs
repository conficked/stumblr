#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { HARNESS_PATH, observeCandidates } from "./qualify_review_candidates.mjs";
import { LOAD_TIMEOUT_MS } from "../src/components/frame-host/framePolicies.ts";

const devices = ["desktop", "mobile"];
const hardFailures = new Set(["blank", "frame_denied", "http_error", "login_only"]);
const confirmedNetworkBlocks = new Set([
  "candidate: credentials_disallowed", "candidate: https_required", "candidate: local_hostname_disallowed",
  "candidate: non_public_ip", "candidate: non_public_dns_answer", "candidate: dns_not_found",
  "candidate: cross_origin_redirect", "candidate: blocked Document outside validated HTTPS/public origins",
]);
const rendered = new Set(["text_observed", "interaction_observed"]);
const isLoopback = url => url.protocol === "http:" && ["127.0.0.1", "[::1]"].includes(url.hostname) && !url.username && !url.password;

function argumentsForProof() {
  const { values } = parseArgs({ options: {
    "base-url": { type: "string" }, revision: { type: "string" },
    "candidate-ids": { type: "string" }, output: { type: "string" },
  } });
  const base = new URL(values["base-url"]);
  if ((base.origin !== "https://stumblr.dev" && !isLoopback(base)) || base.href !== base.origin + "/") {
    throw new Error("Invalid proof origin");
  }
  const revision = values.revision;
  const ids = JSON.parse(values["candidate-ids"]);
  if (!values.output || !/^[a-f0-9]{40}:[1-9][0-9]{0,19}:[1-9][0-9]{0,15}$/.test(revision ?? "") ||
      !Array.isArray(ids) || ids.length < 1 || ids.length > 20 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== "string" || id.length < 1 || id.length > 200)) {
    throw new Error("Invalid release revision or candidate IDs");
  }
  return { base, revision, ids, output: values.output };
}

function validateCatalogue(value, revision) {
  const { revision: actual, entries } = value;
  if (actual !== revision || !Array.isArray(entries) || entries.length > 1000 ||
      entries.some(entry => typeof entry?.id !== "string") || new Set(entries.map(entry => entry.id)).size !== entries.length) {
    throw new Error("Catalogue revision or entries could not be verified");
  }
}

async function readLiveCatalogue(base, revision) {
  const response = await fetch(new URL("/api/catalogue", base), {
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("Live catalogue is unavailable");
  const catalogue = await response.json();
  validateCatalogue(catalogue, revision);
  return { ...catalogue, contentSecurityPolicy: response.headers.get("content-security-policy") };
}

function hasHardFailure(row) {
  return hardFailures.has(row.render_result) ||
    (row.render_result === "network_blocked" && row.network_failure_reasons.some(reason => confirmedNetworkBlocks.has(reason)));
}

async function verify({ base, revision, ids }) {
  const input = process.env.STUMBLR_AUTO_PROOF_INPUT;
  const catalogue = input ? JSON.parse(await readFile(input, "utf8")) : await readLiveCatalogue(base, revision);
  validateCatalogue(catalogue, revision);
  if (input && (catalogue.status !== "pending" || catalogue.entryCount !== catalogue.entries.length ||
      JSON.stringify(catalogue.addedIds) !== JSON.stringify(ids))) {
    throw new Error("Staged catalogue does not match the committed release");
  }
  const { entries, contentSecurityPolicy } = catalogue;
  const hasFramePolicy = typeof contentSecurityPolicy === "string" && /(?:^|;)\s*frame-src\s/i.test(contentSecurityPolicy);
  if (!hasFramePolicy && !isLoopback(base)) throw new Error("Missing Stumblr frame policy");
  const before = input ? await readLiveCatalogue(base, catalogue.expectedRevision) : catalogue;
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const fixtureOrigins = new Set(isLoopback(base) ? [base.origin] : []);
  const urls = ids.map(id => {
    const entry = byId.get(id);
    if (entry?.status !== "evaluation_only") throw new Error("Fresh candidate is missing from the live release");
    const url = new URL(entry.canonicalUrl);
    if (fixtureOrigins.size) {
      if (!isLoopback(url)) throw new Error("Fixture candidates must use literal HTTP loopback origins");
      fixtureOrigins.add(url.origin);
    }
    return url.href;
  });
  const rows = await observeCandidates(urls, {
    harness: base.origin + HARNESS_PATH, fixtureOrigins, timeout: LOAD_TIMEOUT_MS, budget: 300_000,
    sameOriginRedirects: true, proofFramePolicy: hasFramePolicy ? contentSecurityPolicy : undefined,
  });
  const candidates = ids.map((id, index) => {
    const observations = rows.slice(index * devices.length, (index + 1) * devices.length);
    const canonicalOrigin = new URL(urls[index]).origin;
    const changedOrigin = row => row.final_url_identity && row.final_url_identity.final_url_origin !== canonicalOrigin;
    const hardFailure = observations.some(row => changedOrigin(row) || hasHardFailure(row));
    const verified = observations.length === devices.length && observations.every(row =>
      row.document_http_status === 200 && row.final_url_identity && rendered.has(row.render_result));
    return {
      id, status: hardFailure ? "failed" : verified ? "verified" : "unverified",
      devices: Object.fromEntries(observations.map(row => [row.device, changedOrigin(row) ? "redirect_origin_changed" : row.render_result])),
    };
  });
  const after = await readLiveCatalogue(base, before.revision);
  const beforeIds = new Set(before.entries.map(entry => entry.id));
  if (after.entries.length !== beforeIds.size || after.entries.some(entry => !beforeIds.has(entry.id))) {
    throw new Error("Live catalogue entries changed during proof");
  }
  const failedIds = candidates.filter(row => row.status === "failed").map(row => row.id);
  const unverifiedIds = candidates.filter(row => row.status === "unverified").map(row => row.id);
  return {
    status: unverifiedIds.length ? "unverified" : failedIds.length ? "failed" : "verified",
    revision, entryCount: entries.length, candidates, failedIds, unverifiedIds,
    rollbackPayload: failedIds.length && !unverifiedIds.length ? { releaseRevision: revision, failedIds } : null,
  };
}

async function main() {
  const options = argumentsForProof();
  let report;
  try {
    report = await verify(options);
  } catch {
    // Remote errors can include full destination URLs. Only report bounded IDs.
    report = {
      status: "unverified", revision: options.revision, candidates: [],
      failedIds: [], unverifiedIds: options.ids, rollbackPayload: null,
    };
  }
  await writeFile(options.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  process.exitCode = report.status === "verified" ? 0 : report.status === "failed" ? 2 : 1;
}

main().catch(() => {
  console.error("Auto-publication proof could not complete.");
  process.exitCode = 1;
});
