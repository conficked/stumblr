-- A destination can be supplied by several repositories. Keep each identity and its raw evidence.
CREATE TABLE discovery_candidate_repositories (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  repository_id TEXT NOT NULL,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  PRIMARY KEY (candidate_id, repository_id)
);
CREATE INDEX idx_candidate_repositories_repository_id
  ON discovery_candidate_repositories(repository_id);
INSERT INTO discovery_candidate_repositories(candidate_id, repository_id, provenance_json)
SELECT id, repository_id, provenance_json FROM discovery_candidates WHERE repository_id IS NOT NULL;
