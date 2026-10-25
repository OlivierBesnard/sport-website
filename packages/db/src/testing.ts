import { type Database, IN_MEMORY, openDatabase } from "./database.js";
import { migrate } from "./migrate.js";

/**
 * Opens a private in-memory database with every migration applied, configured like the
 * server's (foreign keys enforced). Each call returns an independent, empty database; close it
 * with `db.$client.close()`.
 */
export function createTestDatabase(): Database {
  const db = openDatabase(IN_MEMORY);
  try {
    migrate(db);
    return db;
  } catch (error) {
    db.$client.close();
    throw error;
  }
}
