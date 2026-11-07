import { EVENT_TYPE_PATTERN } from "@sport-cms/core";
import type { Database } from "./database.js";
import type { JsonObject } from "./json.js";
import { outboxEvents } from "./schema/events.js";

/** An event of the bus, as its emitter writes it (outbox pattern, PLAN §4.4). */
export interface EventEntry {
  /** `payment.received`… (see `EVENT_TYPE_PATTERN` of `@sport-cms/core`). */
  readonly type: string;
  /** Version of the payload format, 1 by default. */
  readonly version?: number;
  /** `core`, or the identifier of the emitting module. */
  readonly source: string;
  readonly payload: JsonObject;
  /**
   * Makes a second emission of the same event by the same source a no-op (a webhook received
   * twice, a job run again): the event is stored, hence delivered, once.
   */
  readonly idempotencyKey?: string;
}

/**
 * Writes an event to the outbox, to call **inside the transaction** of the data it describes:
 * the event exists if and only if the change does. The dispatcher delivers it afterwards to
 * each subscriber, at least once. Returns the event's id, or `undefined` when an event with the
 * same source and idempotency key already exists.
 *
 * @throws {Error} when the type or the version is invalid (a programming error).
 */
export function emitEvent(db: Database, entry: EventEntry): number | undefined {
  if (!EVENT_TYPE_PATTERN.test(entry.type)) {
    throw new Error(`Type d'événement invalide : « ${entry.type} ».`);
  }
  const version = entry.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {
    throw new Error(`Version d'événement invalide : ${version}.`);
  }
  const row = db
    .insert(outboxEvents)
    .values({
      type: entry.type,
      version,
      source: entry.source,
      payload: entry.payload,
      idempotencyKey: entry.idempotencyKey ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: outboxEvents.id })
    .get();
  return row?.id;
}
