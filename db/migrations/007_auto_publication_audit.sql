CREATE TABLE auto_publication_proposals (
  proposal_id TEXT PRIMARY KEY,
  actor_revision TEXT NOT NULL UNIQUE,
  actor_run_id TEXT NOT NULL,
  actor_run_attempt INTEGER NOT NULL CHECK (actor_run_attempt > 0),
  actor_event TEXT NOT NULL CHECK (actor_event IN ('schedule', 'workflow_dispatch')),
  actor_issued_at INTEGER NOT NULL,
  expected_revision TEXT REFERENCES runtime_catalogue_snapshots(revision),
  policy_version TEXT NOT NULL,
  requested_cap INTEGER NOT NULL CHECK (requested_cap BETWEEN 1 AND 20),
  content_hash TEXT NOT NULL,
  proposed_snapshot_json TEXT NOT NULL,
  decisions_json TEXT NOT NULL,
  counts_json TEXT NOT NULL,
  evidence_json TEXT NOT NULL,
  removals_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'published', 'no_op')),
  created_at TEXT NOT NULL,
  committed_at TEXT,
  result_json TEXT
);

CREATE TABLE auto_publication_audit (
  revision TEXT PRIMARY KEY REFERENCES runtime_catalogue_snapshots(revision),
  prior_revision TEXT REFERENCES runtime_catalogue_snapshots(revision),
  release_revision TEXT NOT NULL REFERENCES runtime_catalogue_snapshots(revision),
  proposal_id TEXT NOT NULL REFERENCES auto_publication_proposals(proposal_id),
  operation TEXT NOT NULL CHECK (operation IN ('publish', 'rollback')),
  additions_json TEXT NOT NULL,
  removals_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  actor_revision TEXT NOT NULL,
  actor_issued_at INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
