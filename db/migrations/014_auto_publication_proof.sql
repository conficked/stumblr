ALTER TABLE auto_publication_proposals ADD COLUMN proof_status TEXT NOT NULL DEFAULT 'legacy'
  CHECK (proof_status IN ('legacy', 'pending', 'verified', 'unverified', 'rolled_back'));

ALTER TABLE auto_publication_proposals ADD COLUMN proof_attempt INTEGER CHECK (proof_attempt > 0);

CREATE INDEX idx_auto_publication_committed_run
  ON auto_publication_proposals (actor_event, actor_run_id) WHERE status = 'published';
