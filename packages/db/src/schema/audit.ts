import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "../json.js";
import { createdAt } from "./columns.js";

/** Sensitive actions, append-only. */
export const auditLog = sqliteTable(
  "audit_log",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /**
     * Account behind the action, `NULL` for the system. No foreign key: the log outlives the
     * accounts it mentions.
     */
    actorId: text("actor_id"),
    /** Action performed (e.g. `page.published`, `module.enabled`). */
    action: text("action").notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    details: text("details", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_log_created_at_idx").on(table.createdAt),
    index("audit_log_target_type_target_id_idx").on(table.targetType, table.targetId),
  ],
);
