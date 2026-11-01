import type { Database } from "./database.js";
import type { JsonObject } from "./json.js";
import { auditLog } from "./schema/audit.js";

/** One entry of the audit log: a sensitive action, appended to {@link auditLog}. */
export interface AuditEntry {
  /**
   * Account behind the action, when known. Leave out for the system, and for an anonymous
   * attempt (a failed sign-in: the person cannot be identified).
   */
  readonly actorId?: string | null;
  /** Action performed, namespaced with dots (e.g. `setup.completed`, `auth.sign_in_failed`). */
  readonly action: string;
  readonly targetType?: string | null;
  readonly targetId?: string | null;
  /** Details of the action, stored as JSON. */
  readonly details?: JsonObject;
}

/**
 * Appends one entry to the audit log and returns the stored row (`created_at` is set by
 * Drizzle, to the current time in milliseconds). This write never fails silently on purpose:
 * if it throws, the action being audited fails with it.
 */
export function writeAudit(db: Database, entry: AuditEntry) {
  return db
    .insert(auditLog)
    .values({
      actorId: entry.actorId ?? null,
      action: entry.action,
      targetType: entry.targetType ?? null,
      targetId: entry.targetId ?? null,
      details: entry.details ?? {},
    })
    .returning()
    .get();
}
