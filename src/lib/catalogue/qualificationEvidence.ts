import { getQualificationUrlIdentity } from "./destinationIdentity.mjs";
import { z } from "zod";
import { openOpsDb } from "@/lib/db/client";
import type { CollectionActor } from "@/lib/security/cataloguePublisher";
import {
  MAX_QUALIFICATION_EVIDENCE_AGE_MS,
  MAX_QUALIFICATION_FINAL_URL_LENGTH,
  OVERSIZED_QUALIFICATION_FINAL_URL_REASON,
  QUALIFIER_VERSION,
} from "./qualificationLimits";

export type { CollectionActor } from "@/lib/security/cataloguePublisher";

const url = (maxLength: number) => z.url({ protocol: /^https$/ }).max(maxLength).refine(value => {
  const parsed = new URL(value);
  return value.startsWith("https://") && !parsed.username && !parsed.password &&
    !/[\s\\\u0000-\u001f\u007f]/.test(value);
});
const failureReasons = z.array(z.string().max(300)).max(20);
const observationSchema = z.strictObject({
  // Current qualifier artifacts identify candidates by URL. If a caller also
  // provides an immutable ID, the URL must match that exact candidate.
  candidate_id: z.string().min(1).max(200).optional(),
  canonical_url: url(4096),
  device: z.enum(["desktop", "mobile"]),
  observed_at: z.iso.datetime({ precision: 3 }),
  final_url: url(MAX_QUALIFICATION_FINAL_URL_LENGTH).nullable().optional(),
  final_url_identity: z.strictObject({
    final_url_origin: z.url({ protocol: /^https$/ }).max(512)
      .refine(value => URL.canParse(value) && new URL(value).origin === value),
    final_url_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  }).nullable().optional(),
  document_http_status: z.int().min(100).max(599).nullable(),
  render_result: z.enum([
    "text_observed", "interaction_observed", "blank", "login_only", "frame_denied", "http_error",
    "timeout", "network_blocked", "inconclusive", "budget_exhausted", "error",
  ]),
  functionality_result: z.enum(["demonstrated", "not_demonstrated", "inconclusive"]),
  meaningful_text_length: z.int().nonnegative(),
  interaction_evidence: z.strictObject({ attempted: z.boolean(), visible_state_changed: z.boolean() })
    .refine(evidence => !evidence.visible_state_changed || evidence.attempted),
  network_failure_reasons: failureReasons,
  frame_failure_reasons: failureReasons,
  console_failure_reasons: failureReasons,
  commercial_signal: z.boolean().optional(),
  documentation_signal: z.boolean().optional(),
}).refine(row => (row.final_url === undefined) !== (row.final_url_identity === undefined));

const batchSchema = z.strictObject({
  run_id: z.string().regex(/^[1-9][0-9]{0,19}$/),
  run_attempt: z.int().positive(),
  qualifier_version: z.string().regex(/^browser-qualification-v[1-9][0-9]{0,5}$/),
  observations: z.array(observationSchema).max(48),
});

const unsafeDestinationReasons = new Set([
  "candidate: credentials_disallowed", "candidate: https_required", "candidate: local_hostname_disallowed",
  "candidate: non_public_ip", "candidate: non_public_dns_answer",
]);

function networkReason(reason: string) {
  if (unsafeDestinationReasons.has(reason)) return "candidate_unsafe_destination";
  if (reason === "candidate: redirect_limit") return "candidate_redirect_limit";
  if (reason === "candidate: dns_timeout") return "candidate_dns_timeout";
  if (reason === "candidate: preflight_connection_failed") return "candidate_connection_failed";
  if (reason.startsWith("candidate: ")) return "candidate_network_failure";
  if (reason.startsWith("nested: ")) return "nested_network_failure";
  if (reason.startsWith("resource: ")) return "resource_network_failure";
  return "other_network_failure";
}

function frameReason(reason: string) {
  if (reason === "browser enforced destination frame policy" || /^candidate: net::ERR_BLOCKED_BY_(?:RESPONSE|CSP)$/.test(reason)) return "candidate_frame_denied";
  if (/^nested: net::ERR_BLOCKED_BY_(?:RESPONSE|CSP)$/.test(reason)) return "nested_frame_denied";
  if (/^candidate: HTTP [345]\d\d$/.test(reason)) return "candidate_http_error";
  if (reason === "whole-run time budget exhausted; not observed") return "budget_exhausted";
  if (reason === "interaction unavailable or timed out") return "interaction_unavailable";
  if (reason === OVERSIZED_QUALIFICATION_FINAL_URL_REASON) return "final_url_too_long";
  if (["frame load timeout", "candidate: preflight timeout", "per-observation time budget exhausted", "browser operation timed out"].includes(reason)) return "timeout";
  if (reason.startsWith("nested: ")) return "nested_frame_failure";
  if (reason.startsWith("candidate: ") || reason === "frame navigation failed") return "candidate_frame_failure";
  return "other_frame_failure";
}

type Observation = z.infer<typeof observationSchema>;
export { getQualificationUrlIdentity } from "./destinationIdentity.mjs";

type StoredObservation = Omit<Observation, "candidate_id" | "canonical_url" | "console_failure_reasons" | "final_url" | "final_url_identity" | "commercial_signal" | "documentation_signal"> & {
  commercial_signal: boolean;
  documentation_signal: boolean;
  final_url_origin: string | null;
  final_url_sha256: string | null;
  console_failure_count: number;
};
type QualificationIdentity = Omit<z.infer<typeof batchSchema>, "observations">;
export type QualificationSet = QualificationIdentity & {
  candidate_id: string;
  canonical_url: string;
  desktop: StoredObservation;
  mobile: StoredObservation;
};
export type QualificationImportResult = { inserted: number; existing: number };

export function importQualificationEvidence(input: unknown, actor: CollectionActor): QualificationImportResult {
  const batch = batchSchema.parse(input);
  if (batch.run_id !== actor.runId || batch.run_attempt !== actor.runAttempt) throw new Error("Run identity mismatch");
  if (batch.observations.length === 0) return { inserted: 0, existing: 0 };
  const db = openOpsDb();
  const byId = db.prepare("SELECT id, canonical_url FROM discovery_candidates WHERE id = ?");
  const byUrl = db.prepare("SELECT id, canonical_url FROM discovery_candidates WHERE canonical_url = ?");
  const insert = db.prepare(`INSERT INTO candidate_qualification_evidence (
    candidate_id, canonical_url, run_id, run_attempt, qualifier_version, device, observed_at,
    final_url_origin, final_url_sha256,
    document_http_status, render_result, functionality_result, meaningful_text_length, interaction_attempted,
    visible_state_changed, network_failure_reasons_json, frame_failure_reasons_json, console_failure_count, commercial_signal, documentation_signal
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (candidate_id, run_id, run_attempt, qualifier_version, device) DO NOTHING`);

  db.exec("BEGIN IMMEDIATE");
  try {
    let inserted = 0;
    for (const row of batch.observations) {
      const candidate = row.candidate_id === undefined ? byUrl.get(row.canonical_url) : byId.get(row.candidate_id);
      if (!candidate) throw new Error("Unknown candidate");
      if (candidate.canonical_url !== row.canonical_url) throw new Error("Candidate URL mismatch");
      // Never persist diagnostic messages: a destination can echo its body to
      // the console, and only allowlisted classifications are useful downstream.
      const finalUrl = row.final_url_identity ?? (row.final_url ? getQualificationUrlIdentity(row.final_url) : null);
      inserted += Number(insert.run(
        candidate.id, row.canonical_url, batch.run_id, batch.run_attempt, batch.qualifier_version,
        row.device, row.observed_at, finalUrl?.final_url_origin ?? null, finalUrl?.final_url_sha256 ?? null,
        row.document_http_status, row.render_result,
        row.functionality_result, row.meaningful_text_length, Number(row.interaction_evidence.attempted),
        Number(row.interaction_evidence.visible_state_changed),
        JSON.stringify([...new Set(row.network_failure_reasons.map(networkReason))]),
        JSON.stringify([...new Set(row.frame_failure_reasons.map(frameReason))]),
        row.console_failure_reasons.length, Number(row.commercial_signal === true),
        Number(row.documentation_signal === true),
      ).changes);
    }
    db.exec("COMMIT");
    return { inserted, existing: batch.observations.length - inserted };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

type EvidenceRow = Omit<StoredObservation, "interaction_evidence" | "network_failure_reasons" | "frame_failure_reasons" | "commercial_signal" | "documentation_signal"> &
  QualificationIdentity & {
    candidate_id: string;
    canonical_url: string;
    interaction_attempted: number;
    visible_state_changed: number;
    network_failure_reasons_json: string;
    frame_failure_reasons_json: string;
    commercial_signal: number;
    documentation_signal: number;
  };

function readObservation(row: EvidenceRow): StoredObservation {
  return {
    device: row.device,
    observed_at: row.observed_at,
    final_url_origin: row.final_url_origin,
    final_url_sha256: row.final_url_sha256,
    document_http_status: row.document_http_status,
    render_result: row.render_result,
    functionality_result: row.functionality_result,
    meaningful_text_length: row.meaningful_text_length,
    interaction_evidence: { attempted: Boolean(row.interaction_attempted), visible_state_changed: Boolean(row.visible_state_changed) },
    network_failure_reasons: JSON.parse(row.network_failure_reasons_json),
    frame_failure_reasons: JSON.parse(row.frame_failure_reasons_json),
    console_failure_count: row.console_failure_count,
    commercial_signal: Boolean(row.commercial_signal),
    documentation_signal: Boolean(row.documentation_signal),
  };
}

const latestObservationOrder = "observed_at DESC, length(run_id) DESC, run_id DESC, run_attempt DESC, qualifier_version DESC";

export function getPendingQualificationCandidates(sourceFamily: string | null) {
  const cutoff = new Date(Date.now() - MAX_QUALIFICATION_EVIDENCE_AGE_MS).toISOString();
  return openOpsDb().prepare(`
    SELECT candidate.canonical_url FROM discovery_candidates AS candidate
    LEFT JOIN candidate_qualification_evidence AS desktop ON desktop.rowid = (
      SELECT rowid FROM candidate_qualification_evidence WHERE candidate_id = candidate.id AND device = 'desktop'
      ORDER BY ${latestObservationOrder} LIMIT 1
    )
    LEFT JOIN candidate_qualification_evidence AS mobile ON mobile.rowid = (
      SELECT rowid FROM candidate_qualification_evidence WHERE candidate_id = candidate.id AND device = 'mobile'
      ORDER BY ${latestObservationOrder} LIMIT 1
    )
    WHERE candidate.status = 'pending_review'
      AND candidate.source_family != 'runtime-recheck'
      AND (? IS NULL OR candidate.source_family = ?)
      AND (desktop.rowid IS NULL OR mobile.rowid IS NULL OR
        desktop.run_id != mobile.run_id OR desktop.run_attempt != mobile.run_attempt OR
        desktop.qualifier_version != mobile.qualifier_version OR desktop.qualifier_version != ? OR
        desktop.canonical_url != mobile.canonical_url OR
        desktop.canonical_url != candidate.canonical_url OR
        desktop.render_result = 'budget_exhausted' OR mobile.render_result = 'budget_exhausted' OR
        desktop.observed_at < ? OR mobile.observed_at < ?)
    ORDER BY candidate.discovered_at, candidate.id
    LIMIT 24`).all(sourceFamily, sourceFamily, QUALIFIER_VERSION, cutoff, cutoff).map(row => ({ canonical_url: String(row.canonical_url) }));
}

export function getLatestQualificationSet(candidateId: string): QualificationSet | null {
  const latest = openOpsDb().prepare(`SELECT * FROM candidate_qualification_evidence
    WHERE candidate_id = ? AND device = ?
    ORDER BY ${latestObservationOrder} LIMIT 1`);
  const desktop = latest.get(candidateId, "desktop") as EvidenceRow | undefined;
  const mobile = latest.get(candidateId, "mobile") as EvidenceRow | undefined;
  // Fail closed rather than joining unrelated devices or falling back to an old
  // pair when either device already has a newer observation.
  if (!desktop || !mobile || desktop.run_id !== mobile.run_id || desktop.run_attempt !== mobile.run_attempt ||
    desktop.qualifier_version !== mobile.qualifier_version || desktop.canonical_url !== mobile.canonical_url) return null;
  return {
    candidate_id: desktop.candidate_id,
    canonical_url: desktop.canonical_url,
    run_id: desktop.run_id,
    run_attempt: desktop.run_attempt,
    qualifier_version: desktop.qualifier_version,
    desktop: readObservation(desktop),
    mobile: readObservation(mobile),
  };
}
