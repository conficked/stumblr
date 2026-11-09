import { z } from "zod";
import { openOpsDb, type OpsDb } from "@/lib/db/client";

const candidateIdSchema = z.string().min(1).max(200);
const runIdSchema = z.string().regex(/^[1-9][0-9]{0,19}$/);
const runAttemptSchema = z.int().positive();
const statusSchema = z.int().min(100).max(599).nullable();
const reasons = z.array(z.string().max(300)).max(20);
const deviceSchema = z.strictObject({
  device: z.enum(["desktop", "mobile"]),
  render_result: z.enum(["text_observed", "interaction_observed", "blank", "login_only", "frame_denied",
    "http_error", "timeout", "network_blocked", "inconclusive", "budget_exhausted", "error"]),
  functionality_result: z.enum(["demonstrated", "not_demonstrated", "inconclusive"]),
  document_http_status: statusSchema,
  frame_failure_reasons: reasons,
  network_failure_reasons: reasons,
});
const framingSchema = z.strictObject({
  xfo_present: z.boolean(), csp_frame_ancestors: z.boolean(), denied: z.boolean(),
});
const pairSchema = z.strictObject({
  run_id: runIdSchema,
  run_attempt: runAttemptSchema,
  qualifier_version: z.string().regex(/^browser-qualification-v[1-9][0-9]{0,5}$/),
  desktop: deviceSchema.extend({ device: z.literal("desktop") }),
  mobile: deviceSchema.extend({ device: z.literal("mobile") }),
  http_framing: framingSchema.optional(),
});
const healthBatchSchema = z.array(z.strictObject({ candidate_id: candidateIdSchema, observation_pair: pairSchema })).max(24);
const httpBatchSchema = z.array(z.strictObject({
  id: candidateIdSchema, availability_status: statusSchema,
  framing: framingSchema.extend({ csp_present: z.boolean() }),
})).max(24);

export type RuntimeObservationPair = z.input<typeof pairSchema>;
export type HealthTransition = {
  state: "healthy" | "suspect" | "quarantined" | "recovery_pending" | "restored";
  reason_code: string;
};
type HealthState = Exclude<HealthTransition["state"], "restored">;

const inconclusive = new Set(["inconclusive", "timeout", "network_blocked", "budget_exhausted", "error"]);
const unsafeDestinationReasons = new Set([
  "candidate: credentials_disallowed", "candidate: https_required", "candidate: local_hostname_disallowed",
  "candidate: non_public_ip", "candidate: non_public_dns_answer",
]);
const failedConnections = /^candidate: net::ERR_(?:NAME_NOT_RESOLVED|DNS_[A-Z_]+|CONNECTION_[A-Z_]+|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED|TIMED_OUT|CERT_[A-Z_]+|SSL_[A-Z_]+|TOO_MANY_REDIRECTS|EMPTY_RESPONSE|HTTP2_PROTOCOL_ERROR)$/;

function normalizeFrameReason(reason: string) {
  if (["candidate_frame_denied", "nested_frame_denied", "timeout", "budget_exhausted", "candidate_http_error", "interaction_unavailable", "candidate_frame_failure", "nested_frame_failure", "other_frame_failure"].includes(reason)) return reason;
  if (reason === "browser enforced destination frame policy" || /^candidate: net::ERR_BLOCKED_BY_(?:RESPONSE|CSP)$/.test(reason)) return "candidate_frame_denied";
  if (/^nested: net::ERR_BLOCKED_BY_(?:RESPONSE|CSP)$/.test(reason)) return "nested_frame_denied";
  if (failedConnections.test(reason)) return "candidate_connection_failed";
  if (/^candidate: HTTP [345][0-9]{2}$/.test(reason)) return "candidate_http_error";
  if (["frame load timeout", "candidate: preflight timeout", "per-observation time budget exhausted", "browser operation timed out"].includes(reason)) return "timeout";
  return "other_frame_failure";
}

function normalizeNetworkReason(reason: string) {
  if (["candidate_unsafe_destination", "candidate_redirect_limit", "candidate_dns_timeout", "candidate_connection_failed", "candidate_network_failure", "nested_network_failure", "resource_network_failure", "other_network_failure"].includes(reason)) return reason;
  if (unsafeDestinationReasons.has(reason)) return "candidate_unsafe_destination";
  if (["candidate: dns_not_found", "candidate: preflight_connection_failed"].includes(reason)) return "candidate_connection_failed";
  if (reason === "candidate: dns_timeout") return "candidate_dns_timeout";
  if (["candidate: redirect_limit", "candidate: cross_origin_redirect"].includes(reason)) return "candidate_redirect_limit";
  if (reason === "candidate: blocked Document outside validated HTTPS/public origins") return "candidate_network_failure";
  if (reason.startsWith("nested: ")) return "nested_network_failure";
  if (reason.startsWith("resource: ")) return "resource_network_failure";
  return "other_network_failure";
}

function classify(pair: RuntimeObservationPair): "clean" | "hard_failure" | "security_failure" | "inconclusive" {
  const rows = [pair.desktop, pair.mobile];
  // The HTTP flags are screening heuristics. Only a browser denial on the
  // candidate frame confirms that the policy applies to Stumblr's origin.
  if (rows.some(row => row.render_result === "frame_denied" ||
    row.frame_failure_reasons.includes("candidate_frame_denied") ||
    row.network_failure_reasons.includes("candidate_unsafe_destination"))) return "security_failure";
  if (rows.some(row => row.render_result === "blank" || row.render_result === "login_only" ||
    row.render_result === "http_error" || (row.document_http_status !== null && row.document_http_status >= 400) ||
    row.frame_failure_reasons.includes("candidate_connection_failed") ||
    row.network_failure_reasons.some(reason => ["candidate_connection_failed", "candidate_redirect_limit", "candidate_network_failure"].includes(reason)))) return "hard_failure";
  return rows.some(row => inconclusive.has(row.render_result)) ? "inconclusive" : "clean";
}

function appendTransition(db: OpsDb, candidateId: string, from: HealthState, to: HealthState, reason: string, at: string,
  origin: { source: "browser"; pair: RuntimeObservationPair } | { source: "manual" | "automatic"; revision: string }) {
  if (from === to) return;
  db.prepare(`INSERT INTO runtime_health_transitions(candidate_id,from_state,to_state,reason_code,source,observed_at,run_id,run_attempt,qualifier_version,revision)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(candidateId, from, to, reason, origin.source, at,
    origin.source === "browser" ? origin.pair.run_id : null, origin.source === "browser" ? origin.pair.run_attempt : null,
    origin.source === "browser" ? origin.pair.qualifier_version : null, origin.source === "browser" ? null : origin.revision);
}

/** Use the discovery queue ID resolved by canonical URL, within the publication transaction. */
export function noteRuntimeHealthPublication(db: OpsDb, candidateId: string, reviewAt: string, revision: string, source: "manual" | "automatic") {
  const previous = db.prepare("SELECT state, updated_at FROM runtime_health_state WHERE candidate_id = ?").get(candidateId);
  if (previous && !(Date.parse(reviewAt) > Date.parse(String(previous.updated_at)))) return;
  const reason = source === "manual" ? "explicit_manual_publication" : "verified_automatic_publication";
  const at = new Date(reviewAt).toISOString();
  db.prepare(`INSERT INTO runtime_health_state(candidate_id,state,reason_code,failure_streak,recovery_streak,updated_at)
    VALUES(?,'healthy',?,0,0,?) ON CONFLICT(candidate_id) DO UPDATE SET
    state='healthy',reason_code=excluded.reason_code,failure_streak=0,recovery_streak=0,updated_at=excluded.updated_at`).run(candidateId, reason, at);
  if (previous) appendTransition(db, candidateId, previous.state as HealthState, "healthy", reason, at, { source, revision });
}

function runtimeTransaction<T>(work: (db: OpsDb) => T): T {
  const db = openOpsDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work(db);
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function storeRuntimeHealthEvidence(db: OpsDb, candidateId: string, pair: RuntimeObservationPair): HealthTransition {
  function normalizeDevice<T extends z.input<typeof deviceSchema>>(device: T): T {
    return {
      ...device,
      frame_failure_reasons: [...new Set(device.frame_failure_reasons.map(normalizeFrameReason))],
      network_failure_reasons: [...new Set(device.network_failure_reasons.map(normalizeNetworkReason))],
    };
  }
  const normalized = { ...pair, desktop: normalizeDevice(pair.desktop), mobile: normalizeDevice(pair.mobile) };
  const existing = db.prepare("SELECT state, reason_code, failure_streak, recovery_streak FROM runtime_health_state WHERE candidate_id = ?").get(candidateId);
  if (!existing) throw new Error("Unknown runtime health candidate");
  const before = existing.state as HealthState;
  const at = new Date().toISOString();
  const inserted = db.prepare(`INSERT INTO runtime_health_observations(candidate_id,run_id,run_attempt,qualifier_version,result_json,observed_at)
    VALUES(?,?,?,?,?,?) ON CONFLICT(candidate_id,run_id,run_attempt,qualifier_version) DO NOTHING`).run(
    candidateId, normalized.run_id, normalized.run_attempt, normalized.qualifier_version, JSON.stringify(normalized), at,
  ).changes;
  if (!inserted) return { state: before, reason_code: "duplicate_observation" };

  const classification = classify(normalized);
  let state = before;
  let reason = String(existing.reason_code);
  let failure = Number(existing.failure_streak);
  let recovery = Number(existing.recovery_streak);
  if (classification === "security_failure") { state = "quarantined"; reason = "runtime_security_or_frame_denial"; failure = 2; recovery = 0; }
  else if (state === "quarantined" || state === "recovery_pending") {
    if (classification === "clean") {
      recovery += 1;
      if (recovery >= 2) { state = "healthy"; reason = "runtime_two_clean_pairs"; failure = 0; recovery = 0; }
      else { state = "recovery_pending"; reason = "runtime_recovery_first_clean_pair"; }
    } else if (classification === "hard_failure") { state = "quarantined"; reason = "runtime_failure_during_recovery"; recovery = 0; }
  } else if (classification === "hard_failure") {
    failure += 1;
    state = failure >= 2 ? "quarantined" : "suspect";
    reason = failure >= 2 ? "runtime_two_independent_hard_failures" : "runtime_first_hard_failure";
  } else if (classification === "clean") { state = "healthy"; reason = "runtime_healthy"; failure = 0; }

  db.prepare(`UPDATE runtime_health_state SET state=?,reason_code=?,failure_streak=?,recovery_streak=?,updated_at=?
    WHERE candidate_id=?`).run(state, reason, failure, recovery, at, candidateId);
  appendTransition(db, candidateId, before, state, reason, at, { source: "browser", pair: normalized });
  return { state: reason === "runtime_two_clean_pairs" && state !== before ? "restored" : state, reason_code: reason };
}

export function applyRuntimeHealthEvidence(candidateId: string, input: unknown): HealthTransition {
  const result = pairSchema.safeParse(input);
  if (!candidateIdSchema.safeParse(candidateId).success || !result.success) throw new Error("Invalid runtime health observation pair");
  return runtimeTransaction(db => storeRuntimeHealthEvidence(db, candidateId, result.data));
}

export function importRuntimeHealthEvidence(input: unknown, runId: string, runAttempt: number, confirmedIds: Set<string>) {
  const result = healthBatchSchema.safeParse(input);
  if (!result.success || result.data.some(({ candidate_id, observation_pair }) =>
    !confirmedIds.has(candidate_id) || observation_pair.run_id !== runId || observation_pair.run_attempt !== runAttempt)) {
    throw new Error("Invalid runtime health observation batch");
  }
  return runtimeTransaction(db => result.data.map(({ candidate_id, observation_pair }) =>
    storeRuntimeHealthEvidence(db, candidate_id, observation_pair)));
}

export function importRuntimeHttpEvidence(input: unknown, runId: string, runAttempt: number, confirmedIds: Set<string>) {
  const result = httpBatchSchema.safeParse(input);
  if (!runIdSchema.safeParse(runId).success || !runAttemptSchema.safeParse(runAttempt).success ||
    !result.success || result.data.some(row => !confirmedIds.has(row.id))) throw new Error("Invalid runtime HTTP evidence");
  return runtimeTransaction(db => {
    let inserted = 0;
    const insert = db.prepare(`INSERT INTO runtime_http_evidence(candidate_id,run_id,run_attempt,observed_at,status,framing_json)
      VALUES(?,?,?,?,?,?) ON CONFLICT(candidate_id,run_id,run_attempt) DO NOTHING`);
    for (const row of result.data) {
      inserted += Number(insert.run(row.id, runId, runAttempt, new Date().toISOString(), row.availability_status, JSON.stringify(row.framing)).changes);
    }
    return { inserted, existing: result.data.length - inserted };
  });
}
