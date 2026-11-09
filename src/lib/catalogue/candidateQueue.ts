import { z } from "zod";
import { openOpsDb } from "@/lib/db/client";
import { classifyLegacyFraming, collectorDomainTitle, readCollectorTitleSignals } from "./collectorMetadata";
import { classifyCollectorTitle } from "./titleClassification.mjs";
import { sanitizeAutoPublishTitle } from "./autoPublishPolicy";
import { screenedDestinationSchema } from "./screenedDestination";
import { getQualificationUrlIdentity } from "./destinationIdentity.mjs";

const url = z.url().refine(value => {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !parsed.username && !parsed.password &&
    !parsed.port && /\.[a-z]{2,}$/i.test(parsed.hostname);
});
const metadataUrl = z.string().refine(value => {
  if ([...value].some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === "\\") ||
    /%(?![0-9a-f]{2})|%(?:0[0-9a-f]|1[0-9a-f]|7f|5c)/i.test(value)) return false;
  try {
    const parsed = new URL(value);
    const authority = /^https:\/\/([^/?#]+)/i.exec(value)?.[1].toLowerCase();
    const host = parsed.hostname;
    const labels = host.split(".");
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.port &&
      (authority === host || authority === `${host}:443`) && host.length <= 253 && labels.length >= 2 &&
      /^[a-z]{2,63}$/i.test(labels.at(-1)!) && labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  } catch { return false; }
});
const provenanceSchema = z.object({
  repository_id: z.union([z.string().min(1).max(100), z.number().int().positive().safe()]).optional(),
  repository_full_name: z.string().min(1).max(300).optional(),
  repository_url: metadataUrl.optional(),
  demo_url: metadataUrl.optional(),
  github_evidence: z.record(z.string(), z.unknown()).optional(),
}).passthrough();
const associationSchema = provenanceSchema.extend({ repository_url: metadataUrl, demo_url: metadataUrl })
  .required({ repository_id: true, repository_full_name: true })
  .refine(row => /^[1-9][0-9]{0,99}$/.test(String(row.repository_id)))
  .transform(row => ({ ...row, raw_homepage: row.raw_homepage ?? row.demo_url,
    repository_url: new URL(row.repository_url).href, demo_url: new URL(row.demo_url).href }));
const candidateSchema = z.object({
  id: z.string().min(1).max(200), canonical_url: url, domain: z.string().max(253),
  source_id: z.string().min(1).max(200), source_family: z.string().min(1).max(100), source_url: url,
  topics: z.array(z.string().max(30)).max(9), title_hint: z.string().max(200),
  selection_status: z.enum(["evaluation_candidate", "blocked"]),
  availability_status: z.number().int().min(100).max(599).nullable(),
  screened_destination: screenedDestinationSchema.nullish(),
  title_signals: z.unknown().optional(),
  redirected: z.boolean().optional(),
  framing: z.strictObject({
    xfo_present: z.boolean(), csp_present: z.boolean(), csp_frame_ancestors: z.boolean(), denied: z.boolean(),
  }).optional(),
  x_frame_options: z.string().max(1000).nullish(),
  content_security_policy: z.string().max(10000).nullish(),
  provenance: provenanceSchema.optional(),
  association_update: z.literal(false).optional(),
  repository_associations: z.array(associationSchema).max(100).optional(),
}).refine(row => new URL(row.canonical_url).hostname === row.domain);
const associationUpdateSchema = z.object({
  association_update: z.literal(true), canonical_url: url, domain: z.string().max(253),
  repository_associations: z.array(associationSchema).min(1).max(100),
}).refine(row => new URL(row.canonical_url).hostname === row.domain);
const batchSchema = z.array(z.union([candidateSchema, associationUpdateSchema])).max(24)
  .refine(rows => rows.reduce((count, row) => count + (row.repository_associations?.length ?? 0), 0) <= 100);

type CandidateRow = z.infer<typeof candidateSchema>;
function recordCandidateRepositories(candidateId: string, row: CandidateRow) {
  if (row.provenance) recordRepositoryAssociation(candidateId, row.provenance);
  for (const association of row.repository_associations ?? []) recordRepositoryAssociation(candidateId, association);
}

export function getCandidateIdentitySnapshot() {
  const rows = openOpsDb().prepare(
    `SELECT d.domain, r.repository_id FROM discovery_candidates d
     LEFT JOIN discovery_candidate_repositories r ON r.candidate_id = d.id
     WHERE d.status != 'quarantined'`,
  ).all();
  return {
    occupied_demo_domains: [...new Set(rows.map(row => String(row.domain)))].sort(),
    known_repository_ids: [...new Set(rows.flatMap(row => row.repository_id ? [String(row.repository_id)] : []))].sort(),
  };
}

function normalizeProvenance(input: z.infer<typeof provenanceSchema> = {}) {
  const provenance: Record<string, unknown> = { ...input, review_only: true, auto_rotation: false };
  if (input.repository_id !== undefined) {
    const evidence = Object.fromEntries(
      ["description", "topics", "stars", "pushed_at", "archived", "source_query"]
        .filter(key => key in input).map(key => [key, input[key]]),
    );
    // Fresh raw values win over retained grouped evidence.
    provenance.github_evidence = { ...input.github_evidence, ...evidence };
  }
  return provenance;
}

function mergeProvenance(previous: z.infer<typeof provenanceSchema>, incoming: z.infer<typeof provenanceSchema>) {
  return normalizeProvenance({ ...previous, ...incoming,
    github_evidence: { ...previous.github_evidence, ...incoming.github_evidence },
  });
}

function recordRepositoryAssociation(candidateId: string, provenance: z.infer<typeof provenanceSchema>) {
  if (provenance.repository_id === undefined) return;
  const db = openOpsDb();
  const repositoryId = String(provenance.repository_id);
  const previous = db.prepare("SELECT provenance_json FROM discovery_candidate_repositories WHERE candidate_id = ? AND repository_id = ?")
    .get(candidateId, repositoryId);
  const merged = mergeProvenance(previous ? JSON.parse(String(previous.provenance_json)) : {}, provenance);
  db.prepare(`INSERT INTO discovery_candidate_repositories(candidate_id,repository_id,provenance_json)
    VALUES(?,?,?) ON CONFLICT(candidate_id,repository_id) DO UPDATE SET provenance_json=excluded.provenance_json`)
    .run(candidateId, repositoryId, JSON.stringify(merged));
}

export function importCandidateBatch(input: unknown) {
  const rows = batchSchema.parse(input);
  const db = openOpsDb();
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    let inserted = 0;
    for (const row of rows) {
      if (row.association_update) {
        const existing = db.prepare(`SELECT id FROM discovery_candidates WHERE canonical_url = ? OR domain = ?
          ORDER BY (status = 'quarantined'), (canonical_url = ?) DESC, id LIMIT 1`)
          .get(row.canonical_url, row.domain, row.canonical_url);
        if (existing) for (const association of row.repository_associations) recordRepositoryAssociation(String(existing.id), association);
        continue;
      }
      const provenance = normalizeProvenance(row.provenance);
      const repositoryId = provenance.repository_id === undefined ? null : String(provenance.repository_id);
      const repositoryIds = [...new Set([...(repositoryId === null ? [] : [repositoryId]),
        ...(row.repository_associations ?? []).map(association => String(association.repository_id))])];
      if (repositoryIds.length && row.source_family !== "runtime-recheck") {
        const placeholders = repositoryIds.map(() => "?").join(",");
        const duplicate = db.prepare(`SELECT d.id, d.canonical_url FROM discovery_candidates d
          LEFT JOIN discovery_candidate_repositories r ON r.candidate_id = d.id
          WHERE d.status != 'quarantined' AND (r.repository_id IN (${placeholders}) OR d.domain = ?)
          ORDER BY CASE WHEN r.repository_id IN (${placeholders}) THEN 0 ELSE 1 END, d.id LIMIT 1`)
          .get(...repositoryIds, row.domain, ...repositoryIds);
        if (duplicate) {
          recordCandidateRepositories(String(duplicate.id), row);
          if (duplicate.canonical_url !== row.canonical_url) continue;
        }
      }
      const existing = db.prepare(`SELECT id, repository_id, provenance_json, screen_json
        FROM discovery_candidates WHERE canonical_url = ?`).get(row.canonical_url);
      if (existing) recordCandidateRepositories(String(existing.id), row);
      if (existing && row.provenance) {
        if (repositoryId !== null && existing.repository_id !== null && existing.repository_id !== repositoryId) continue;
        const merged = mergeProvenance(JSON.parse(String(existing.provenance_json)), row.provenance);
        db.prepare("UPDATE discovery_candidates SET provenance_json = ?, repository_id = COALESCE(?, repository_id) WHERE canonical_url = ?")
          .run(JSON.stringify(merged), repositoryId, row.canonical_url);
      }
      const recheck = row.source_family === "runtime-recheck";
      const previous = existing?.screen_json ? JSON.parse(String(existing.screen_json)) : null;
      const terminal = recheck ? previous?.screened_destination : row.screened_destination;
      const syntheticTitle = row.title_hint === collectorDomainTitle(row.domain);
      const redirected = row.redirected || (terminal && terminal.final_url_sha256 !==
        getQualificationUrlIdentity(row.canonical_url).final_url_sha256);
      const needsBoundedTitle = redirected || syntheticTitle;
      const observed = classifyCollectorTitle(row.title_hint, sanitizeAutoPublishTitle(row.title_hint));
      const bounded = readCollectorTitleSignals(row.title_signals);
      const prior = readCollectorTitleSignals(previous?.title_signals);
      const titleSignals = recheck ? {
        ...prior,
        quality: prior.quality && (syntheticTitle || observed.quality) && (row.title_signals === undefined || bounded.quality),
        denied: prior.denied || observed.denied || bounded.denied,
      } : {
        quality: (syntheticTitle || observed.quality) &&
          (needsBoundedTitle || row.title_signals !== undefined ? bounded.quality : true),
        denied: bounded.denied || observed.denied,
        digest: needsBoundedTitle ? bounded.digest : observed.digest,
      };
      // Keep display text only when it is the screened page's own title: same
      // digest as the collector's bounded title and no redirect in between.
      const verifiedTitle = !recheck && !needsBoundedTitle && titleSignals.quality && !titleSignals.denied &&
        !!bounded.digest && bounded.digest === observed.digest ? sanitizeAutoPublishTitle(row.title_hint) : null;
      const screen = JSON.stringify({
        status: row.availability_status, framing: row.framing ?? classifyLegacyFraming(row.x_frame_options, row.content_security_policy),
        screened_destination: terminal ?? undefined,
        title_signals: titleSignals,
      });
      const result = db.prepare(`INSERT INTO discovery_candidates(
        id,canonical_url,domain,source_id,source_family,source_url,discovered_at,status,
        topic_hint,topics_json,link_text,screen_json,provenance_json,repository_id,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(canonical_url) DO NOTHING`).run(
        row.id, row.canonical_url, row.domain, row.source_id, row.source_family, row.source_url, now,
        row.selection_status === "blocked" ? "quarantined" : "pending_review", row.topics[0] ?? null,
        JSON.stringify(row.topics), verifiedTitle ?? collectorDomainTitle(row.domain), screen, JSON.stringify(provenance), repositoryId, now,
      );
      inserted += Number(result.changes);
      if (!existing) recordCandidateRepositories(row.id, row);
      if (recheck) {
        db.prepare("UPDATE discovery_candidates SET screen_json = ?, updated_at = ?, status = CASE WHEN ? = 'blocked' THEN 'quarantined' ELSE status END WHERE canonical_url = ?")
          .run(screen, now, row.selection_status, row.canonical_url);
      } else if (existing && row.screened_destination && (
        !previous?.screened_destination ||
        (!prior.digest && titleSignals.digest &&
          row.screened_destination.final_url_sha256 === previous.screened_destination.final_url_sha256)
      )) {
        const destination = {
          ...row.screened_destination,
          metadata_denied: row.screened_destination.metadata_denied || previous?.screened_destination?.metadata_denied === true,
        };
        db.prepare(`UPDATE discovery_candidates SET screen_json = json_set(COALESCE(screen_json, '{}'),
          '$.screened_destination', json(?), '$.title_signals', json(?)) WHERE id = ? AND status = 'pending_review'`)
          .run(JSON.stringify(destination), JSON.stringify({ ...titleSignals, denied: prior.denied || titleSignals.denied }), existing.id);
      }
    }
    db.exec("COMMIT");
    return { inserted, existing: rows.length - inserted, pending: rows.filter(row => !row.association_update && row.selection_status === "evaluation_candidate").length, quarantined: rows.filter(row => !row.association_update && row.selection_status === "blocked").length };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
