import { openOpsDb, type OpsDb } from "@/lib/db/client";
import { noteRuntimeHealthPublication } from "./runtimeHealth";
import { runtimeCatalogueSchema } from "./runtimeSchema";

type Snapshot = ReturnType<typeof runtimeCatalogueSchema.parse>;

const publiclyVisible = `NOT EXISTS (
  SELECT 1 FROM auto_publication_proposals p
  WHERE p.actor_revision = CASE WHEN substr(runtime_catalogue_snapshots.revision, -9) = ':rollback'
      THEN substr(runtime_catalogue_snapshots.revision, 1, length(runtime_catalogue_snapshots.revision) - 9)
      ELSE runtime_catalogue_snapshots.revision END
    AND p.status = 'published'
    AND ((p.actor_revision = runtime_catalogue_snapshots.revision AND p.proof_status IN ('pending', 'unverified', 'rolled_back'))
      OR p.public_check = 'failed'
      OR (p.public_check = 'pending' AND p.public_check_deadline <= unixepoch()))
)`;

const snapshotOrder = "issued_at DESC, (instr(revision, ':') = 0) DESC, rowid DESC";

export function catalogueTransaction<T>(work: (db: OpsDb) => T): T {
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

export function readCatalogueHead(db: OpsDb) {
  const row = db.prepare(`SELECT rowid, revision, issued_at, payload_json FROM runtime_catalogue_snapshots
    WHERE ${publiclyVisible} ORDER BY ${snapshotOrder} LIMIT 1`).get();
  return row ? {
    sequence: Number(row.rowid),
    revision: String(row.revision),
    issuedAt: Number(row.issued_at),
    snapshot: runtimeCatalogueSchema.parse(JSON.parse(String(row.payload_json))),
  } : null;
}

export function readQuarantinedUrls(db: OpsDb) {
  return new Set(db.prepare("SELECT canonical_url FROM discovery_candidates WHERE status = 'quarantined'")
    .all().map(row => String(row.canonical_url)));
}

/** One public projection for the API, proposal, proof, and settlement. */
export function projectRuntimeCatalogue(db: OpsDb, snapshot: Snapshot) {
  const hidden = new Set(db.prepare(`SELECT candidate.canonical_url FROM discovery_candidates AS candidate
    LEFT JOIN runtime_health_state AS health ON health.candidate_id = candidate.id
    WHERE candidate.status = 'quarantined' OR health.state IN ('quarantined','recovery_pending')`)
    .all().map(row => String(row.canonical_url)));
  return {
    visible: { entries: snapshot.entries.filter(entry => !hidden.has(entry.canonicalUrl)) },
    hidden: snapshot.entries.filter(entry => hidden.has(entry.canonicalUrl)),
  };
}

export function insertCatalogueSnapshot(db: OpsDb, snapshot: Snapshot, publisher: { revision: string; issuedAt: number }, at: string) {
  db.prepare("INSERT INTO runtime_catalogue_snapshots(revision, issued_at, payload_json, imported_at) VALUES (?, ?, ?, ?)")
    .run(publisher.revision, publisher.issuedAt, JSON.stringify(snapshot), at);
}

export function installRuntimeCatalogue(input: unknown, publisher: { revision: string; issuedAt: number }) {
  const parsed = runtimeCatalogueSchema.parse(input);
  return catalogueTransaction(db => {
    const latest = db.prepare(`SELECT issued_at FROM runtime_catalogue_snapshots WHERE ${publiclyVisible} ORDER BY ${snapshotOrder} LIMIT 1`).get();
    if (latest && Number(latest.issued_at) > publisher.issuedAt) throw new Error("Stale publication");
    const existing = db.prepare("SELECT payload_json FROM runtime_catalogue_snapshots WHERE revision = ?").get(publisher.revision);
    if (existing && existing.payload_json !== JSON.stringify(parsed)) throw new Error("Revision payload mismatch");
    if (!existing) {
      const now = new Date().toISOString();
      insertCatalogueSnapshot(db, parsed, publisher, now);
      for (const entry of parsed.entries) {
        const prior = db.prepare("SELECT id, status, updated_at FROM discovery_candidates WHERE canonical_url = ?").get(entry.canonicalUrl);
        if (prior?.status === "quarantined" && Date.parse(entry.provenance.reviewedAt) <= Date.parse(String(prior.updated_at))) throw new Error("Quarantine requires a newer explicit review");
        const candidate = db.prepare(`INSERT INTO discovery_candidates(id,canonical_url,domain,source_id,source_family,source_url,discovered_at,status,topic_hint,topics_json,link_text,screen_json,provenance_json,updated_at) VALUES(?,?,?,?,?,?,?,'reviewed_exportable',?,?,?,?,?,?) ON CONFLICT(canonical_url) DO UPDATE SET status='reviewed_exportable', updated_at=excluded.updated_at RETURNING id`).get(prior?.id ?? entry.id,entry.canonicalUrl,entry.domain,"reviewed-publish","reviewed",entry.canonicalUrl,now,entry.topics[0]??null,JSON.stringify(entry.topics),entry.title,JSON.stringify(entry.embedEvidence),JSON.stringify(entry.provenance),now);
        db.prepare("INSERT INTO review_history(entity_type,entity_id,to_status,actor,note,at) VALUES ('runtime_catalogue',?,'evaluation_only',?,?,?)").run(entry.id,entry.provenance.reviewer,`Explicit reviewed publication ${publisher.revision}; no publisher permission asserted`,entry.provenance.reviewedAt);
        noteRuntimeHealthPublication(db, String(candidate!.id), entry.provenance.reviewedAt, publisher.revision, "manual");
      }
    }
    return { revision: publisher.revision, imported: parsed.entries.length };
  });
}

export function readRuntimeCatalogue() {
  try {
    const db = openOpsDb();
    const rows = db.prepare(`SELECT revision, payload_json FROM runtime_catalogue_snapshots WHERE ${publiclyVisible} ORDER BY ${snapshotOrder} LIMIT 10`).all();
    for (const row of rows) {
      try {
        if (typeof row.payload_json !== "string") continue;
        const parsed = runtimeCatalogueSchema.safeParse(JSON.parse(row.payload_json));
        if (parsed.success) {
          return { revision: String(row.revision), entries: projectRuntimeCatalogue(db, parsed.data).visible.entries };
        }
      } catch { /* Try the previous consistent snapshot. */ }
    }
  } catch { /* The bundled catalogue remains usable during storage failures. */ }
  return { revision: null, entries: [] };
}

function getConfirmedRuntimeEntries() {
  try {
    const db = openOpsDb();
    const head = readCatalogueHead(db);
    if (!head) return [];
    const byUrl = db.prepare(`SELECT candidate.id FROM discovery_candidates AS candidate
      JOIN runtime_health_state AS health ON health.candidate_id = candidate.id WHERE candidate.canonical_url = ?`);
    return head.snapshot.entries.flatMap(entry => {
      const candidate = byUrl.get(entry.canonicalUrl);
      return candidate ? [{ id: String(candidate.id), canonicalUrl: entry.canonicalUrl }] : [];
    });
  } catch { return []; }
}

export function getConfirmedRuntimeEntryIds() {
  return new Set(getConfirmedRuntimeEntries().map(entry => entry.id));
}

export function getConfirmedRuntimeHealthTargets(limit = 24, rotate = true) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 24) throw new Error("Invalid runtime health target limit");
  const entries = getConfirmedRuntimeEntries();
  const offset = rotate ? (Math.floor(Date.now() / 21_600_000) * limit) % Math.max(1, entries.length) : 0;
  return [...entries.slice(offset), ...entries.slice(0, offset)].slice(0, limit)
    .map(entry => ({ id: entry.id, canonicalUrl: entry.canonicalUrl }));
}
