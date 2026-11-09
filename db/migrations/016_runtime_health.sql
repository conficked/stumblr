-- Runtime health is operational evidence, independent of review and publication state.
CREATE TABLE runtime_health_state (
  candidate_id TEXT PRIMARY KEY REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('healthy','suspect','quarantined','recovery_pending')),
  reason_code TEXT NOT NULL,
  failure_streak INTEGER NOT NULL DEFAULT 0,
  recovery_streak INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE TABLE runtime_health_observations (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  run_attempt INTEGER NOT NULL,
  qualifier_version TEXT NOT NULL,
  result_json TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY(candidate_id, run_id, run_attempt, qualifier_version)
);
CREATE TABLE runtime_http_evidence (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  run_attempt INTEGER NOT NULL,
  observed_at TEXT NOT NULL,
  status INTEGER,
  framing_json TEXT NOT NULL,
  PRIMARY KEY(candidate_id, run_id, run_attempt)
);

INSERT INTO runtime_health_state(candidate_id,state,reason_code,failure_streak,recovery_streak,updated_at)
SELECT DISTINCT candidate.id,'healthy','runtime_health_baseline',0,0,CURRENT_TIMESTAMP
FROM discovery_candidates AS candidate
JOIN runtime_catalogue_snapshots AS snapshot
JOIN json_each(json_extract(snapshot.payload_json,'$.entries')) AS entry
  ON json_extract(entry.value,'$.id') = candidate.id
WHERE 1
ON CONFLICT(candidate_id) DO NOTHING;
