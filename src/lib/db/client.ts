import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrationsDir, resolveDbPath } from "./paths";

export type OpsDb = DatabaseSync;

let singleton: OpsDb | null = null;
let singletonPath: string | null = null;

export function openOpsDb(dbPath?: string): OpsDb {
  const resolved = resolveDbPath(dbPath);
  if (singleton && singletonPath === resolved) return singleton;

  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  const db = new DatabaseSync(resolved);
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  try {
    migrateOpsDb(db);
  } catch (error) {
    db.close();
    throw error;
  }

  singleton = db;
  singletonPath = resolved;
  return db;
}

/** Test helper: close singleton so a new path can be opened. */
export function closeOpsDbForTests(): void {
  if (singleton) {
    try {
      singleton.close();
    } catch {
      // ignore
    }
  }
  singleton = null;
  singletonPath = null;
}

export function migrateOpsDb(db: OpsDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL
    );
  `);

  const dir = migrationsDir();
  if (!fs.existsSync(dir)) return;

  const applied = new Set(
    (
      db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>
    ).map((row) => row.name),
  );

  const files = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const insert = db.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), "utf-8");
    db.exec("BEGIN IMMEDIATE;");
    try {
      db.exec(sql);
      insert.run(file, new Date().toISOString());
      db.exec("COMMIT;");
    } catch (error) {
      db.exec("ROLLBACK;");
      throw error;
    }
  }
  // Physical redaction requires a rewritten main file and a truncated WAL.
  // Keep the marker if a reader prevents the checkpoint, so reopening retries.
  const pendingTable = db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'ops_privacy_scrub_pending'").get();
  if (pendingTable && db.prepare("SELECT 1 FROM ops_privacy_scrub_pending").get()) {
    db.exec("VACUUM");
    const checkpoint = db.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get();
    if (!checkpoint || checkpoint.busy !== 0) throw new Error("Privacy scrub WAL checkpoint could not complete");
    db.exec("DELETE FROM ops_privacy_scrub_pending");
  }
}
