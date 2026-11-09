ALTER TABLE auto_publication_proposals ADD COLUMN rollout_stage TEXT
  CHECK (rollout_stage IN ('report_only', 'limited', 'full'));

CREATE INDEX idx_auto_publication_scheduled_run
  ON auto_publication_proposals (actor_run_id, rollout_stage, status)
  WHERE actor_event = 'schedule';
