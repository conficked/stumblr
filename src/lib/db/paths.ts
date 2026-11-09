import path from "node:path";

/** Local ops DB path. Hosted shared durability requires a separate approved deployment. */
export function resolveDbPath(override?: string): string {
  if (override) return path.resolve(override);
  if (process.env.STUMBLR_DB_PATH) return path.resolve(process.env.STUMBLR_DB_PATH);
  return path.resolve(process.cwd(), "data/stumblr-ops.sqlite");
}

export function migrationsDir(): string {
  return path.resolve(process.cwd(), "db/migrations");
}
