import type { JsonValue } from "./json.js";

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
}
