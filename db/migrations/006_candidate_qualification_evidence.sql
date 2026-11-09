-- Evidence is separate from the candidate's review and publication status.
CREATE TABLE candidate_qualification_evidence (
  candidate_id TEXT NOT NULL REFERENCES discovery_candidates(id) ON DELETE CASCADE,
  canonical_url TEXT NOT NULL,
  run_id TEXT NOT NULL,
  run_attempt INTEGER NOT NULL CHECK (run_attempt > 0),
  qualifier_version TEXT NOT NULL,
  device TEXT NOT NULL CHECK (device IN ('desktop', 'mobile')),
  observed_at TEXT NOT NULL,
  final_url_origin TEXT,
  final_url_sha256 TEXT,
  document_http_status INTEGER,
  render_result TEXT NOT NULL,
  functionality_result TEXT NOT NULL,
  meaningful_text_length INTEGER NOT NULL CHECK (meaningful_text_length >= 0),
  interaction_attempted INTEGER NOT NULL CHECK (interaction_attempted IN (0, 1)),
  visible_state_changed INTEGER NOT NULL CHECK (visible_state_changed IN (0, 1)),
  network_failure_reasons_json TEXT NOT NULL,
  frame_failure_reasons_json TEXT NOT NULL,
  console_failure_count INTEGER NOT NULL CHECK (console_failure_count BETWEEN 0 AND 20),
  PRIMARY KEY (candidate_id, run_id, run_attempt, qualifier_version, device)
);

CREATE INDEX idx_qualification_evidence_latest
  ON candidate_qualification_evidence (
    candidate_id, device, observed_at DESC, length(run_id) DESC, run_id DESC, run_attempt DESC, qualifier_version DESC
  );
