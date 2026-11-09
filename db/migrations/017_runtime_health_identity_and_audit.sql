-- Queue IDs own health; reviewed manifest IDs may differ for the same URL.
INSERT INTO runtime_health_state(candidate_id,state,reason_code,failure_streak,recovery_streak,updated_at)
SELECT DISTINCT candidate.id,'healthy','runtime_health_baseline',0,0,candidate.updated_at
FROM discovery_candidates AS candidate
JOIN runtime_catalogue_snapshots AS snapshot
JOIN json_each(CASE WHEN json_valid(snapshot.payload_json) THEN snapshot.payload_json ELSE '{}' END, '$.entries') AS entry
  ON json_extract(CASE WHEN entry.type = 'object' THEN entry.value ELSE '{}' END,'$.canonicalUrl') = candidate.canonical_url
WHERE candidate.status = 'reviewed_exportable'
ON CONFLICT(candidate_id) DO NOTHING;

CREATE TABLE runtime_health_transitions (
  id INTEGER PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  from_state TEXT NOT NULL CHECK (from_state IN ('healthy','suspect','quarantined','recovery_pending')),
  to_state TEXT NOT NULL CHECK (to_state IN ('healthy','suspect','quarantined','recovery_pending')),
  reason_code TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('browser','manual','automatic')),
  observed_at TEXT NOT NULL,
  run_id TEXT,
  run_attempt INTEGER,
  qualifier_version TEXT,
  revision TEXT
);

CREATE INDEX IF NOT EXISTS runtime_health_observation_latest
  ON runtime_health_observations(candidate_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS runtime_http_evidence_latest
  ON runtime_http_evidence(candidate_id, observed_at DESC);

-- The public proposal hash excludes hidden entries. Independently bind the
-- complete stored snapshot so proof and settlement also protect recovery data.
ALTER TABLE auto_publication_proposals ADD COLUMN durable_content_hash TEXT;
