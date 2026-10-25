import { blob, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import type { JsonObject } from "../json.js";
import { createdAt, timestamp, timestampDefaultNow, updatedAt } from "./columns.js";
import { modules } from "./modules.js";

/**
 * Events written in the same transaction as the data they describe (outbox pattern), then
 * delivered to subscribers. `id` only grows and is never reused: subscribers use it as cursor.
 */
export const outboxEvents = sqliteTable(
  "outbox_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Event name (e.g. `payment.received`). */
    type: text("type").notNull(),
    /** Version of the payload format (`payment.received@1`). */
    version: integer("version").notNull().default(1),
    /** Emitter: `core` or a module identifier. */
    source: text("source").notNull(),
    /** Optional key making a second emission of the same event by the same source a no-op. */
    idempotencyKey: text("idempotency_key"),
    payload: text("payload", { mode: "json" }).$type<JsonObject>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("outbox_events_source_idempotency_key_unique").on(
      table.source,
      table.idempotencyKey,
    ),
  ],
);

/**
 * Delivery cursor of each subscriber: a failing subscriber retries its next event without
 * holding up the others.
 */
export const eventDeliveries = sqliteTable("event_deliveries", {
  /** Module identifier, or name of a core consumer. */
  subscriber: text("subscriber").primaryKey(),
  /** Last event handled successfully (`outbox_events.id`), 0 before the first one. */
  lastEventId: integer("last_event_id").notNull().default(0),
  /** Failed attempts on the event following the cursor. */
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at"),
  lastError: text("last_error"),
  updatedAt: updatedAt(),
});

export const JOB_STATUSES = ["pending", "running", "succeeded", "failed"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

/** Scheduled or on-demand tasks of the core and of the modules. */
export const jobs = sqliteTable(
  "jobs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Owning module, `NULL` for a core task. */
    moduleId: text("module_id").references(() => modules.id, { onDelete: "cascade" }),
    /** Task name within its owner (e.g. `sync-orders`). */
    name: text("name").notNull(),
    /**
     * Optional key guaranteeing a single row per occurrence (e.g. one per cron tick). Unique
     * across the whole table, so it starts with its owner, e.g.
     * `helloasso:sync-orders@2026-10-25T10:30:00.000Z`: the scheduler (E09) builds it. A composite
     * index with `module_id` would not do, since SQLite treats each `NULL` (core tasks) as distinct.
     */
    uniqueKey: text("unique_key"),
    payload: text("payload", { mode: "json" }).$type<JsonObject>().notNull().default({}),
    status: text("status", { enum: JOB_STATUSES }).notNull().default("pending"),
    /** Earliest time the task may run. */
    runAt: timestampDefaultNow("run_at"),
    attempts: integer("attempts").notNull().default(0),
    /** End of the lease of the worker running the task; past it, the task can be taken again. */
    lockedUntil: timestamp("locked_until"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [
    uniqueIndex("jobs_unique_key_unique").on(table.uniqueKey),
    index("jobs_status_run_at_idx").on(table.status, table.runAt),
    index("jobs_module_id_idx").on(table.moduleId),
  ],
);

export const INBOUND_WEBHOOK_STATUSES = ["pending", "processed", "failed"] as const;
export type InboundWebhookStatus = (typeof INBOUND_WEBHOOK_STATUSES)[number];

/** Webhooks received from external services, stored raw so they can be processed again. */
export const inboundWebhooks = sqliteTable(
  "inbound_webhooks",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    moduleId: text("module_id")
      .notNull()
      .references(() => modules.id, { onDelete: "cascade" }),
    /** Webhook name within the module (`/hooks/{module}/{name}`). */
    name: text("name").notNull(),
    headers: text("headers", { mode: "json" }).$type<Record<string, string>>().notNull(),
    /** Exact bytes received, needed to check signatures. */
    body: blob("body", { mode: "buffer" }).notNull(),
    status: text("status", { enum: INBOUND_WEBHOOK_STATUSES }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    lastError: text("last_error"),
    /** Reception date. */
    createdAt: createdAt(),
    processedAt: timestamp("processed_at"),
  },
  (table) => [
    index("inbound_webhooks_status_created_at_idx").on(table.status, table.createdAt),
    index("inbound_webhooks_module_id_created_at_idx").on(table.moduleId, table.createdAt),
  ],
);
