import type { BlockDefinition } from "@sport-cms/blocks";
import type { z } from "zod";
import type { JobRun, ModuleContext, ModuleEvent, WebhookRequest } from "./context.js";

/**
 * A processing of personal data the module performs (GDPR register): it feeds the privacy
 * policy generated for the club. Written in French, for the club's members.
 */
export interface DataProcessing {
  /** Why the data is processed (« Encaissement des adhésions »). */
  readonly purpose: string;
  /** Categories of data (« identité », « email »…). */
  readonly data: readonly string[];
  /** Sub-processors receiving the data (« HelloAsso (France) »). */
  readonly processors?: readonly string[];
  /** How long the data is kept (« durée légale comptable (10 ans) »). */
  readonly retention: string;
}

/** Called by the core when the owner enables or disables the module. */
export interface ModuleLifecycle<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Runs before the module is marked enabled: throwing keeps it disabled. */
  onEnable?(ctx: ModuleContext<Settings, Credentials>): void | Promise<void>;
  /** Runs once the module is disabled; an error is logged, the module stays disabled. */
  onDisable?(ctx: ModuleContext<Settings, Credentials>): void | Promise<void>;
}

/**
 * Handles an event of the bus; throwing makes the core deliver it again later. (Declared as a
 * method: a module typed with its own settings stays assignable to a plain `ModuleDefinition`,
 * as with `lifecycle`.)
 */
export type EventHandler<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> = {
  handle(event: ModuleEvent, ctx: ModuleContext<Settings, Credentials>): void | Promise<void>;
}["handle"];

/** Processes a received webhook, after the 200 answer; throwing makes the core retry it. */
export type WebhookHandler<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> = {
  handle(request: WebhookRequest, ctx: ModuleContext<Settings, Credentials>): void | Promise<void>;
}["handle"];

/** A scheduled task of the module. */
export interface JobDefinition<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Identifier within the module, in kebab case (`sync-orders`). */
  readonly id: string;
  /** When it runs, in cron syntax (`*\/30 * * * *`), in the server's time zone. */
  readonly schedule: string;
  /** Runs one tick; throwing makes the core retry it (a few times, with a growing delay). */
  run(ctx: ModuleContext<Settings, Credentials>, run: JobRun): void | Promise<void>;
}

/**
 * Definition of a module: its manifest (identity, compatibility, permissions, GDPR declaration)
 * and its extension points. The default export of a module's server entry.
 */
export interface ModuleDefinition<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
> {
  /** Unique identifier, in kebab case (`helloasso`); prefixes the module's block types. */
  readonly id: string;
  /** Name shown in the back-office, in French. */
  readonly name: string;
  /** Version of the module (semver). */
  readonly version: string;
  readonly description?: string;
  /** Category of the catalog (« paiements », « communication »…). */
  readonly category?: string;
  /**
   * Versions of the CMS the module runs on, as a semver range (`^1.2.0`). Required in the
   * `manifest.json` of a module installed in `DATA_DIR/modules`; optional for the official
   * modules, which ship with the CMS.
   */
  readonly engines?: { readonly cms: string };
  /**
   * Accesses the module asks for (`members:write`, `payments.read`…), shown to the owner who
   * enables it.
   */
  readonly permissions?: readonly string[];
  readonly dataProcessing?: readonly DataProcessing[];
  /** Settings of the module (zod schema of a JSON object): the back-office form follows it. */
  readonly settings?: z.ZodType<Settings>;
  /** Credentials towards the external service (zod schema), stored encrypted. */
  readonly credentials?: z.ZodType<Credentials>;
  /** Blocks added to the pages; their types start with `<id>.` (`helloasso.membership-button`). */
  readonly blocks?: readonly BlockDefinition[];
  /** Types of the events the module emits (`ctx.emit`); any other type is refused. */
  readonly emits?: readonly string[];
  /**
   * Subscriptions to the events of the bus, by type (`payment.received`: every version) or
   * type and version (`payment.received@1`). Each event is delivered at least once, in order;
   * a failure is retried with a growing delay without holding up the other subscribers.
   */
  readonly on?: Readonly<Record<string, EventHandler<Settings, Credentials>>>;
  /** Scheduled tasks; they run while the module is enabled. */
  readonly jobs?: readonly JobDefinition<Settings, Credentials>[];
  /**
   * Incoming webhooks, by name: `POST /hooks/<id>/<name>` stores the request and answers 200,
   * then the handler processes it (retried on failure, replayable from the back-office).
   */
  readonly webhooks?: Readonly<Record<string, WebhookHandler<Settings, Credentials>>>;
  readonly lifecycle?: ModuleLifecycle<Settings, Credentials>;
}

/** Declares a module, keeping the types of its settings and credentials. */
export function defineModule<
  Settings extends Record<string, unknown> = Record<string, unknown>,
  Credentials extends Record<string, unknown> = Record<string, unknown>,
>(definition: ModuleDefinition<Settings, Credentials>): ModuleDefinition<Settings, Credentials> {
  return definition;
}
