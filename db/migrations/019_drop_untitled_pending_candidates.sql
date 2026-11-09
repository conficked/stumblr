-- Pending candidates collected before titles were kept can never be published
-- (title_missing). Removing them lets curated sources rediscover the same URLs
-- with verified titles. Anything tied to a runtime snapshot, runtime health,
-- community suggestions or rechecks is left untouched.
CREATE TEMP TABLE untitled_pending AS
SELECT candidate.id FROM discovery_candidates AS candidate
WHERE candidate.status = 'pending_review'
  AND candidate.source_family NOT IN ('community', 'runtime-recheck')
  AND (candidate.link_text IS NULL OR candidate.link_text = '' OR candidate.link_text = 'Website at ' || candidate.domain)
  AND candidate.id NOT IN (SELECT candidate_id FROM runtime_health_state)
  AND candidate.id NOT IN (SELECT candidate_id FROM runtime_health_transitions)
  AND candidate.id NOT IN (SELECT candidate_id FROM runtime_health_observations)
  AND candidate.id NOT IN (SELECT candidate_id FROM runtime_http_evidence)
  AND candidate.canonical_url NOT IN (
    SELECT json_extract(entry.value, '$.canonicalUrl')
    FROM runtime_catalogue_snapshots AS snapshot, json_each(snapshot.payload_json, '$.entries') AS entry
    WHERE json_valid(snapshot.payload_json)
  );

DELETE FROM candidate_qualification_evidence WHERE candidate_id IN (SELECT id FROM untitled_pending);
DELETE FROM discovery_candidate_repositories WHERE candidate_id IN (SELECT id FROM untitled_pending);
DELETE FROM discovery_candidates WHERE id IN (SELECT id FROM untitled_pending);
DROP TABLE untitled_pending;
