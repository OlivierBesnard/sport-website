import { type EventSelector, parseEventSelector, selectsEvent } from "@sport-cms/core";
import { type Database, eventDeliveries, outboxEvents, writeAudit } from "@sport-cms/db";
import type { ModuleEvent } from "@sport-cms/module-sdk";
import { asc, eq, gt, max } from "drizzle-orm";
import type { HostLogger, ModuleHost } from "./host.js";

/**
 * Delivery of the events of the outbox (`outbox_events`) to their subscribers (PLAN §4.4):
 *
 * - each subscriber has its own cursor (`event_deliveries`): the last event it handled. A
 *   failing subscriber retries its next event later, with a growing delay, without holding up the
 *   others; after {@link RetryPolicy.maxAttempts} failures the event is given up for that
 *   subscriber (logged and audited `events.delivery_abandoned`) and the cursor moves on;
 * - at least once: the cursor only moves after the handler succeeded, so a crash in between
 *   delivers the event again (`event.key` lets a subscriber do its side effects once);
 * - in order, for each subscriber; events it does not listen to are stepped over;
 * - a new subscriber starts after the last event written (a module enabled for the first time
 *   does not receive the past); one that stops listening (a module disabled) keeps its cursor
 *   and catches up when it comes back.
 */

/** Something that receives events: an enabled module, or a consumer of the core. */
export interface EventSubscriber {
  /** Key of its cursor: the module's id, or `core:<name>` for the core. */
  readonly name: string;
  accepts(type: string, version: number): boolean;
  handle(event: ModuleEvent): Promise<void>;
}

export interface RetryPolicy {
  /** Delay before the first retry; doubled at each failure. */
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  /** Failures after which the event (or the job) is given up. */
  readonly maxAttempts: number;
}

export const EVENT_RETRY: RetryPolicy = {
  baseDelayMs: 10_000,
  maxDelayMs: 3_600_000,
  maxAttempts: 10,
};

/** Delay before retry number `attempts` (1 after the first failure): exponential, capped. */
export function retryDelay(policy: RetryPolicy, attempts: number): number {
  return Math.min(policy.baseDelayMs * 2 ** Math.max(0, attempts - 1), policy.maxDelayMs);
}

/** Message of an error, short enough for a column and the logs. */
export function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length > 1000 ? `${text.slice(0, 1000)}…` : text;
}

export interface EventDispatcherOptions {
  readonly db: Database;
  readonly logger?: HostLogger;
  readonly now?: () => Date;
  readonly retry?: RetryPolicy;
  /** Events read at once for a subscriber. */
  readonly batchSize?: number;
}

type EventRow = typeof outboxEvents.$inferSelect;

function toModuleEvent(row: EventRow): ModuleEvent {
  return {
    id: row.id,
    type: row.type,
    version: row.version,
    source: row.source,
    payload: row.payload,
    createdAt: row.createdAt,
    key: row.idempotencyKey === null ? `event:${row.id}` : `${row.source}:${row.idempotencyKey}`,
  };
}

export class EventDispatcher {
  readonly #db: Database;
  readonly #logger: HostLogger;
  readonly #now: () => Date;
  readonly #retry: RetryPolicy;
  readonly #batchSize: number;

  constructor(options: EventDispatcherOptions) {
    this.#db = options.db;
    this.#logger = options.logger ?? console;
    this.#now = options.now ?? (() => new Date());
    this.#retry = options.retry ?? EVENT_RETRY;
    this.#batchSize = options.batchSize ?? 100;
  }

  /** The cursor of `name`, created after the last event written when it has none. */
  #cursor(name: string): typeof eventDeliveries.$inferSelect {
    const db = this.#db;
    const existing = db
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, name))
      .get();
    if (existing !== undefined) {
      return existing;
    }
    const last = db
      .select({ id: max(outboxEvents.id) })
      .from(outboxEvents)
      .get();
    db.insert(eventDeliveries)
      .values({ subscriber: name, lastEventId: last?.id ?? 0 })
      .onConflictDoNothing()
      .run();
    const created = db
      .select()
      .from(eventDeliveries)
      .where(eq(eventDeliveries.subscriber, name))
      .get();
    if (created === undefined) {
      throw new Error(`Curseur de « ${name} » introuvable après sa création.`);
    }
    return created;
  }

  #save(name: string, values: Partial<typeof eventDeliveries.$inferInsert>): void {
    this.#db.update(eventDeliveries).set(values).where(eq(eventDeliveries.subscriber, name)).run();
  }

  /**
   * Delivers the pending events to each subscriber, one subscriber after the other; returns the
   * number of deliveries that succeeded. Never throws: a failing handler is retried later.
   */
  async dispatch(subscribers: readonly EventSubscriber[]): Promise<number> {
    let delivered = 0;
    for (const subscriber of subscribers) {
      try {
        delivered += await this.#deliver(subscriber);
      } catch (error) {
        // The database itself failed: the next round tries again.
        this.#logger.error(`Distribution des événements à « ${subscriber.name} »`, error);
      }
    }
    return delivered;
  }

  async #deliver(subscriber: EventSubscriber): Promise<number> {
    const cursor = this.#cursor(subscriber.name);
    const now = this.#now();
    if (cursor.nextAttemptAt !== null && cursor.nextAttemptAt > now) {
      return 0;
    }
    let lastEventId = cursor.lastEventId;
    let attempts = cursor.attempts;
    let delivered = 0;
    for (;;) {
      const events = this.#db
        .select()
        .from(outboxEvents)
        .where(gt(outboxEvents.id, lastEventId))
        .orderBy(asc(outboxEvents.id))
        .limit(this.#batchSize)
        .all();
      if (events.length === 0) {
        break;
      }
      for (const row of events) {
        if (!subscriber.accepts(row.type, row.version)) {
          lastEventId = row.id;
          continue;
        }
        // Stepped-over events are saved before the handler runs: a crash in it restarts here.
        if (lastEventId !== cursor.lastEventId) {
          this.#save(subscriber.name, { lastEventId });
        }
        try {
          await subscriber.handle(toModuleEvent(row));
        } catch (error) {
          attempts += 1;
          if (attempts >= this.#retry.maxAttempts) {
            this.#logger.error(
              `Événement ${row.id} (${row.type}) abandonné pour « ${subscriber.name} » après ${attempts} échecs`,
              error,
            );
            writeAudit(this.#db, {
              action: "events.delivery_abandoned",
              targetType: "event",
              targetId: String(row.id),
              details: { subscriber: subscriber.name, type: row.type, error: errorText(error) },
            });
            lastEventId = row.id;
            attempts = 0;
            this.#save(subscriber.name, {
              lastEventId,
              attempts: 0,
              nextAttemptAt: null,
              lastError: errorText(error),
            });
            continue;
          }
          this.#logger.error(
            `Événement ${row.id} (${row.type}) en échec pour « ${subscriber.name} » (tentative ${attempts})`,
            error,
          );
          this.#save(subscriber.name, {
            lastEventId,
            attempts,
            nextAttemptAt: new Date(this.#now().getTime() + retryDelay(this.#retry, attempts)),
            lastError: errorText(error),
          });
          return delivered;
        }
        delivered += 1;
        lastEventId = row.id;
        attempts = 0;
        this.#save(subscriber.name, {
          lastEventId,
          attempts: 0,
          nextAttemptAt: null,
          lastError: null,
        });
      }
    }
    if (lastEventId !== cursor.lastEventId || cursor.nextAttemptAt !== null) {
      this.#save(subscriber.name, { lastEventId, nextAttemptAt: null });
    }
    return delivered;
  }
}

/**
 * The subscribers of the enabled modules: one per module with an `on`, every handler whose
 * selector matches an event called in turn (a failure retries the event for the module).
 */
export function moduleSubscribers(host: ModuleHost): EventSubscriber[] {
  const subscribers: EventSubscriber[] = [];
  for (const module of host.enabledModules()) {
    const handlers: {
      selector: EventSelector;
      handle: NonNullable<typeof module.definition.on>[string];
    }[] = [];
    for (const [key, handle] of Object.entries(module.definition.on ?? {})) {
      const selector = parseEventSelector(key);
      if (selector !== undefined) {
        handlers.push({ selector, handle });
      }
    }
    if (handlers.length === 0) {
      continue;
    }
    const id = module.manifest.id;
    subscribers.push({
      name: id,
      accepts: (type, version) =>
        handlers.some((handler) => selectsEvent(handler.selector, type, version)),
      handle: async (event) => {
        const ctx = host.context(id);
        if (ctx === undefined) {
          throw new Error(`Module « ${id} » introuvable.`);
        }
        for (const handler of handlers) {
          if (selectsEvent(handler.selector, event.type, event.version)) {
            await handler.handle(event, ctx);
          }
        }
      },
    });
  }
  return subscribers;
}
