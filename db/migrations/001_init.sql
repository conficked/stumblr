-- Stumblr private ops DB (SQLite dialect; keep D1-compatible: no partial indexes requiring unsupported features)
-- Local proof != hosted shared deployment.

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_suggestions (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending_review',
  source TEXT NOT NULL DEFAULT 'community',
  title TEXT,
  note TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  submitter_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_community_suggestions_domain
  ON community_suggestions(domain);
CREATE INDEX IF NOT EXISTS idx_community_suggestions_status
  ON community_suggestions(status);

CREATE TABLE IF NOT EXISTS discovery_candidates (
  id TEXT PRIMARY KEY,
  canonical_url TEXT NOT NULL UNIQUE,
  domain TEXT NOT NULL,
  source_id TEXT NOT NULL,
  source_family TEXT NOT NULL,
  source_url TEXT NOT NULL,
  discovered_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'discovered',
  topic_hint TEXT,
  topics_json TEXT NOT NULL DEFAULT '[]',
  link_text TEXT,
  screen_json TEXT,
  provenance_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_discovery_candidates_domain
  ON discovery_candidates(domain);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_status
  ON discovery_candidates(status);
CREATE INDEX IF NOT EXISTS idx_discovery_candidates_family
  ON discovery_candidates(source_family);

CREATE TABLE IF NOT EXISTS discovery_runs (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  stats_json TEXT NOT NULL DEFAULT '{}',
  error TEXT,
  lease_owner TEXT,
  lease_until TEXT
);

CREATE TABLE IF NOT EXISTS discovery_run_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (run_id) REFERENCES discovery_runs(id)
);

CREATE INDEX IF NOT EXISTS idx_discovery_run_events_run
  ON discovery_run_events(run_id);

CREATE TABLE IF NOT EXISTS review_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'system',
  note TEXT,
  at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_review_history_entity
  ON review_history(entity_type, entity_id);
