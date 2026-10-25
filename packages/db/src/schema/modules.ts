import { integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonObject, StoredJson } from "../json.js";
import { createdAt, updatedAt } from "./columns.js";

/**
 * Modules known to the instance. Deleting a module deletes everything it owns: credentials,
 * key-value data, jobs and received webhooks.
 */
export const modules = sqliteTable("modules", {
  /** Module identifier from its manifest (e.g. `helloasso`). */
  id: text("id").primaryKey(),
  /** Installed version (semver). */
  version: text("version").notNull(),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
  /** Settings validated against the module's schema. */
  settings: text("settings", { mode: "json" }).$type<JsonObject>().notNull().default({}),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Credentials of a module towards its external service: one encrypted value per module,
 * never stored in clear (encryption with `SECRET_KEY`).
 */
export const moduleCredentials = sqliteTable("module_credentials", {
  moduleId: text("module_id")
    .primaryKey()
    .references(() => modules.id, { onDelete: "cascade" }),
  encryptedValue: text("encrypted_value").notNull(),
  updatedAt: updatedAt(),
});

/** Generic key-value storage of a module, for needs that do not justify their own tables. */
export const moduleKv = sqliteTable(
  "module_kv",
  {
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    value: text("value", { mode: "json" }).$type<StoredJson>().notNull(),
    updatedAt: updatedAt(),
  },
  (table) => [primaryKey({ columns: [table.moduleId, table.key] })],
);
