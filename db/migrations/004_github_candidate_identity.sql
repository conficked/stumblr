-- Keep raw GitHub evidence in provenance_json; index only canonical identity.
ALTER TABLE discovery_candidates ADD COLUMN repository_id TEXT;
UPDATE discovery_candidates
SET repository_id = CAST(json_extract(provenance_json, '$.repository_id') AS TEXT)
WHERE json_valid(provenance_json) AND json_extract(provenance_json, '$.repository_id') IS NOT NULL;
CREATE INDEX idx_discovery_candidates_repository_id ON discovery_candidates(repository_id);
