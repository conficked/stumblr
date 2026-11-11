/** @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { GET, POST } from "@/app/api/catalogue/evidence/route";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { authenticatePublisher, publisherAudience } from "@/lib/security/cataloguePublisher";
import { importCandidateBatch } from "./candidateQueue";
import { getLatestQualificationSet, getPendingQualificationCandidates, getQualificationUrlIdentity, importQualificationEvidence } from "./qualificationEvidence";

const canonicalUrl = "https://example.org/";
const collectorAudience = "https://stumblr.dev/catalogue-collect";
const actor = { revision: "a".repeat(40), issuedAt: 1_799_000_000, runId: "1234", runAttempt: 1 };
const version = "browser-qualification-v4";
let directory: string;

vi.mock("jose", async (importOriginal) => {
  const jose = await importOriginal<typeof import("jose")>();
  return { ...jose, createRemoteJWKSet: () => (...args: Parameters<ReturnType<typeof createLocalJWKSet>>) => testKeys(...args) };
});

let testKeys: ReturnType<typeof createLocalJWKSet>;
async function token(audience = collectorAudience, runId = "1234", runAttempt = "1") {
  const { privateKey, publicKey } = await generateKeyPair("RS256");
  testKeys = createLocalJWKSet({ keys: [{ ...await exportJWK(publicKey), kid: "test", alg: "RS256" }] });
  return new SignJWT({
    repository_id: "1450399070", repository: "conficked/stumblr", ref: "refs/heads/main",
    workflow_ref: `conficked/stumblr/.github/workflows/${audience === publisherAudience ? "catalogue-publish.yml" : "discovery-manual-review.yml"}@refs/heads/main`,
    event_name: "workflow_dispatch", sha: actor.revision, run_id: runId, run_attempt: runAttempt,
  }).setProtectedHeader({ alg: "RS256", kid: "test" }).setIssuer("https://token.actions.githubusercontent.com")
    .setAudience(audience).setIssuedAt().setNotBefore("0s").setExpirationTime("5m").sign(privateKey);
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "stumblr-evidence-"));
  vi.stubEnv("STUMBLR_DB_PATH", join(directory, "ops.sqlite"));
  importCandidateBatch([{
    id: "fixture", canonical_url: canonicalUrl, domain: "example.org", source_id: "fixture",
    source_family: "webring", source_url: "https://source.example/", topics: ["art"],
    title_hint: "Fixture", selection_status: "evaluation_candidate", availability_status: 200,
    x_frame_options: null, content_security_policy: null,
  }]);
});

afterEach(() => {
  closeOpsDbForTests();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function observation(device: "desktop" | "mobile", observedAt = "2026-11-08T00:00:00.000Z") {
  return {
    canonical_url: canonicalUrl, device, observed_at: observedAt, render_result: "text_observed",
    meaningful_text_length: 180, document_http_status: 200, final_url: "https://example.org/visit",
    functionality_result: "not_demonstrated", network_failure_reasons: [],
    interaction_evidence: { attempted: true, visible_state_changed: false },
    console_failure_reasons: [], frame_failure_reasons: [],
  };
}

function batch(observations: unknown[] = [observation("desktop"), observation("mobile")]) {
  return { run_id: actor.runId, run_attempt: actor.runAttempt, qualifier_version: version, observations };
}

test("migration and importer durably store both devices without changing candidate status", () => {
  expect(importQualificationEvidence(batch(), actor)).toEqual({ inserted: 2, existing: 0 });
  expect(openOpsDb().prepare("SELECT status FROM discovery_candidates WHERE id = 'fixture'").get()?.status).toBe("pending_review");
  expect(openOpsDb().prepare("SELECT name FROM schema_migrations WHERE name = ?")
    .get("006_candidate_qualification_evidence.sql")).toBeDefined();
  closeOpsDbForTests();
  expect(getLatestQualificationSet("fixture")).toMatchObject({
    candidate_id: "fixture", canonical_url: canonicalUrl, run_id: "1234", run_attempt: 1,
    qualifier_version: version,
    desktop: { device: "desktop", document_http_status: 200, meaningful_text_length: 180 },
    mobile: { device: "mobile", final_url_origin: "https://example.org", render_result: "text_observed" },
  });
});

test("idempotent replay cannot replace the original observation", () => {
  importQualificationEvidence(batch(), actor);
  expect(importQualificationEvidence(batch([{ ...observation("desktop"), meaningful_text_length: 999 }, observation("mobile")]), actor))
    .toEqual({ inserted: 0, existing: 2 });
  expect(getLatestQualificationSet("fixture")?.desktop.meaningful_text_length).toBe(180);
});

test.each([
  [{ ...observation("mobile"), canonical_url: "https://unknown.example/" }, "Unknown candidate"],
  [{ ...observation("mobile"), candidate_id: "fixture", canonical_url: "https://wrong.example/" }, "Candidate URL mismatch"],
  [{ ...observation("mobile"), candidate_id: "unknown" }, "Unknown candidate"],
  [{ ...observation("mobile"), network_failure_reasons: Array(21).fill("candidate: redirect_limit") }, /too_big/],
  [{ ...observation("mobile"), console_failure_reasons: ["x".repeat(301)] }, /too_big/],
  [{ ...observation("mobile"), body_text: "destination body text" }, /unrecognized_keys/],
  [{ ...observation("mobile"), interaction_evidence: { attempted: true, visible_state_changed: false, body_text: "hidden copy" } }, /unrecognized_keys/],
])("invalid observation cannot partially import a batch: %j", (invalid, error) => {
  expect(() => importQualificationEvidence(batch([observation("desktop"), invalid]), actor)).toThrow(error);
  expect(importQualificationEvidence(batch(), actor)).toEqual({ inserted: 2, existing: 0 });
});

test("raw failure strings never enter durable storage, even when the page copies its body into console errors", () => {
  const privateText = "This text was copied from the destination";
  const desktop = {
    ...observation("desktop"), console_failure_reasons: [privateText],
    frame_failure_reasons: ["nested: net::ERR_BLOCKED_BY_RESPONSE", privateText],
    network_failure_reasons: ["candidate: non_public_dns_answer", privateText],
  };
  importQualificationEvidence(batch([desktop, observation("mobile")]), actor);
  expect(getLatestQualificationSet("fixture")?.desktop).toMatchObject({
    console_failure_count: 1, frame_failure_reasons: ["nested_frame_denied", "other_frame_failure"],
    network_failure_reasons: ["candidate_unsafe_destination", "other_network_failure"],
  });
  const stored = openOpsDb().prepare("SELECT * FROM candidate_qualification_evidence").all();
  expect(JSON.stringify(stored)).not.toContain(privateText);
});

test.each([
  [{ run_id: "1235" }, { runId: "1235" }],
  [{ run_attempt: 2 }, { runAttempt: 2 }],
  [{ qualifier_version: "browser-qualification-v5" }, {}],
])("new evidence cannot borrow the other device across qualification identities: %j", (metadata, actorMetadata) => {
  importQualificationEvidence(batch(), actor);
  const nextDesktop = observation("desktop", "2026-11-09T00:00:00.000Z");
  importQualificationEvidence({ ...batch([nextDesktop]), ...metadata }, { ...actor, ...actorMetadata });
  expect(getLatestQualificationSet("fixture")).toBeNull();
  importQualificationEvidence({ ...batch([observation("mobile", "2026-11-09T00:00:01.000Z")]), ...metadata }, { ...actor, ...actorMetadata });
  expect(getLatestQualificationSet("fixture")).toMatchObject(metadata);
});

test("collector actor binds both submitted GitHub run fields", async () => {
  const signedActor = await authenticatePublisher(`Bearer ${await token(collectorAudience, "1235", "2")}`, testKeys, "collect");
  expect(signedActor).toMatchObject({ runId: "1235", runAttempt: 2 });
  expect(() => importQualificationEvidence(batch(), signedActor)).toThrow("Run identity mismatch");
  expect(getLatestQualificationSet("fixture")).toBeNull();
});

function request(auth: string, payload: string) {
  return new Request("https://stumblr.dev/api/catalogue/evidence", {
    method: "POST", headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
    body: payload,
  });
}

test("only the collector can persist a bounded evidence request", async () => {
  const publisher = await token(publisherAudience);
  expect((await POST(request(publisher, JSON.stringify(batch())))).status).toBe(401);
  const collector = await token();
  expect((await POST(request(collector, JSON.stringify(batch(Array(49).fill(observation("desktop"))))))).status).toBe(400);
  const body = JSON.stringify(batch()).padEnd(1024 * 1024, " ");
  expect((await POST(request(collector, body + " "))).status).toBe(413);
  const response = await POST(request(collector, body));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, inserted: 2, existing: 0 });
});

test("destination path, query, and fragment are never durable while exact redirect identity can be checked", () => {
  const marker = "literal-destination-body-text";
  const final_url = `https://Example.org:443/visit/${marker}?q=${marker}#${marker}`;
  importQualificationEvidence(batch([
    { ...observation("desktop"), final_url },
    { ...observation("mobile"), final_url: `https://example.org/visit/${marker}?q=${marker}` },
  ]), actor);
  const pair = getLatestQualificationSet("fixture");
  expect(pair?.desktop).toMatchObject({
    final_url_origin: "https://example.org",
    final_url_sha256: "423cbd27c95795a9597e990daa3bfccf93fb711dc775cbb3e4c790692be98e95",
  });
  expect(pair?.mobile).toMatchObject({ final_url_sha256: "423cbd27c95795a9597e990daa3bfccf93fb711dc775cbb3e4c790692be98e95" });
  expect(getQualificationUrlIdentity("https://example.org/visit?different=yes").final_url_sha256)
    .not.toBe(pair?.desktop.final_url_sha256);
  expect(JSON.stringify(openOpsDb().prepare("SELECT * FROM candidate_qualification_evidence").all())).not.toContain(marker);
});

test("browser artifacts can import terminal identity without a raw URL", () => {
  const artifactRow = (device: "desktop" | "mobile") => {
    const { final_url, ...row } = observation(device);
    return { ...row, final_url_identity: getQualificationUrlIdentity(final_url) };
  };
  const desktop = artifactRow("desktop");
  const mobile = artifactRow("mobile");
  expect(() => importQualificationEvidence(batch([{ ...desktop, final_url: canonicalUrl }]), actor)).toThrow();
  expect(() => importQualificationEvidence(batch([{ ...desktop, final_url_identity: {
    ...desktop.final_url_identity, final_url_origin: "https://example.org/private?token=fixture",
  } }]), actor)).toThrow();
  expect(importQualificationEvidence(batch([desktop, mobile]), actor)).toEqual({ inserted: 2, existing: 0 });
  expect(getLatestQualificationSet("fixture")?.mobile).toMatchObject(mobile.final_url_identity);
});

test("the collector can recover exact queued URLs on a fresh run after partial evidence ingestion", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-09T12:00:00.000Z"));
  const db = openOpsDb();
  db.prepare("UPDATE discovery_candidates SET discovered_at = '2026-11-08' WHERE id = 'fixture'").run();
  const suppressedUrl = "https://example.org/suppressed";
  expect(importCandidateBatch([{
    id: "suppressed", canonical_url: suppressedUrl, domain: "example.org", source_id: "github",
    source_family: "github-live-demo", source_url: "https://github.com/", topics: ["art"],
    title_hint: "Suppressed", selection_status: "evaluation_candidate", availability_status: 200,
    x_frame_options: null, content_security_policy: null,
    provenance: { repository_id: "999", repository_full_name: "owner/demo", repository_url: "https://github.com/owner/demo", demo_url: suppressedUrl },
  }]).inserted).toBe(0);
  const add = db.prepare(`INSERT INTO discovery_candidates
    (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at)
    VALUES (?, ?, 'example.org', 'fixture', ?, 'https://source.example/', ?, ?, '2026-11-08')`);
  add.run("next", "https://example.org/next", "webring", "2026-11-09", "pending_review");
  add.run("github", "https://example.org/demo", "github-live-demo", "2026-11-10", "pending_review");
  add.run("quarantine", "https://example.org/blocked", "webring", "2026-11-07", "quarantined");
  add.run("community", "https://example.org/community", "community", "2026-11-07", "pending_review");
  add.run("budget", "https://example.org/budget", "webring", "2026-11-10", "pending_review");

  importQualificationEvidence(batch([observation("desktop")]), actor);
  importQualificationEvidence(batch((["desktop", "mobile"] as const).map(device => ({
    ...observation(device), canonical_url: "https://example.org/budget", render_result: "budget_exhausted",
  }))), actor);
  const query = (auth: string, search = "") => GET(new Request(`https://stumblr.dev/api/catalogue/evidence${search}`, {
    headers: { Authorization: `Bearer ${auth}` },
  }));
  expect((await query(await token(publisherAudience))).status).toBe(401);
  const freshCollector = await token(collectorAudience, "9999", "2");
  const response = await query(freshCollector, "?source_family=webring");
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ candidates: [
    { canonical_url: canonicalUrl }, { canonical_url: "https://example.org/next" }, { canonical_url: "https://example.org/budget" },
  ] });
  expect((await POST(request(freshCollector, JSON.stringify(batch())))).status).toBe(400);
  const next = (["desktop", "mobile"] as const).map(device => observation(device, "2026-11-09T12:00:00.000Z"));
  expect((await POST(request(freshCollector, JSON.stringify({ ...batch(next), run_id: "9999", run_attempt: 2 })))).status).toBe(200);
  expect((await (await query(freshCollector)).json()).candidates).toEqual([
    { canonical_url: "https://example.org/community" },
    { canonical_url: "https://example.org/next" },
    { canonical_url: "https://example.org/budget" },
    { canonical_url: "https://example.org/demo" },
  ]);
});

test("a long terminal redirect and a healthy sibling persist in the same bounded request", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-09T12:00:00.000Z"));
  const healthyUrl = "https://example.org/healthy";
  openOpsDb().prepare(`INSERT INTO discovery_candidates
    (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at)
    VALUES ('healthy', ?, 'example.org', 'fixture', 'webring', 'https://source.example/', '2026-11-08', 'pending_review', '2026-11-08')`)
    .run(healthyUrl);
  const longPath = "encoded-destination-text-".repeat(500);
  const terminal = `https://example.org/visit?q=${longPath}`;
  const observations = (["desktop", "mobile"] as const).flatMap(device => [
    { ...observation(device), final_url: terminal },
    { ...observation(device), canonical_url: healthyUrl, final_url: healthyUrl },
  ]);
  const collector = await token();
  const response = await POST(request(collector, JSON.stringify(batch(observations))));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true, inserted: 4, existing: 0 });
  expect(getLatestQualificationSet("healthy")).not.toBeNull();
  expect(getLatestQualificationSet("fixture")?.desktop.final_url_sha256)
    .toBe("daf6f3987db761438aaae0f50a55db6fa58a76fec0b8b9f9aaac78b1925b4a89");
  expect(JSON.stringify(openOpsDb().prepare("SELECT * FROM candidate_qualification_evidence").all())).not.toContain(longPath);
  const pending = await GET(new Request("https://stumblr.dev/api/catalogue/evidence", {
    headers: { Authorization: `Bearer ${collector}` },
  }));
  expect(await pending.json()).toEqual({ candidates: [] });
});

test("the qualification queue requeues only pairs past the 48-hour freshness window", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  const db = openOpsDb();
  const add = db.prepare(`INSERT INTO discovery_candidates
    (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at)
    VALUES (?, ?, 'example.org', 'fixture', 'webring', 'https://source.example/', ?, 'pending_review', '2026-11-08')`);
  add.run("stale-mobile", "https://example.org/stale-mobile", "2026-11-02");
  add.run("boundary", "https://example.org/boundary", "2026-11-03");
  const observations = (["desktop", "mobile"] as const).flatMap(device => [
    observation(device, "2026-11-09T11:00:00.000Z"),
    { ...observation(device, device === "mobile" ? "2026-11-07T11:59:59.999Z" : "2026-11-08T12:00:00.000Z"), canonical_url: "https://example.org/stale-mobile" },
    { ...observation(device, "2026-11-07T12:00:00.000Z"), canonical_url: "https://example.org/boundary" },
  ]);
  importQualificationEvidence(batch(observations), actor);
  vi.useFakeTimers();
  vi.setSystemTime(now);
  try {
    expect(getPendingQualificationCandidates("webring")).toEqual([{ canonical_url: "https://example.org/stale-mobile" }]);
  } finally {
    vi.useRealTimers();
  }
});
