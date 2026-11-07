import type { Database } from "@sport-cms/db";
import {
  EventDispatcher,
  type EventSubscriber,
  moduleSubscribers,
  type RetryPolicy,
} from "./events.js";
import type { HostLogger, ModuleHost } from "./host.js";
import { JobScheduler } from "./jobs.js";

/**
 * The integrated scheduler of the instance (PLAN §6.2: no Redis, no separate worker): one loop
 * in the server process that, on every round, delivers the events of the outbox to their
 * subscribers (the core's, then the enabled modules'), plans the ticks of the scheduled jobs and
 * runs the due jobs (ticks and received webhooks).
 *
 * Rounds never overlap. They run every `intervalMs`, and sooner after an event is emitted or a
 * webhook received (`wake()`). A failure anywhere is logged; the loop goes on.
 */

export interface ModuleRuntimeOptions {
  readonly db: Database;
  readonly host: ModuleHost;
  /** Consumers of the core (cache invalidation…), served before the modules. */
  readonly coreSubscribers?: readonly EventSubscriber[];
  readonly logger?: HostLogger;
  readonly now?: () => Date;
  /** Time between two rounds (1 s by default). */
  readonly intervalMs?: number;
  readonly eventRetry?: RetryPolicy;
  readonly jobRetry?: RetryPolicy;
}

export class ModuleRuntime {
  readonly #host: ModuleHost;
  readonly #core: readonly EventSubscriber[];
  readonly #logger: HostLogger;
  readonly #intervalMs: number;
  readonly #dispatcher: EventDispatcher;
  readonly #scheduler: JobScheduler;
  #timer: NodeJS.Timeout | undefined;
  #round: Promise<void> | undefined;
  #again = false;
  #stopped = true;
  #unsubscribe: (() => void) | undefined;

  constructor(options: ModuleRuntimeOptions) {
    const logger = options.logger ?? console;
    this.#host = options.host;
    this.#core = options.coreSubscribers ?? [];
    this.#logger = logger;
    this.#intervalMs = options.intervalMs ?? 1000;
    this.#dispatcher = new EventDispatcher({
      db: options.db,
      logger,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.eventRetry === undefined ? {} : { retry: options.eventRetry }),
    });
    this.#scheduler = new JobScheduler({
      db: options.db,
      host: options.host,
      logger,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.jobRetry === undefined ? {} : { retry: options.jobRetry }),
    });
  }

  /**
   * One round: events, then planning, then jobs (a job's emitted events go out on the next
   * round). Resolves when it is over; never rejects.
   */
  async tick(): Promise<void> {
    try {
      await this.#dispatcher.dispatch([...this.#core, ...moduleSubscribers(this.#host)]);
      this.#scheduler.plan();
      await this.#scheduler.runDue();
    } catch (error) {
      this.#logger.error("Tour du planificateur interrompu", error);
    }
  }

  /** Runs rounds one after the other; one asked while another runs follows it. */
  #run(): void {
    if (this.#round !== undefined) {
      this.#again = true;
      return;
    }
    this.#round = this.tick().finally(() => {
      this.#round = undefined;
      if (this.#again && !this.#stopped) {
        this.#again = false;
        this.#run();
      }
    });
  }

  /** Starts the loop (and runs a first round now). */
  start(): void {
    if (!this.#stopped) {
      return;
    }
    this.#stopped = false;
    this.#unsubscribe = this.#host.onEmit(() => this.wake());
    this.#timer = setInterval(() => this.#run(), this.#intervalMs);
    // The server can exit while the loop waits.
    this.#timer.unref();
    this.#run();
  }

  /** Asks for a round soon: an event was emitted, a webhook received. */
  wake(): void {
    if (!this.#stopped) {
      setImmediate(() => this.#run());
    }
  }

  /** Stops the loop and waits for the round in progress. */
  async stop(): Promise<void> {
    this.#stopped = true;
    this.#again = false;
    clearInterval(this.#timer);
    this.#timer = undefined;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    await this.#round;
  }
}
