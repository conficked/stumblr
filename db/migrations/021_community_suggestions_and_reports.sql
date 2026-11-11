-- Suggestions now enter the queue through the collector, which screens them like
-- any other source. The old trigger inserted unscreened stubs that could never
-- qualify and that hid the URL from the collector's known-URL dedupe.
DROP TRIGGER IF EXISTS community_suggestion_review_queue;

CREATE TEMP TABLE unscreened_community AS
SELECT id FROM discovery_candidates
WHERE source_family = 'community' AND status = 'pending_review' AND screen_json IS NULL;

DELETE FROM candidate_qualification_evidence WHERE candidate_id IN (SELECT id FROM unscreened_community);
DELETE FROM discovery_candidate_repositories WHERE candidate_id IN (SELECT id FROM unscreened_community);
DELETE FROM discovery_candidates WHERE id IN (SELECT id FROM unscreened_community);
DROP TABLE unscreened_community;

CREATE TABLE IF NOT EXISTS community_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('broken', 'report')),
  note TEXT,
  submitter_hash TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  rechecked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_community_reports_pending ON community_reports(kind, rechecked_at, canonical_url);
