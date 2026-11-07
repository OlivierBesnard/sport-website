import { type Database, inboundWebhooks, jobs, writeAudit } from "@sport-cms/db";
import { type CronSchedule, nextOccurrence, parseCron } from "@sport-cms/module-sdk";
import { and, asc, desc, eq, inArray, lt, lte, or, sql } from "drizzle-orm";
import { errorText, type RetryPolicy, retryDelay } from "./events.js";
import type { HostLogger, ModuleHost } from "./host.js";
import type { LoadedModule } from "./load.js";

/**
 * Jobs of the modules (`jobs`), run by the integrated scheduler (PLAN §6.7):
 *
 * - **scheduled** (`jobs` of a module, cron): one row per tick, its `unique_key` naming the
 *   module, the job and the tick, so a tick is planned once even if the server restarts. After a
 *   stop, the first tick missed is run once (catch-up), then the schedule goes on from now. A
 *   job seen for the first time waits for its next tick;
 * - **webhooks** received (`POST /hooks/<module>/<name>`): one row per processing, the body
 *   stored raw in `inbound_webhooks`; a replay adds a row.
 *
 * A row is taken with a lease (`locked_until`): a server stopped during a run takes it again once
 * the lease is over. A failure is retried with a growing delay, up to
 * {@link RetryPolicy.maxAttempts} tries, then the row is `failed`. Only the rows of enabled
 * modules run: those of a disabled module wait for it.
 */

export const JOB_RETRY: RetryPolicy = {
  baseDelayMs: 30_000,
  maxDelayMs: 3_600_000,
  maxAttempts: 3,
};

/** How long a run may take before another round takes the job again. */
export const JOB_LEASE_MS = 15 * 60_000;

/** Prefix of the name of a webhook's processing jobs (`webhook:notifications`). */
export const WEBHOOK_JOB_PREFIX = "webhook:";

type JobRow = typeof jobs.$inferSelect;

export interface JobSchedulerOptions {
  readonly db: Database;
  readonly host: ModuleHost;
  readonly logger?: HostLogger;
  readonly now?: () => Date;
  readonly retry?: RetryPolicy;
  readonly leaseMs?: number;
  /** Jobs run per round, at most. */
  readonly batchSize?: number;
}

/** Key of a tick of a job: unique across the table (`exemple:sync@2026-11-07T10:30:00.000Z`). */
export function tickKey(moduleId: string, jobId: string, tick: Date): string {
  return `${moduleId}:${jobId}@${tick.toISOString()}`;
}

export class JobScheduler {
  readonly #db: Database;
  readonly #host: ModuleHost;
  readonly #logger: HostLogger;
  readonly #now: () => Date;
  readonly #retry: RetryPolicy;
  readonly #leaseMs: number;
  readonly #batchSize: number;
  /** Next tick of each scheduled job (`module:job`), with its parsed schedule. */
  readonly #next = new Map<string, { schedule: CronSchedule; next: Date | undefined }>();

  constructor(options: JobSchedulerOptions) {
    this.#db = options.db;
    this.#host = options.host;
    this.#logger = options.logger ?? console;
    this.#now = options.now ?? (() => new Date());
    this.#retry = options.retry ?? JOB_RETRY;
    this.#leaseMs = options.leaseMs ?? JOB_LEASE_MS;
    this.#batchSize = options.batchSize ?? 20;
  }

  #insertTick(moduleId: string, jobId: string, tick: Date): void {
    this.#db
      .insert(jobs)
      .values({
        moduleId,
        name: jobId,
        uniqueKey: tickKey(moduleId, jobId, tick),
        payload: { kind: "cron", scheduledAt: tick.toISOString() },
        runAt: tick,
      })
      .onConflictDoNothing()
      .run();
  }

  /** Plans the ticks that are due for the jobs of the enabled modules. */
  plan(): void {
    const now = this.#now();
    for (const module of this.#host.enabledModules()) {
      const moduleId = module.manifest.id;
      for (const job of module.definition.jobs ?? []) {
        const key = `${moduleId}:${job.id}`;
        let state = this.#next.get(key);
        if (state === undefined || state.schedule.expression !== job.schedule) {
          const parsed = parseCron(job.schedule);
          if (!parsed.ok) {
            // Checked when the module was loaded: only a definition changed meanwhile lands here.
            this.#logger.error(`Tâche « ${key} » ignorée : ${parsed.error}`);
            continue;
          }
          const last = this.#db
            .select({ runAt: jobs.runAt })
            .from(jobs)
            .where(and(eq(jobs.moduleId, moduleId), eq(jobs.name, job.id)))
            .orderBy(desc(jobs.runAt))
            .limit(1)
            .get();
          if (last !== undefined) {
            // Catch-up: the first tick missed while the server was stopped runs once.
            const missed = nextOccurrence(parsed.schedule, last.runAt);
            if (missed !== undefined && missed <= now) {
              this.#insertTick(moduleId, job.id, missed);
            }
          }
          state = { schedule: parsed.schedule, next: nextOccurrence(parsed.schedule, now) };
          this.#next.set(key, state);
        }
        if (state.next !== undefined && state.next <= now) {
          this.#insertTick(moduleId, job.id, state.next);
          state.next = nextOccurrence(state.schedule, now);
        }
      }
    }
  }

  /** Takes the row if it is still free (pending, or running with an expired lease). */
  #claim(row: JobRow, now: Date): JobRow | undefined {
    return this.#db
      .update(jobs)
      .set({
        status: "running",
        attempts: row.attempts + 1,
        lockedUntil: new Date(now.getTime() + this.#leaseMs),
      })
      .where(
        and(
          eq(jobs.id, row.id),
          or(
            eq(jobs.status, "pending"),
            and(eq(jobs.status, "running"), lt(jobs.lockedUntil, now)),
          ),
        ),
      )
      .returning()
      .get();
  }

  /** Runs the due jobs of the enabled modules; returns how many ran (succeeded or not). */
  async runDue(): Promise<number> {
    const enabled = this.#host.enabledModules();
    if (enabled.length === 0) {
      return 0;
    }
    const byId = new Map(enabled.map((module) => [module.manifest.id, module]));
    const now = this.#now();
    const due = this.#db
      .select()
      .from(jobs)
      .where(
        and(
          inArray(jobs.moduleId, [...byId.keys()]),
          or(
            and(eq(jobs.status, "pending"), lte(jobs.runAt, now)),
            and(eq(jobs.status, "running"), lt(jobs.lockedUntil, now)),
          ),
        ),
      )
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(this.#batchSize)
      .all();
    let ran = 0;
    for (const row of due) {
      const module = row.moduleId === null ? undefined : byId.get(row.moduleId);
      if (module === undefined) {
        continue;
      }
      const claimed = this.#claim(row, now);
      if (claimed === undefined) {
        continue;
      }
      ran += 1;
      await this.#run(module, claimed);
    }
    return ran;
  }

  async #run(module: LoadedModule, row: JobRow): Promise<void> {
    const moduleId = module.manifest.id;
    const ctx = this.#host.context(moduleId);
    const webhook = row.name.startsWith(WEBHOOK_JOB_PREFIX);
    try {
      if (ctx === undefined) {
        throw new Error(`Module « ${moduleId} » introuvable.`);
      }
      if (webhook) {
        await this.#processWebhook(module, row, ctx);
      } else {
        const job = (module.definition.jobs ?? []).find((candidate) => candidate.id === row.name);
        if (job === undefined) {
          throw new Error(`Le module ne déclare plus la tâche « ${row.name} ».`);
        }
        await job.run(ctx, { scheduledAt: row.runAt, attempt: row.attempts });
      }
      this.#db
        .update(jobs)
        .set({ status: "succeeded", lockedUntil: null, lastError: null, finishedAt: this.#now() })
        .where(eq(jobs.id, row.id))
        .run();
    } catch (error) {
      const final = row.attempts >= this.#retry.maxAttempts;
      this.#logger.error(
        `Tâche « ${moduleId}:${row.name} » en échec (tentative ${row.attempts}${final ? ", abandonnée" : ""})`,
        error,
      );
      const now = this.#now();
      this.#db
        .update(jobs)
        .set(
          final
            ? { status: "failed", lockedUntil: null, lastError: errorText(error), finishedAt: now }
            : {
                status: "pending",
                lockedUntil: null,
                lastError: errorText(error),
                runAt: new Date(now.getTime() + retryDelay(this.#retry, row.attempts)),
              },
        )
        .where(eq(jobs.id, row.id))
        .run();
      if (webhook) {
        this.#settleWebhook(row, final ? "failed" : "pending", errorText(error));
      }
    }
  }

  #webhookId(row: JobRow): number {
    const id = (row.payload as { webhookId?: unknown }).webhookId;
    if (typeof id !== "number") {
      throw new Error("Tâche de webhook sans webhook.");
    }
    return id;
  }

  #settleWebhook(row: JobRow, status: "processed" | "pending" | "failed", error: string | null) {
    let webhookId: number;
    try {
      webhookId = this.#webhookId(row);
    } catch {
      return;
    }
    this.#db
      .update(inboundWebhooks)
      .set({
        status,
        lastError: error,
        ...(status === "processed" ? { processedAt: this.#now() } : {}),
      })
      .where(eq(inboundWebhooks.id, webhookId))
      .run();
  }

  async #processWebhook(
    module: LoadedModule,
    row: JobRow,
    ctx: NonNullable<ReturnType<ModuleHost["context"]>>,
  ): Promise<void> {
    const name = row.name.slice(WEBHOOK_JOB_PREFIX.length);
    const handler = module.definition.webhooks?.[name];
    if (handler === undefined) {
      throw new Error(`Le module ne déclare plus le webhook « ${name} ».`);
    }
    const webhookId = this.#webhookId(row);
    const stored = this.#db
      .update(inboundWebhooks)
      .set({ attempts: incrementAttempts() })
      .where(eq(inboundWebhooks.id, webhookId))
      .returning()
      .get();
    if (stored === undefined) {
      throw new Error(`Webhook ${webhookId} introuvable.`);
    }
    const body = new Uint8Array(stored.body);
    await handler(
      {
        id: stored.id,
        headers: stored.headers,
        body,
        text: () => new TextDecoder().decode(body),
        json: () => JSON.parse(new TextDecoder().decode(body)) as unknown,
        receivedAt: stored.createdAt,
        attempt: stored.attempts,
      },
      ctx,
    );
    this.#settleWebhook(row, "processed", null);
  }
}

/** `attempts + 1`, in SQL: two processings of one webhook never count the same attempt. */
function incrementAttempts() {
  return sql`${inboundWebhooks.attempts} + 1`;
}

/** Headers never stored with a webhook: they authenticate a browser, not a service. */
const DROPPED_HEADERS = new Set(["cookie", "authorization", "proxy-authorization"]);

/** The headers of a request, lowercase, without the ones a service never needs. */
export function storableHeaders(headers: Headers): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [name, value] of headers) {
    const lower = name.toLowerCase();
    if (!DROPPED_HEADERS.has(lower)) {
      stored[lower] = value;
    }
  }
  return stored;
}

export interface ReceivedWebhook {
  readonly moduleId: string;
  readonly name: string;
  readonly headers: Record<string, string>;
  readonly body: Uint8Array;
}

/**
 * Stores a received webhook raw and plans its processing, in one transaction; returns its id.
 * The caller answers 200 right after: the module's handler runs in a later round.
 */
export function receiveWebhook(
  db: Database,
  webhook: ReceivedWebhook,
  now: Date = new Date(),
): number {
  return db.transaction(() => {
    const row = db
      .insert(inboundWebhooks)
      .values({
        moduleId: webhook.moduleId,
        name: webhook.name,
        headers: webhook.headers,
        body: Buffer.from(webhook.body),
        createdAt: now,
      })
      .returning({ id: inboundWebhooks.id })
      .get();
    db.insert(jobs)
      .values({
        moduleId: webhook.moduleId,
        name: `${WEBHOOK_JOB_PREFIX}${webhook.name}`,
        payload: { kind: "webhook", webhookId: row.id },
        runAt: now,
      })
      .run();
    return row.id;
  });
}

/**
 * Processes a stored webhook again (from the back-office): its status goes back to `pending` and
 * a new processing is planned; audited `webhooks.replayed`. Returns `false` for an unknown id.
 */
export function replayWebhook(
  db: Database,
  id: number,
  actorId: string | null,
  now: Date = new Date(),
): boolean {
  return db.transaction(() => {
    const webhook = db
      .update(inboundWebhooks)
      .set({ status: "pending", lastError: null, processedAt: null })
      .where(eq(inboundWebhooks.id, id))
      .returning({ moduleId: inboundWebhooks.moduleId, name: inboundWebhooks.name })
      .get();
    if (webhook === undefined) {
      return false;
    }
    db.insert(jobs)
      .values({
        moduleId: webhook.moduleId,
        name: `${WEBHOOK_JOB_PREFIX}${webhook.name}`,
        payload: { kind: "webhook", webhookId: id },
        runAt: now,
      })
      .run();
    writeAudit(db, {
      actorId,
      action: "webhooks.replayed",
      targetType: "webhook",
      targetId: String(id),
      details: { module: webhook.moduleId, name: webhook.name },
    });
    return true;
  });
}
