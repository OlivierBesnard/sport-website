import type { JsonObject, JsonValue } from "./json.js";

/** Messages of a module, written to the server logs with the module identifier. */
export interface ModuleLogger {
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}

/**
 * Key-value storage of a module (`module_kv`), for needs that do not justify tables of their
 * own. Each module only sees its own keys; everything is deleted with the module.
 */
export interface ModuleKv {
  /** Stored value, or `undefined` when the key is absent. */
  get(key: string): Promise<JsonValue | undefined>;
  /** Stores `value` (any JSON value except `null`: delete the key instead). */
  set(key: string, value: Exclude<JsonValue, null>): Promise<void>;
  /** Removes the key; returns whether it was there. */
  delete(key: string): Promise<boolean>;
}

/**
 * What the core gives a module on the server (`ctx`), scoped to that module: it reaches its own
 * settings, credentials and data only.
 */
export interface ModuleContext<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> {
  readonly module: { readonly id: string; readonly version: string };
  readonly logger: ModuleLogger;
  /** Settings of the instance, validated by the module's `settings` schema (defaults applied). */
  settings(): Promise<Settings>;
  /**
   * Credentials towards the external service, decrypted, or `undefined` while none are saved.
   * Never send them to a browser.
   */
  credentials(): Promise<Credentials | undefined>;
  readonly kv: ModuleKv;
  /**
   * Emits an event of the bus, from this module (`source` = its id). Only the types declared in
   * the module's `emits`. With `idempotencyKey`, a second emission with the same key is a no-op
   * (a webhook received twice emits its event once). Returns the event's id, or `undefined`
   * for a duplicate.
   */
  emit(type: string, payload: JsonObject, options?: EmitOptions): Promise<number | undefined>;
}

export interface EmitOptions {
  /** Version of the payload format (1 by default): `payment.received@2`. */
  readonly version?: number;
  readonly idempotencyKey?: string;
}

/** An event of the bus, as a subscriber receives it. */
export interface ModuleEvent {
  /** Position in the outbox: grows with each event, the same at each delivery. */
  readonly id: number;
  readonly type: string;
  readonly version: number;
  /** `core`, or the emitting module. */
  readonly source: string;
  readonly payload: JsonObject;
  readonly createdAt: Date;
  /**
   * Stable key of the event (`<source>:<idempotency key>`, or `event:<id>` without one): an
   * event may be delivered more than once (at least once), and a subscriber with side effects
   * outside the instance (an email, an accounting entry) uses it to do them once.
   */
  readonly key: string;
}

/** A webhook received by the instance (`POST /hooks/<module>/<name>`), stored raw. */
export interface WebhookRequest {
  /** Identifier of the stored webhook (`inbound_webhooks.id`). */
  readonly id: number;
  /** Headers received, names in lowercase (cookies left out). */
  readonly headers: Readonly<Record<string, string>>;
  /** Exact bytes received: what a signature is computed on. */
  readonly body: Uint8Array;
  /** The body read as UTF-8 text. */
  text(): string;
  /** The body read as JSON; throws when it is not. */
  json(): unknown;
  readonly receivedAt: Date;
  /** 1 for the first processing, more on a retry or a replay. */
  readonly attempt: number;
}

/** A run of a scheduled job. */
export interface JobRun {
  /** The tick of the schedule this run is for (one run per tick, even after a restart). */
  readonly scheduledAt: Date;
  /** 1 for the first try, more on a retry. */
  readonly attempt: number;
}
