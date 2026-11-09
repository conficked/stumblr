import { createHash, randomUUID } from "node:crypto";
import { collectorDomainTitle, readCollectorTitleSignals } from "./collectorMetadata";
import type { SQLOutputValue } from "node:sqlite";
import { openOpsDb, type OpsDb } from "@/lib/db/client";
import type { AutoPublishActor } from "@/lib/security/cataloguePublisher";
import { buildAutoPublishedEntry, type ReviewedRuntimeEntry } from "./autoPublishEntry";
import {
  AUTO_POLICY_VERSION, evaluateAutoPublishCandidate, rankAutoPublishBatch, sanitizeAutoPublishTitle,
  type AutoPublishIdentity, type AutoPublishRepository, type RankedBatch,
} from "./autoPublishPolicy";
import { catalogueEntries } from "./entries";
import { getCatalogue, getFrameAllowlist } from "./index";
import { buildSecurityHeaders } from "@/lib/security/headers";
import { getLatestQualificationSet, type QualificationSet } from "./qualificationEvidence";
import { runtimeCatalogueSchema } from "./runtimeSchema";
import { pruneEvidenceInTransaction, type RetentionResult } from "./evidenceRetention";
import { screenedDestinationSchema } from "./screenedDestination";
import { getQualificationUrlIdentity } from "./destinationIdentity.mjs";
import { titleDigest } from "./titleClassification.mjs";
import { noteRuntimeHealthPublication } from "./runtimeHealth";
import { catalogueTransaction, insertCatalogueSnapshot, projectRuntimeCatalogue, readCatalogueHead, readQuarantinedUrls } from "./runtimeStore";

export type { AutoPublishActor } from "@/lib/security/cataloguePublisher";
type Snapshot = ReturnType<typeof runtimeCatalogueSchema.parse>;
type Row = Record<string, SQLOutputValue>;
type Head = ReturnType<typeof readCatalogueHead>;
const emptySnapshot: Snapshot = { entries: [] };
const digest = (payload: string) => createHash("sha256").update(payload).digest("hex");

type Tally = {
  considered: number; admitted: number; deferred: number; rejected: number; duplicate: number; capped: number;
};
const tally = (): Tally => ({ considered: 0, admitted: 0, deferred: 0, rejected: 0, duplicate: 0, capped: 0 });

type Counts = Tally & {
  removals: number;
  byFamily: Record<string, Tally>;
  byTopic: Record<string, Tally>;
  byEvidenceClass: Record<string, number>;
  byReason: Record<string, number>;
  retention?: RetentionResult;
};

const rolloutStages = {
  report_only: { stage: "report_only", cap: 20 },
  limited: { stage: "limited", cap: 5 },
  full: { stage: "full", cap: 20 },
} as const;

type RolloutStage = keyof typeof rolloutStages;
export type AutoPublicationRolloutStage = (typeof rolloutStages)[RolloutStage];

function scheduledRolloutStage(db: OpsDb, actor: AutoPublishActor): AutoPublicationRolloutStage {
  if (actor.event !== "schedule") return rolloutStages.full;
  const previous = db.prepare(`SELECT rollout_stage FROM auto_publication_proposals
    WHERE actor_event = 'schedule' AND actor_run_id = ? AND rollout_stage IS NOT NULL ORDER BY rowid LIMIT 1`).get(actor.runId);
  if (previous) return rolloutStages[previous.rollout_stage as RolloutStage];

  const reports = db.prepare(`SELECT COUNT(DISTINCT actor_run_id) AS total FROM auto_publication_proposals
    WHERE actor_event = 'schedule' AND rollout_stage = 'report_only'`).get();
  if (Number(reports?.total) < 3) return rolloutStages.report_only;

  const releases = db.prepare(`SELECT COUNT(DISTINCT p.actor_run_id) AS total FROM auto_publication_proposals p
    JOIN auto_publication_audit a ON a.proposal_id = p.proposal_id AND a.operation = 'publish'
    WHERE p.actor_event = 'schedule' AND p.rollout_stage = 'limited' AND p.status = 'published' AND p.proof_status = 'verified' AND p.public_check = 'confirmed'
      AND NOT EXISTS (SELECT 1 FROM auto_publication_audit r
        WHERE r.release_revision = a.release_revision AND r.operation = 'rollback')`).get();
  return Number(releases?.total) < 3 ? rolloutStages.limited : rolloutStages.full;
}

export function getAutoPublicationRolloutStage(actor: AutoPublishActor): AutoPublicationRolloutStage {
  return scheduledRolloutStage(openOpsDb(), actor);
}

export type AutoPublicationPreview = {
  proposalId: string;
  expectedRevision: string | null;
  contentHash: string;
  policyVersion: string;
  requestedCap: number;
  rolloutStage: AutoPublicationRolloutStage;
  currentSnapshot: Snapshot;
  proposedSnapshot: Snapshot;
  additions: ReviewedRuntimeEntry[];
  removals: ReviewedRuntimeEntry[];
  decisions: RankedBatch;
  counts: Counts;
  evidence: Record<string, QualificationSet>;
  retention?: RetentionResult;
  recovery?: AutoPublicationRecovery;
};

export type CommitResult = {
  status: "published" | "no_op";
  revision: string | null;
  entryCount: number;
  addedIds: string[];
  removedIds: string[];
};
export type RollbackResult = { revision: string; entryCount: number; removedIds: string[] };

type ProofStatus = "legacy" | "pending" | "verified" | "unverified" | "rolled_back";
type PublicCheck = "pending" | "confirmed" | "failed";
const PUBLIC_CHECK_WINDOW_SECONDS = 300;
type AutoPublicationRecovery = {
  status: ProofStatus;
  release: CommitResult;
  publicCheck?: PublicCheck;
  rollback?: RollbackResult;
};

export class AutoPublicationConflict extends Error {}

function checkActorOrder(head: Head, issuedAt: number) {
  if (head && (issuedAt < head.issuedAt || (issuedAt === head.issuedAt && !head.revision.includes(":")))) {
    throw new AutoPublicationConflict("Stale publication");
  }
}

function readObject(value: SQLOutputValue | undefined): Record<string, unknown> {
  const parsed: unknown = JSON.parse(String(value ?? "{}"));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
}

function readRepositories(rows: Row[]): AutoPublishRepository[] {
  return rows.map(row => {
    const data = readObject(row.provenance_json);
    const github = data.github_evidence;
    const evidence = github && typeof github === "object" ? github as Record<string, unknown> : {};
    const field = (name: string) => data[name] ?? evidence[name];
    return {
      id: String(row.repository_id),
      fullName: typeof data.repository_full_name === "string" ? data.repository_full_name : "",
      url: typeof data.repository_url === "string" ? data.repository_url : "",
      demoUrl: typeof data.demo_url === "string" ? data.demo_url : "",
      archived: field("archived") !== false,
      stars: typeof field("stars") === "number" ? Number(field("stars")) : 0,
      pushedAt: String(field("pushed_at") ?? ""),
      fork: field("fork") === true,
      description: typeof field("description") === "string" ? String(field("description")) : undefined,
      topics: Array.isArray(field("topics")) ? (field("topics") as unknown[]).filter((item): item is string => typeof item === "string") : [],
    };
  });
}

function publicationInputs(db: OpsDb, snapshot: Snapshot, now: string) {
  const byUrl = db.prepare("SELECT * FROM discovery_candidates WHERE canonical_url = ?");
  const repositories = db.prepare("SELECT repository_id, provenance_json FROM discovery_candidate_repositories WHERE candidate_id = ? ORDER BY repository_id");
  const priorRejection = db.prepare("SELECT 1 FROM review_history WHERE entity_type = 'discovery_candidate' AND entity_id = ? AND to_status = 'rejected' LIMIT 1");
  const findRepos = (row: Row) => readRepositories(repositories.all(row.id));
  const screenedDestination = (row: Row) => {
    const { screened_destination } = readObject(row.screen_json);
    return screened_destination == null ? undefined : screenedDestinationSchema.parse(screened_destination);
  };
  const identity = (entry: AutoPublishIdentity): AutoPublishIdentity => {
    const row = byUrl.get(entry.canonicalUrl);
    if (!row) return entry;
    const repos = findRepos(row);
    return {
      ...entry, sourceFamily: String(row.source_family), effectiveDestination: screenedDestination(row),
      titleDigest: readCollectorTitleSignals(readObject(row.screen_json).title_signals).digest,
      repositoryIds: repos.map(repo => repo.id), repositoryFullNames: repos.map(repo => repo.fullName).filter(Boolean),
    };
  };
  const bundled = catalogueEntries.map(identity);
  const runtime = snapshot.entries.map(identity);
  return (row: Row) => {
    const id = String(row.id);
    const qualification = getLatestQualificationSet(id);
    const topics: unknown = JSON.parse(String(row.topics_json));
    const titleSignals = readCollectorTitleSignals(readObject(row.screen_json).title_signals);
    const candidate = {
      id, canonicalUrl: String(row.canonical_url), domain: String(row.domain), status: String(row.status),
      sourceId: String(row.source_id), sourceFamily: String(row.source_family), sourceUrl: String(row.source_url),
      title: trustedTitle(row, titleSignals.digest) ?? collectorDomainTitle(String(row.domain)), topics: Array.isArray(topics) ? topics.map(String) : [],
      previouslyRejected: !!priorRejection.get(id), screenedDestination: screenedDestination(row), titleSignals,
    };
    const decision = evaluateAutoPublishCandidate({ now, candidate, qualification, repositories: findRepos(row), bundled, runtime });
    return { candidate, decision, qualification };
  };
}

// Stored text is shown only when it is provably the screened document's own
// title: no redirect (which could reflect a private terminal URL) and the
// text hashes to the digest recorded independently at screening.
function trustedTitle(row: Row, digest: string | undefined) {
  const text = sanitizeAutoPublishTitle(String(row.link_text ?? ""));
  if (!text || !digest || titleDigest(text) !== digest) return null;
  const { screened_destination } = readObject(row.screen_json);
  const screened = screened_destination == null ? null : screenedDestinationSchema.safeParse(screened_destination);
  if (screened && (!screened.success ||
    screened.data.final_url_sha256 !== getQualificationUrlIdentity(String(row.canonical_url)).final_url_sha256)) return null;
  return text;
}

type Evaluation = ReturnType<ReturnType<typeof publicationInputs>>;
function countDecisions(evaluations: Evaluation[], decisions: RankedBatch, removals: number): Counts {
  const counts: Counts = {
    ...tally(), removals, byFamily: Object.create(null), byTopic: Object.create(null),
    byEvidenceClass: Object.create(null), byReason: Object.create(null),
  };
  const admitted = new Set(decisions.admitted.map(decision => decision.candidateId));
  const deferred = new Map(decisions.deferred.map(({ decision, reason }) => [decision.candidateId, reason]));
  for (const { candidate, decision } of evaluations) {
    const deferral = deferred.get(candidate.id);
    const outcome = admitted.has(candidate.id) ? "admitted" : deferral ? "deferred" : "rejected";
    const duplicate = decision.reasons.some(reason => reason.startsWith("duplicate_")) || deferral === "batch_duplicate";
    const capped = deferral !== undefined && deferral !== "batch_duplicate";
    const family = counts.byFamily[candidate.sourceFamily] ??= tally();
    const topic = counts.byTopic[candidate.topics[0] ?? "unclassified"] ??= tally();
    for (const bucket of [counts, family, topic]) {
      bucket.considered++;
      bucket[outcome]++;
      if (duplicate) bucket.duplicate++;
      if (capped) bucket.capped++;
    }
    const reasons = deferral ? [...decision.reasons, deferral] : decision.reasons;
    for (const reason of reasons) counts.byReason[reason] = (counts.byReason[reason] ?? 0) + 1;
    const evidenceClass = decision.eligible ? decision.reasons[0] : "not_eligible";
    counts.byEvidenceClass[evidenceClass] = (counts.byEvidenceClass[evidenceClass] ?? 0) + 1;
  }
  return counts;
}

function readSnapshot(db: OpsDb, revision: string | null): Snapshot {
  if (revision === null) return emptySnapshot;
  const row = db.prepare("SELECT payload_json FROM runtime_catalogue_snapshots WHERE revision = ?").get(revision);
  return runtimeCatalogueSchema.parse(JSON.parse(String(row?.payload_json)));
}

function readPreview(db: OpsDb, row: Row): AutoPublicationPreview {
  const expectedRevision = row.expected_revision === null ? null : String(row.expected_revision);
  const removals: ReviewedRuntimeEntry[] = JSON.parse(String(row.removals_json));
  const hiddenIds = new Set(removals.map(entry => entry.id));
  const currentSnapshot = { entries: readSnapshot(db, expectedRevision).entries.filter(entry => !hiddenIds.has(entry.id)) };
  const proposedSnapshot = runtimeCatalogueSchema.parse(JSON.parse(String(row.proposed_snapshot_json)));
  const decisions: RankedBatch = JSON.parse(String(row.decisions_json));
  const admitted = new Set(decisions.admitted.map(decision => decision.candidateId));
  const counts: Counts = JSON.parse(String(row.counts_json));
  return {
    proposalId: String(row.proposal_id), expectedRevision, contentHash: String(row.content_hash),
    policyVersion: String(row.policy_version), requestedCap: Number(row.requested_cap),
    rolloutStage: rolloutStages[(row.rollout_stage ?? "full") as RolloutStage],
    currentSnapshot, proposedSnapshot, decisions,
    additions: proposedSnapshot.entries.filter(entry => admitted.has(entry.id)),
    removals,
    counts, evidence: JSON.parse(String(row.evidence_json)),
    ...(counts.retention ? { retention: counts.retention } : {}),
  };
}

function sameActor(row: Row, actor: AutoPublishActor) {
  return row.actor_revision === actor.revision && row.actor_run_id === actor.runId &&
    row.actor_run_attempt === actor.runAttempt && row.actor_event === actor.event;
}

function sameReleaseRun(row: Row, actor: AutoPublishActor) {
  return row.actor_run_id === actor.runId && row.actor_event === actor.event &&
    actor.runAttempt >= Number(row.actor_run_attempt) &&
    String(row.actor_revision).split(":")[0] === actor.revision.split(":")[0];
}

function committedRun(db: OpsDb, actor: AutoPublishActor) {
  const row = db.prepare(`SELECT * FROM auto_publication_proposals
    WHERE actor_event = ? AND actor_run_id = ? AND status = 'published' LIMIT 1`).get(actor.event, actor.runId);
  if (row && !sameReleaseRun(row, actor)) throw new AutoPublicationConflict("Unknown release run");
  return row;
}

function recoverRelease(db: OpsDb, row: Row): AutoPublicationRecovery {
  const rollback = db.prepare("SELECT result_json FROM auto_publication_audit WHERE revision = ?").get(`${row.actor_revision}:rollback`);
  return {
    status: row.proof_status as ProofStatus,
    release: JSON.parse(String(row.result_json)),
    ...(row.public_check ? { publicCheck: row.public_check as PublicCheck } : {}),
    ...(rollback ? { rollback: JSON.parse(String(rollback.result_json)) } : {}),
  };
}

function readCommittedRelease(db: OpsDb, actor: AutoPublishActor, revision: string) {
  const row = db.prepare(`SELECT * FROM auto_publication_proposals WHERE actor_revision = ? AND status = 'published'`).get(revision);
  if (!row || !sameReleaseRun(row, actor)) throw new AutoPublicationConflict("Unknown release");
  return row;
}

function canProveRelease(row: Row, actor: AutoPublishActor) {
  return row.proof_status === "pending" ||
    (row.proof_status === "unverified" && actor.runAttempt > Number(row.proof_attempt));
}

function requireSettledPublicHead(db: OpsDb, head: Head) {
  if (head && db.prepare(`SELECT 1 FROM auto_publication_proposals WHERE actor_revision = ? AND public_check = 'pending'`)
    .get(head.revision.replace(/:rollback$/, ""))) {
    throw new AutoPublicationConflict("Active release is awaiting public verification");
  }
}

function nextDurableSnapshot(db: OpsDb, current: Snapshot, additions: ReviewedRuntimeEntry[]): Snapshot {
  // Established runtime-health removals stay in the snapshot so private
  // rechecks can restore them. Explicit queue quarantines remain pruned.
  const quarantined = readQuarantinedUrls(db);
  return runtimeCatalogueSchema.parse({ entries: [...current.entries.filter(entry => !quarantined.has(entry.canonicalUrl)), ...additions] });
}

export function createAutoPublicationPreview(actor: AutoPublishActor, requestedCap: number): AutoPublicationPreview {
  if (!Number.isInteger(requestedCap) || requestedCap < 1 || requestedCap > 20) throw new RangeError("Auto-publish cap must be 1–20");
  return catalogueTransaction(db => {
    const committed = committedRun(db, actor);
    if (committed) return { ...readPreview(db, committed), recovery: recoverRelease(db, committed) };
    const existing = db.prepare("SELECT * FROM auto_publication_proposals WHERE actor_revision = ?").get(actor.revision);
    if (existing) {
      if (!sameActor(existing, actor) || existing.requested_cap !== requestedCap) {
        throw new AutoPublicationConflict("Run already has a different proposal");
      }
      return readPreview(db, existing);
    }

    const head = readCatalogueHead(db);
    requireSettledPublicHead(db, head);
    checkActorOrder(head, actor.issuedAt);
    const currentSnapshot = head?.snapshot ?? emptySnapshot;
    const { hidden: removals } = projectRuntimeCatalogue(db, currentSnapshot);
    const now = new Date().toISOString();
    const evaluate = publicationInputs(db, currentSnapshot, now);
    const evaluated = db.prepare("SELECT * FROM discovery_candidates WHERE status = 'pending_review' ORDER BY id").all().map(evaluate);
    const slots = 1000 - nextDurableSnapshot(db, currentSnapshot, []).entries.length;
    const rolloutStage = scheduledRolloutStage(db, actor);
    const decisions = rankAutoPublishBatch(evaluated.map(item => item.decision), Math.max(1, Math.min(requestedCap, rolloutStage.cap, slots)));
    if (slots === 0) {
      decisions.deferred.unshift(...decisions.admitted.splice(0).map(decision => ({ decision, reason: "batch_cap" as const })));
    }
    const additions = decisions.admitted.map(decision => buildAutoPublishedEntry(decision, { runId: actor.runId, reviewedAt: now }));
    const durableSnapshot = nextDurableSnapshot(db, currentSnapshot, additions);
    const proposedSnapshot = projectRuntimeCatalogue(db, durableSnapshot).visible;
    const proposedJson = JSON.stringify(proposedSnapshot);
    const admitted = new Set(decisions.admitted.map(decision => decision.candidateId));
    const evidence = Object.fromEntries(evaluated.flatMap(({ candidate, qualification }) =>
      admitted.has(candidate.id) && qualification ? [[candidate.id, qualification]] : []));
    const proposalId = randomUUID();
    const expectedRevision = head?.revision ?? null;
    const contentHash = digest(proposedJson);
    const counts = countDecisions(evaluated, decisions, removals.length);
    if (actor.event === "schedule") {
      // Save the pruning result with the proposal so retries cannot spend this
      // run's deletion budget again, even if they use a new workflow attempt.
      const previous = db.prepare(`SELECT json_extract(counts_json, '$.retention') AS retention
        FROM auto_publication_proposals WHERE actor_event = 'schedule' AND actor_run_id = ?
          AND json_type(counts_json, '$.retention') = 'object' ORDER BY rowid LIMIT 1`).get(actor.runId);
      counts.retention = previous ? JSON.parse(String(previous.retention)) : pruneEvidenceInTransaction(db, new Date(now));
    }
    const row = db.prepare(`INSERT INTO auto_publication_proposals (
      proposal_id, actor_revision, actor_run_id, actor_run_attempt, actor_event, actor_issued_at, expected_revision,
      policy_version, requested_cap, content_hash, proposed_snapshot_json, decisions_json, counts_json, evidence_json,
      removals_json, status, created_at, rollout_stage, durable_content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?) RETURNING *`).get(
      proposalId, actor.revision, actor.runId, actor.runAttempt, actor.event, actor.issuedAt, expectedRevision,
      AUTO_POLICY_VERSION, requestedCap, contentHash, proposedJson, JSON.stringify(decisions), JSON.stringify(counts),
      JSON.stringify(evidence), JSON.stringify(removals), now, rolloutStage.stage, digest(JSON.stringify(durableSnapshot)),
    );
    if (!row) throw new Error("Publication proposal was not recorded");
    return readPreview(db, row);
  });
}

function writeAudit(
  db: OpsDb, proposalId: string, actor: AutoPublishActor, at: string, operation: "publish" | "rollback",
  priorRevision: string | null, releaseRevision: string, result: { revision: string; removedIds: string[] }, additions: string[],
  requestedIds?: string[],
) {
  db.prepare(`INSERT INTO auto_publication_audit (
    revision, prior_revision, release_revision, proposal_id, operation, additions_json, removals_json, result_json,
    actor_revision, actor_issued_at, created_at, requested_ids_json
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    result.revision, priorRevision, releaseRevision, proposalId, operation, JSON.stringify(additions), JSON.stringify(result.removedIds),
    JSON.stringify(result), actor.revision, actor.issuedAt, at, requestedIds ? JSON.stringify(requestedIds) : null,
  );
}

export function commitAutoPublicationPreview(
  actor: AutoPublishActor, proposalId: string, expectedRevision: string | null, contentHash: string,
): CommitResult {
  return catalogueTransaction(db => {
    const row = db.prepare("SELECT * FROM auto_publication_proposals WHERE proposal_id = ?").get(proposalId);
    if (!row || !(sameActor(row, actor) || (row.status === "published" && sameReleaseRun(row, actor)))) {
      throw new AutoPublicationConflict("Unknown proposal");
    }
    if (row.expected_revision !== expectedRevision || row.content_hash !== contentHash) {
      throw new AutoPublicationConflict("Proposal hash or revision mismatch");
    }
    if (row.status !== "pending") return JSON.parse(String(row.result_json));
    if (row.policy_version !== AUTO_POLICY_VERSION) throw new AutoPublicationConflict("Publication policy changed");
    if (digest(String(row.proposed_snapshot_json)) !== contentHash) throw new AutoPublicationConflict("Proposal hash or revision mismatch");

    const head = readCatalogueHead(db);
    requireSettledPublicHead(db, head);
    if ((head?.revision ?? null) !== expectedRevision) throw new AutoPublicationConflict("Stale publication");
    checkActorOrder(head, Number(row.actor_issued_at));
    const preview = readPreview(db, row);
    if (preview.rolloutStage.stage === "report_only") throw new AutoPublicationConflict("Scheduled run is report-only");
    if (committedRun(db, actor)) throw new AutoPublicationConflict("Run already committed a release");
    const currentSnapshot = head?.snapshot ?? emptySnapshot;
    const { hidden: removals } = projectRuntimeCatalogue(db, currentSnapshot);
    if (JSON.stringify(removals) !== String(row.removals_json)) throw new AutoPublicationConflict("Catalogue quarantine changed");
    const now = new Date().toISOString();
    const accepted = preview.decisions.admitted;
    const cap = Math.min(preview.requestedCap, preview.rolloutStage.cap);
    if (accepted.length > cap || rankAutoPublishBatch(accepted, cap).admitted.length !== accepted.length) {
      throw new AutoPublicationConflict("Proposal exceeds publication caps");
    }

    const evaluate = publicationInputs(db, currentSnapshot, now);
    const candidateById = db.prepare("SELECT * FROM discovery_candidates WHERE id = ?");
    const additions = accepted.map(prior => {
      const candidate = candidateById.get(prior.candidateId);
      if (!candidate) throw new AutoPublicationConflict("Candidate no longer exists");
      const fresh = evaluate(candidate);
      if (JSON.stringify(fresh.decision) !== JSON.stringify(prior) ||
        JSON.stringify(fresh.qualification) !== JSON.stringify(preview.evidence[prior.candidateId])) {
        throw new AutoPublicationConflict("Candidate policy evidence changed");
      }
      return buildAutoPublishedEntry(prior, { runId: actor.runId, reviewedAt: String(row.created_at) });
    });

    const snapshot = nextDurableSnapshot(db, currentSnapshot, additions);
    const { visible } = projectRuntimeCatalogue(db, snapshot);
    if (digest(JSON.stringify(visible)) !== contentHash ||
      (row.durable_content_hash !== null && digest(JSON.stringify(snapshot)) !== row.durable_content_hash)) {
      throw new AutoPublicationConflict("Proposal content changed");
    }
    let result: CommitResult;
    if (additions.length) {
      insertCatalogueSnapshot(db, snapshot, { ...actor, issuedAt: Number(row.actor_issued_at) }, now);
      const released = {
        status: "published" as const, revision: actor.revision, entryCount: visible.entries.length,
        addedIds: additions.map(entry => entry.id), removedIds: removals.map(entry => entry.id),
      };
      writeAudit(db, proposalId, actor, now, "publish", expectedRevision, actor.revision, released, released.addedIds);
      result = released;
    } else {
      result = { status: "no_op", revision: expectedRevision, entryCount: visible.entries.length, addedIds: [], removedIds: [] };
    }
    db.prepare("UPDATE auto_publication_proposals SET status = ?, committed_at = ?, result_json = ?, proof_status = ? WHERE proposal_id = ?")
      .run(result.status, now, JSON.stringify(result), additions.length ? "pending" : "legacy", proposalId);
    return result;
  });
}

function currentProofHead(db: OpsDb, row: Row) {
  if (row.policy_version !== AUTO_POLICY_VERSION) throw new AutoPublicationConflict("Publication policy changed");
  const head = readCatalogueHead(db);
  requireSettledPublicHead(db, head);
  if ((head?.revision ?? null) !== row.expected_revision) throw new AutoPublicationConflict("Stale publication");
  const { hidden: removals } = projectRuntimeCatalogue(db, head?.snapshot ?? emptySnapshot);
  if (JSON.stringify(removals) !== String(row.removals_json)) throw new AutoPublicationConflict("Catalogue quarantine changed");
  checkActorOrder(head, Number(row.actor_issued_at));
  return head;
}

function readStagedProposal(row: Row): Snapshot {
  const proposed = String(row.proposed_snapshot_json);
  if (digest(proposed) !== row.content_hash) throw new AutoPublicationConflict("Proposal content changed");
  return runtimeCatalogueSchema.parse(JSON.parse(proposed));
}

function stagedSnapshot(db: OpsDb, row: Row): Snapshot {
  const snapshot = readSnapshot(db, String(row.actor_revision));
  // Releases staged before the two projections used the public hash for both.
  if (digest(JSON.stringify(snapshot)) !== (row.durable_content_hash ?? row.content_hash)) {
    throw new AutoPublicationConflict("Proposal content changed");
  }
  return snapshot;
}

function requirePublicProjection(db: OpsDb, row: Row, snapshot: Snapshot, excludedIds = new Set<string>()) {
  const expected = readStagedProposal(row).entries.filter(entry => !excludedIds.has(entry.id));
  const { visible } = projectRuntimeCatalogue(db, snapshot);
  if (JSON.stringify(expected) !== JSON.stringify(visible.entries)) throw new AutoPublicationConflict("Public catalogue projection changed");
  return visible;
}

function checkFreshSurvivors(db: OpsDb, row: Row, prior: Snapshot, survivors: ReviewedRuntimeEntry[]) {
  if (row.policy_version !== AUTO_POLICY_VERSION) throw new AutoPublicationConflict("Publication policy changed");
  const evaluate = publicationInputs(db, prior, new Date().toISOString());
  const byId = db.prepare("SELECT * FROM discovery_candidates WHERE id = ?");
  const decisions = survivors.map(entry => {
    const candidate = byId.get(entry.id);
    if (!candidate) throw new AutoPublicationConflict("Staged candidate is now ineligible");
    const { decision } = evaluate(candidate);
    if (!decision.eligible) throw new AutoPublicationConflict("Staged candidate is now ineligible");
    const current = buildAutoPublishedEntry({ ...decision, observedAt: entry.embedEvidence.observedAt }, {
      runId: String(row.actor_run_id), reviewedAt: String(row.created_at),
    });
    if (JSON.stringify(current) !== JSON.stringify(entry)) throw new AutoPublicationConflict("Staged candidate metadata changed");
    return decision;
  });
  const cap = Math.min(Number(row.requested_cap), rolloutStages[(row.rollout_stage ?? "full") as RolloutStage].cap);
  if (rankAutoPublishBatch(decisions, cap).admitted.length !== survivors.length) {
    throw new AutoPublicationConflict("Staged candidates are no longer eligible as a batch");
  }
}

function beginPublicCheck(db: OpsDb, row: Row) {
  db.prepare("UPDATE auto_publication_proposals SET public_check = 'pending', public_check_deadline = unixepoch() + ? WHERE proposal_id = ?")
    .run(PUBLIC_CHECK_WINDOW_SECONDS, row.proposal_id);
}

function installVerifiedCandidates(db: OpsDb, entries: ReviewedRuntimeEntry[], revision: string, now: string) {
  const update = db.prepare(`UPDATE discovery_candidates SET status = 'reviewed_exportable', updated_at = ?
    WHERE id = ? AND canonical_url = ? AND status = 'pending_review'`);
  const history = db.prepare(`INSERT INTO review_history (entity_type, entity_id, from_status, to_status, actor, note, at)
    VALUES ('discovery_candidate', ?, 'pending_review', 'reviewed_exportable', ?, ?, ?)`);
  for (const entry of entries) {
    if (Number(update.run(now, entry.id, entry.canonicalUrl).changes) !== 1) throw new AutoPublicationConflict("Candidate no longer pending");
    history.run(entry.id, entry.provenance.reviewer, `Automatic evaluation publication ${revision}`, now);
    noteRuntimeHealthPublication(db, entry.id, entry.provenance.reviewedAt, revision, "automatic");
  }
}

function setProofStatus(db: OpsDb, row: Row, status: ProofStatus, actor: AutoPublishActor) {
  db.prepare("UPDATE auto_publication_proposals SET proof_status = ?, proof_attempt = ? WHERE proposal_id = ?")
    .run(status, actor.runAttempt, row.proposal_id);
}

export function getAutoPublicationProof(actor: AutoPublishActor, revision: string) {
  return catalogueTransaction(db => {
    const row = readCommittedRelease(db, actor, revision);
    if (!canProveRelease(row, actor)) throw new AutoPublicationConflict("Release proof is already settled");
    currentProofHead(db, row);
    const snapshot = stagedSnapshot(db, row);
    const { entries } = requirePublicProjection(db, row, snapshot);
    const contentSecurityPolicy = buildSecurityHeaders(
      getFrameAllowlist([...getCatalogue({ includeEvaluation: true }), ...entries]),
    )["Content-Security-Policy"];
    const release: CommitResult = JSON.parse(String(row.result_json));
    return {
      status: "pending" as const, revision, expectedRevision: row.expected_revision, entryCount: entries.length,
      addedIds: release.addedIds, entries, contentSecurityPolicy,
    };
  });
}

export function completeAutoPublicationProof(actor: AutoPublishActor, revision: string, outcome: "verified" | "unverified") {
  return catalogueTransaction(db => {
    const row = readCommittedRelease(db, actor, revision);
    if (row.proof_status === outcome && (outcome === "verified" || actor.runAttempt <= Number(row.proof_attempt))) {
      return { status: outcome, revision };
    }
    if (!canProveRelease(row, actor)) throw new AutoPublicationConflict("Release proof is already settled");
    if (outcome === "verified") {
      const prior = currentProofHead(db, row)?.snapshot ?? emptySnapshot;
      const release: CommitResult = JSON.parse(String(row.result_json));
      const snapshot = stagedSnapshot(db, row);
      checkFreshSurvivors(db, row, prior, snapshot.entries.filter(entry => release.addedIds.includes(entry.id)));
      requirePublicProjection(db, row, snapshot);
      beginPublicCheck(db, row);
    }
    setProofStatus(db, row, outcome, actor);
    return { status: outcome, revision };
  });
}

function quarantineFreshCandidates(db: OpsDb, targets: ReviewedRuntimeEntry[], releaseRevision: string, now: string, pendingOnly = false) {
  const status = db.prepare("SELECT status FROM discovery_candidates WHERE id = ? AND canonical_url = ?");
  const quarantine = db.prepare("UPDATE discovery_candidates SET status = 'quarantined', updated_at = ? WHERE id = ? AND status != 'quarantined'");
  const history = db.prepare(`INSERT INTO review_history (entity_type, entity_id, from_status, to_status, actor, note, at)
    VALUES ('discovery_candidate', ?, ?, 'quarantined', ?, ?, ?)`);
  for (const entry of targets) {
    const candidate = status.get(entry.id, entry.canonicalUrl);
    if (!candidate || (pendingOnly && candidate.status !== "pending_review" && candidate.status !== "quarantined")) {
      throw new AutoPublicationConflict("Fresh candidate review state changed");
    }
    if (Number(quarantine.run(now, entry.id).changes)) {
      history.run(entry.id, candidate.status, entry.provenance.reviewer, `Fresh production proof failure in ${releaseRevision}`, now);
    }
  }
}

export function completeAutoPublicationPublicCheck(actor: AutoPublishActor, releaseRevision: string, outcome: "confirmed" | "failed") {
  return catalogueTransaction(db => {
    const row = readCommittedRelease(db, actor, releaseRevision);
    const { release, rollback } = recoverRelease(db, row);
    const revision = rollback?.revision ?? releaseRevision;
    if (row.public_check === outcome) return { publicCheck: outcome, revision };
    if (row.public_check !== "pending") throw new AutoPublicationConflict("Public verification is already settled");
    if (outcome === "confirmed") {
      const head = readCatalogueHead(db);
      if (head?.revision !== revision) throw new AutoPublicationConflict("Active revision changed before public confirmation");
      const initial = stagedSnapshot(db, row);
      const failedIds = new Set(rollback?.removedIds ?? []);
      const expectedDurable = { entries: initial.entries.filter(entry => !failedIds.has(entry.id)) };
      if (JSON.stringify(expectedDurable) !== JSON.stringify(head.snapshot)) {
        throw new AutoPublicationConflict("Active catalogue changed before public confirmation");
      }
      const { entries } = requirePublicProjection(db, row, head.snapshot, failedIds);
      const survivors = entries.filter(entry => release.addedIds.includes(entry.id));
      checkFreshSurvivors(db, row, readSnapshot(db, row.expected_revision as string | null), survivors);
      const now = new Date().toISOString();
      installVerifiedCandidates(db, survivors, revision, now);
      quarantineFreshCandidates(db, initial.entries.filter(entry => failedIds.has(entry.id)), releaseRevision, now, true);
    }
    db.prepare("UPDATE auto_publication_proposals SET public_check = ? WHERE proposal_id = ?").run(outcome, row.proposal_id);
    return { publicCheck: outcome, revision };
  });
}

export function rollbackFreshAdditions(actor: AutoPublishActor, releaseRevision: string, failedIds: string[]): RollbackResult {
  const failed = new Set(failedIds);
  if (!failed.size || failed.size !== failedIds.length || failed.size > 20 ||
    failedIds.some(id => typeof id !== "string" || !id.length || id.length > 200)) throw new RangeError("Invalid failed candidate IDs");
  return catalogueTransaction(db => {
    const proposal = readCommittedRelease(db, actor, releaseRevision);
    const release = db.prepare(`SELECT audit.*, snapshot.rowid AS sequence FROM auto_publication_audit AS audit
      JOIN runtime_catalogue_snapshots AS snapshot ON snapshot.revision = audit.revision
      WHERE audit.revision = ? AND audit.operation = 'publish'`).get(releaseRevision);
    if (!release) throw new AutoPublicationConflict("Unknown auto release");
    const fresh = new Set<string>(JSON.parse(String(release.additions_json)));
    if (failedIds.some(id => !fresh.has(id))) throw new AutoPublicationConflict("Rollback can remove only fresh release additions");

    const revision = `${releaseRevision}:rollback`;
    const replay = db.prepare("SELECT result_json, requested_ids_json, removals_json FROM auto_publication_audit WHERE revision = ?").get(revision);
    if (replay) {
      const requested: string[] = JSON.parse(String(replay.requested_ids_json ?? replay.removals_json));
      if (requested.length !== failed.size || requested.some(id => !failed.has(id))) {
        throw new AutoPublicationConflict("Release already rolled back a different set");
      }
      return JSON.parse(String(replay.result_json));
    }

    const staged = canProveRelease(proposal, actor);
    if (!staged && (!["verified", "legacy"].includes(String(proposal.proof_status)) ||
      ["pending", "failed"].includes(String(proposal.public_check)))) {
      throw new AutoPublicationConflict("Release proof is already settled");
    }
    const head = staged ? currentProofHead(db, proposal) : readCatalogueHead(db);
    if (!staged) requireSettledPublicHead(db, head);
    const manual = db.prepare("SELECT 1 FROM runtime_catalogue_snapshots WHERE rowid > ? AND instr(revision, ':') = 0 LIMIT 1").get(release.sequence);
    if (!staged && (!head || head.sequence < Number(release.sequence) || manual)) {
      throw new AutoPublicationConflict("A newer manual publication superseded this release");
    }
    const initial = staged ? stagedSnapshot(db, proposal) : readSnapshot(db, releaseRevision);
    const entries = staged ? initial.entries : head!.snapshot.entries;
    const targets = entries.filter(entry => failed.has(entry.id));
    if (targets.some(entry =>
      JSON.stringify(entry) !== JSON.stringify(initial.entries.find(item => item.id === entry.id)))) {
      throw new AutoPublicationConflict("Fresh release additions changed");
    }

    const now = new Date().toISOString();
    const snapshot = runtimeCatalogueSchema.parse({ entries: entries.filter(entry => !failed.has(entry.id)) });
    if (staged) {
      checkFreshSurvivors(db, proposal, head?.snapshot ?? emptySnapshot, snapshot.entries.filter(entry => fresh.has(entry.id)));
      requirePublicProjection(db, proposal, snapshot, failed);
      beginPublicCheck(db, proposal);
    }
    // A refreshed proof token must not outrank an in-flight manual publication.
    insertCatalogueSnapshot(db, snapshot, { revision, issuedAt: staged ? Number(proposal.actor_issued_at) : head!.issuedAt }, now);
    if (!staged) quarantineFreshCandidates(db, targets, releaseRevision, now);
    const result = { revision, entryCount: projectRuntimeCatalogue(db, snapshot).visible.entries.length, removedIds: targets.map(entry => entry.id) };
    setProofStatus(db, proposal, "rolled_back", actor);
    writeAudit(db, String(release.proposal_id), actor, now, "rollback", head?.revision ?? null, releaseRevision, result, [], [...failed].sort());
    return result;
  });
}
