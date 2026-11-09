CREATE TABLE IF NOT EXISTS runtime_catalogue_snapshots (
 revision TEXT PRIMARY KEY, issued_at INTEGER NOT NULL, payload_json TEXT NOT NULL, imported_at TEXT NOT NULL
);
