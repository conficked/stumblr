/** @vitest-environment node */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { closeOpsDbForTests, openOpsDb } from "@/lib/db/client";
import { applyRuntimeHealthEvidence, importRuntimeHttpEvidence } from "./runtimeHealth";
import type { RuntimeObservationPair } from "./runtimeHealth";
import { getConfirmedRuntimeHealthTargets, installRuntimeCatalogue, readRuntimeCatalogue } from "./runtimeStore";

const pair = (kind: "clean" | "failure" | "frame" | "security" | "slow" | "optional" | "inconclusive", run: number): RuntimeObservationPair => {
  const render = kind === "clean" ? "text_observed" : kind === "frame" ? "frame_denied" : kind === "inconclusive" ? "inconclusive" : kind === "slow" ? "timeout" : kind === "optional" ? "text_observed" : "http_error";
  return {
    run_id: String(run), run_attempt: 1, qualifier_version: "browser-qualification-v1",
    desktop: { device: "desktop", render_result: render, functionality_result: "demonstrated", document_http_status: kind === "failure" ? 503 : 200, frame_failure_reasons: kind === "frame" ? ["candidate_frame_denied"] : [], network_failure_reasons: kind === "optional" ? ["resource_network_failure"] : kind === "security" ? ["candidate_unsafe_destination"] : [] },
    mobile: { device: "mobile", render_result: render, functionality_result: "demonstrated", document_http_status: kind === "failure" ? 503 : 200, frame_failure_reasons: kind === "frame" ? ["candidate_frame_denied"] : [], network_failure_reasons: kind === "optional" ? ["resource_network_failure"] : kind === "security" ? ["candidate_unsafe_destination"] : [] },
  };
};

let directory: string;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "stumblr-runtime-health-"));
  vi.stubEnv("STUMBLR_DB_PATH", join(directory, "ops.sqlite"));
  const db = openOpsDb();
  db.prepare(`INSERT INTO discovery_candidates (id, canonical_url, domain, source_id, source_family, source_url, discovered_at, status, updated_at) VALUES ('entry-1','https://health.example/','health.example','fixture','fixture','https://source.example/','2026-01-01','pending_review','2026-01-01')`).run();
  db.prepare(`INSERT INTO runtime_health_state (candidate_id, state, reason_code, failure_streak, recovery_streak, updated_at) VALUES ('entry-1','healthy','healthy',0,0,'2026-01-01')`).run();
});

afterEach(() => {
  closeOpsDbForTests();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

test("immediately quarantines security and frame denial evidence", () => {
  expect(applyRuntimeHealthEvidence("entry-1", pair("frame", 1)).state).toBe("quarantined");
  expect(applyRuntimeHealthEvidence("entry-1", pair("security", 2)).state).toBe("quarantined");
});

test("qualifier frame-denial fixture quarantines on its first pair", () => {
  const evidence = pair("clean", 10);
  evidence.desktop.render_result = "frame_denied";
  evidence.desktop.frame_failure_reasons = ["browser enforced destination frame policy"];
  expect(applyRuntimeHealthEvidence("entry-1", evidence)).toMatchObject({ state: "quarantined", reason_code: "runtime_security_or_frame_denial" });
});

test("requires two independent ordinary hard failures to quarantine", () => {
  expect(applyRuntimeHealthEvidence("entry-1", pair("failure", 1)).state).toBe("suspect");
  expect(applyRuntimeHealthEvidence("entry-1", pair("failure", 2)).state).toBe("quarantined");
});

test("inconclusive, slow, and optional resource failures stay live", () => {
  for (const [index, kind] of (["inconclusive", "slow", "optional"] as const).entries()) {
    expect(applyRuntimeHealthEvidence("entry-1", pair(kind, index + 1)).state).toBe("healthy");
  }
});

test("two clean pairs restore a quarantine; one is recovery pending", () => {
  applyRuntimeHealthEvidence("entry-1", pair("frame", 1));
  expect(applyRuntimeHealthEvidence("entry-1", pair("clean", 2)).state).toBe("recovery_pending");
  expect(applyRuntimeHealthEvidence("entry-1", pair("clean", 3)).state).toBe("restored");
});

test("authenticated health target selection can recover a hidden runtime entry", () => {
  installRuntimeCatalogue({ entries: [{
    id: "entry-1", title: "Health entry", canonicalUrl: "https://health.example/", domain: "health.example",
    topics: ["archives"], description: "", status: "evaluation_only", policyBasis: null,
    provenance: { sourceNote: "fixture", reviewer: "reviewer", reviewedAt: "2026-01-01T00:00:00.000Z" },
    embedEvidence: { observedHeaders: "", observedRenderResult: "rendered", observedAt: "2026-01-01T00:00:00.000Z", device: "desktop" },
  }] }, { revision: "manual-health-test", issuedAt: 1 });
  applyRuntimeHealthEvidence("entry-1", pair("frame", 20));
  expect(readRuntimeCatalogue().entries).toHaveLength(0);
  expect(getConfirmedRuntimeHealthTargets(24)).toEqual([{ id: "entry-1", canonicalUrl: "https://health.example/" }]);
  expect(applyRuntimeHealthEvidence("entry-1", pair("clean", 21)).state).toBe("recovery_pending");
  expect(applyRuntimeHealthEvidence("entry-1", pair("clean", 22)).state).toBe("restored");
  expect(readRuntimeCatalogue().entries.map(entry => entry.id)).toEqual(["entry-1"]);
});

test("healthy reading evidence requires no demonstrated interaction", () => {
  const evidence = pair("clean", 1);
  evidence.desktop.functionality_result = "not_demonstrated";
  evidence.mobile.functionality_result = "not_demonstrated";
  expect(applyRuntimeHealthEvidence("entry-1", evidence).state).toBe("healthy");
  expect(applyRuntimeHealthEvidence("entry-1", { ...evidence, run_id: "2" }).state).toBe("healthy");
});

test("nested frame denial and header presence are diagnostic only", () => {
  const evidence = pair("clean", 1);
  evidence.desktop.frame_failure_reasons = ["nested: net::ERR_BLOCKED_BY_RESPONSE"];
  evidence.mobile.network_failure_reasons = ["resource: blocked Image outside validated HTTPS/public origins"];
  evidence.http_framing = { xfo_present: true, csp_frame_ancestors: true, denied: false };
  expect(applyRuntimeHealthEvidence("entry-1", evidence).state).toBe("healthy");
  // Collector flags are conservative heuristics; the top-level browser frame loaded.
  expect(applyRuntimeHealthEvidence("entry-1", {
    ...evidence, run_id: "2", http_framing: { ...evidence.http_framing, denied: true },
  }).state).toBe("healthy");
});

test.each([
  ["network_blocked", "network_failure_reasons", "candidate: dns_not_found"],
  ["network_blocked", "network_failure_reasons", "candidate: preflight_connection_failed"],
  ["network_blocked", "network_failure_reasons", "candidate: blocked Document outside validated HTTPS/public origins"],
  ["error", "frame_failure_reasons", "candidate: net::ERR_CONNECTION_REFUSED"],
  ["http_error", "frame_failure_reasons", "candidate: HTTP 410"],
] as const)("requires confirmation for qualifier-shaped %s / %s / %s", (render, reasonField, reason) => {
  const evidence = pair("clean", 1);
  for (const row of [evidence.desktop, evidence.mobile]) {
    row.render_result = render;
    row.document_http_status = render === "http_error" ? 410 : null;
    row[reasonField] = [reason];
  }
  expect(applyRuntimeHealthEvidence("entry-1", evidence).state).toBe("suspect");
  expect(applyRuntimeHealthEvidence("entry-1", evidence)).toMatchObject({ state: "suspect", reason_code: "duplicate_observation" });
  expect(applyRuntimeHealthEvidence("entry-1", { ...evidence, run_id: "2" }).state).toBe("quarantined");
});

test("a qualifier DNS timeout remains inconclusive", () => {
  const evidence = pair("clean", 1);
  for (const row of [evidence.desktop, evidence.mobile]) {
    row.render_result = "network_blocked";
    row.document_http_status = null;
    row.network_failure_reasons = ["candidate: dns_timeout"];
  }
  expect(applyRuntimeHealthEvidence("entry-1", evidence).state).toBe("healthy");
});

const manualEntry = (id: string, reviewedAt: string) => ({
  id, title: "Health entry", canonicalUrl: "https://health.example/", domain: "health.example",
  topics: ["archives"], description: "", status: "evaluation_only", policyBasis: null,
  provenance: { sourceNote: "fixture", reviewer: "reviewer", reviewedAt },
  embedEvidence: { observedHeaders: "", observedRenderResult: "rendered", observedAt: reviewedAt, device: "desktop" },
});

test("a reviewed snapshot ID differing from the queue ID maps health by canonical URL", () => {
  installRuntimeCatalogue({ entries: [manualEntry("legacy-manifest-id", "2026-01-01T00:00:00.000Z")] }, { revision: "legacy", issuedAt: 1 });
  expect(getConfirmedRuntimeHealthTargets()).toEqual([{ id: "entry-1", canonicalUrl: "https://health.example/" }]);
  expect(readRuntimeCatalogue().entries[0].id).toBe("legacy-manifest-id");
  applyRuntimeHealthEvidence("entry-1", pair("frame", 1));
  expect(readRuntimeCatalogue().entries).toEqual([]);
});

test("an older manual review leaves newer health quarantine intact; a newer review restores it", () => {
  const oldReview = manualEntry("entry-1", "2026-01-01T00:00:00.000Z");
  installRuntimeCatalogue({ entries: [oldReview] }, { revision: "manual-first", issuedAt: 1 });
  applyRuntimeHealthEvidence("entry-1", pair("frame", 1));
  installRuntimeCatalogue({ entries: [oldReview] }, { revision: "manual-older-evidence", issuedAt: 2 });
  expect(readRuntimeCatalogue().entries).toEqual([]);
  const newReview = manualEntry("entry-1", new Date(Date.now() + 1000).toISOString());
  installRuntimeCatalogue({ entries: [newReview] }, { revision: "manual-newer-evidence", issuedAt: 3 });
  expect(readRuntimeCatalogue().entries.map(entry => entry.id)).toEqual(["entry-1"]);
  expect(openOpsDb().prepare("SELECT from_state, to_state, source FROM runtime_health_transitions ORDER BY id").all()).toEqual([
    { from_state: "healthy", to_state: "quarantined", source: "browser" },
    { from_state: "quarantined", to_state: "healthy", source: "manual" },
  ]);
});

test("runtime browser transition audit survives later changes and records the responsible runs", () => {
  applyRuntimeHealthEvidence("entry-1", pair("frame", 1));
  applyRuntimeHealthEvidence("entry-1", pair("clean", 2));
  applyRuntimeHealthEvidence("entry-1", pair("clean", 3));
  applyRuntimeHealthEvidence("entry-1", pair("clean", 3));
  closeOpsDbForTests();
  expect(openOpsDb().prepare("SELECT from_state, to_state, reason_code, run_id FROM runtime_health_transitions ORDER BY id").all()).toEqual([
    { from_state: "healthy", to_state: "quarantined", reason_code: "runtime_security_or_frame_denial", run_id: "1" },
    { from_state: "quarantined", to_state: "recovery_pending", reason_code: "runtime_recovery_first_clean_pair", run_id: "2" },
    { from_state: "recovery_pending", to_state: "healthy", reason_code: "runtime_two_clean_pairs", run_id: "3" },
  ]);
});

test("rejects unbounded runtime browser pair, framing, and device fields before persistence", () => {
  const evidence = pair("clean", 1);
  const extra = { private_body: "destination controlled text" };
  for (const invalid of [
    { ...evidence, ...extra },
    { ...evidence, desktop: { ...evidence.desktop, ...extra } },
    { ...evidence, http_framing: { xfo_present: false, csp_frame_ancestors: false, denied: false, ...extra } },
  ]) {
    expect(() => applyRuntimeHealthEvidence("entry-1", invalid)).toThrow(/invalid runtime health/i);
  }
  expect(openOpsDb().prepare("SELECT result_json FROM runtime_health_observations").all()).toEqual([]);
});

test("rejects unbounded fields on runtime HTTP evidence and inside its framing object", () => {
  const framing = { xfo_present: false, csp_present: false, csp_frame_ancestors: false, denied: false };
  const row = { id: "entry-1", availability_status: 200, framing };
  const extra = { private_body: "destination controlled text" };
  for (const invalid of [{ ...row, ...extra }, { ...row, framing: { ...framing, ...extra } }]) {
    expect(() => importRuntimeHttpEvidence([invalid], "1", 1, new Set(["entry-1"]))).toThrow(/invalid runtime HTTP/i);
  }
  expect(openOpsDb().prepare("SELECT framing_json FROM runtime_http_evidence").all()).toEqual([]);
});
