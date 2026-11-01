import { parseRuntimeConfig, type RuntimeConfig, type RuntimeEnv } from "@sport-cms/core/config";
import { type Database, databasePath, migrate, openDatabase } from "@sport-cms/db";

/** What every entry point of the server starts from. */
export interface Instance {
  readonly config: RuntimeConfig;
  /** Database of the instance, migrated; close it with `db.$client.close()`. */
  readonly db: Database;
}

/**
 * Reads the runtime configuration from `env` (`process.env`, given by the entry point: the only
 * place the configuration is read), then opens the database in `DATA_DIR`, creating it on first
 * start, and applies the pending migrations.
 *
 * @throws {RuntimeConfigError} when a variable of `env` is invalid.
 */
export function openInstance(env: RuntimeEnv): Instance {
  const config = parseRuntimeConfig(env);
  const db = openDatabase(databasePath(config.dataDir));
  try {
    migrate(db);
  } catch (error) {
    db.$client.close();
    throw error;
  }
  return { config, db };
}
