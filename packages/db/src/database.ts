import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Sqlite from "better-sqlite3";
import { type BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema/index.js";

/** Typed access to the instance database; the underlying connection is `db.$client`. */
export type Database = BetterSQLite3Database<typeof schema> & { $client: Sqlite.Database };

/** How long a statement waits for a lock held by another connection before failing. */
export const BUSY_TIMEOUT_MS = 5000;

/** Path that opens a private database living in memory, gone once closed. */
export const IN_MEMORY = ":memory:";

/**
 * Opens (and creates if needed, along with its parent directories) the SQLite database at
 * `path`, configured for the server:
 * - WAL journal, so that readers never block the writer (not applicable in memory);
 * - foreign keys enforced (`foreign_keys = ON`, off by default in SQLite);
 * - waits up to {@link BUSY_TIMEOUT_MS} for a lock instead of failing immediately.
 *
 * The schema is not migrated: call `migrate(db)` before use. Close with `db.$client.close()`.
 */
export function openDatabase(path: string): Database {
  if (path !== IN_MEMORY && path !== "") {
    mkdirSync(dirname(path), { recursive: true });
  }
  const client = new Sqlite(path);
  try {
    client.pragma("journal_mode = WAL");
    client.pragma("foreign_keys = ON");
    client.pragma(`busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return drizzle({ client, schema });
  } catch (error) {
    client.close();
    throw error;
  }
}
