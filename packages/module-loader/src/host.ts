import type { KeyObject } from "node:crypto";
import { type BlockDefinition, type BlockRegistry, createBlockRegistry } from "@sport-cms/blocks";
import {
  type Database,
  type JsonObject,
  moduleCredentials,
  moduleKv,
  modules as modulesTable,
  writeAudit,
} from "@sport-cms/db";
import type { JsonValue, ModuleContext, ModuleLogger } from "@sport-cms/module-sdk";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { CredentialCipher } from "./credentials.js";
import type { LoadedModule, ModuleLoadFailure, ModuleManifestInfo, ModuleSource } from "./load.js";

/** Where the host writes its messages, and those of the modules (`ctx.logger`). */
export interface HostLogger {
  error(message: string, ...details: unknown[]): void;
  warn?(message: string, ...details: unknown[]): void;
  info?(message: string, ...details: unknown[]): void;
}

export interface ModuleHostOptions {
  /** Migrated database of the instance. */
  readonly db: Database;
  /** Modules accepted by `loadModules`. */
  readonly modules: readonly LoadedModule[];
  /** Modules `loadModules` refused, listed for the back-office. */
  readonly failures?: readonly ModuleLoadFailure[];
  /** Blocks of the core, always in the registry. */
  readonly coreBlocks: readonly BlockDefinition[];
  /** Instance secret (`SECRET_KEY`): the key of the credentials is derived from it. */
  readonly secretKey: KeyObject;
  readonly logger?: HostLogger;
  /** Writes the audit entries (`writeAudit` of `@sport-cms/db`; replaceable in tests). */
  readonly audit?: typeof writeAudit;
}

/** State of the credentials of a module: never their values. */
export interface CredentialsView {
  /** Whether the module declares credentials. */
  readonly declared: boolean;
  /** Whether credentials are saved. */
  readonly configured: boolean;
  /** Fields of the credentials schema, for the form. */
  readonly fields: readonly string[];
  readonly schema: JsonObject | null;
  readonly updatedAt: number | null;
}

/** A module as the admin API shows it. */
export interface ModuleView {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly category: string | null;
  /** `null` for a module known to the database whose code is not loaded. */
  readonly source: ModuleSource | null;
  /**
   * `available`: loaded, can be enabled. `unavailable`: known to the database (its settings and
   * data are kept) but not loaded at this start (removed, refused or incompatible).
   */
  readonly status: "available" | "unavailable";
  readonly enabled: boolean;
  readonly permissions: readonly string[];
  readonly dataProcessing: ModuleManifestInfo["dataProcessing"];
  readonly blocks: readonly { readonly type: string; readonly label: string }[];
  /** Saved settings, as stored. */
  readonly settings: JsonObject;
  /** JSON Schema of the settings (input), for the form of the back-office; `null` without any. */
  readonly settingsSchema: JsonObject | null;
  readonly credentials: CredentialsView;
  /** Why the module could not be loaded at this start, when it was refused. */
  readonly failure: readonly string[] | null;
}

/** Outcome of an operation of the admin API. */
export type ModuleOperation =
  | { readonly ok: true; readonly module: ModuleView }
  | {
      readonly ok: false;
      /**
       * `not_found`: no such module. `unavailable`: its code is not loaded. `invalid`: the input
       * (or the saved settings, to enable) breaks the module's schema. `busy`: another operation
       * on the module is running. `failed`: the module's hook threw, or the write failed.
       */
      readonly reason: "not_found" | "unavailable" | "invalid" | "busy" | "failed";
      /** French message for the person. */
      readonly error: string;
      /** `{ "path.to.value": "message" }` for `invalid`. */
      readonly fields?: Readonly<Record<string, string>>;
    };

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
  readonly code?: string;
  readonly input?: unknown;
}

/** French message of each offending path, the first one winning (as the server's `fieldsOf`). */
function fieldsOf(issues: readonly SchemaIssue[]): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of issues) {
    const path = issue.path.map(String).join(".");
    if (fields[path] !== undefined) {
      continue;
    }
    fields[path] =
      issue.code === "invalid_type"
        ? issue.input === undefined
          ? "Ce champ est requis."
          : "Ce champ est invalide."
        : issue.message;
  }
  return fields;
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value as JSON would store it, when it is a JSON object (dates become strings…). */
function toJsonObject(value: unknown): JsonObject | undefined {
  try {
    const copy: unknown = JSON.parse(JSON.stringify(value));
    return isJsonObject(copy) ? copy : undefined;
  } catch {
    return undefined;
  }
}

/** JSON Schema of the input of a zod schema, or `null` when it cannot be expressed. */
function jsonSchemaOf(schema: z.ZodType | undefined): JsonObject | null {
  if (schema === undefined) {
    return null;
  }
  try {
    const json = toJsonObject(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }));
    return json ?? null;
  } catch {
    return null;
  }
}

function propertiesOf(schema: JsonObject | null): string[] {
  const properties = schema?.properties;
  return isJsonObject(properties) ? Object.keys(properties) : [];
}

/**
 * French messages for the issues a module schema leaves without its own message (zod's French
 * locale, given per parse: the global configuration of zod stays untouched).
 */
const FRENCH = { error: z.locales.fr().localeError };

/** Parses `input` with a module schema, reporting in French. */
function parseWith<Output>(schema: z.ZodType<Output>, input: unknown) {
  return schema.safeParse(input, FRENCH);
}

const BUSY = "Une autre opération est en cours sur ce module : réessayez dans un instant.";

/**
 * The modules of a running instance: their state in the database (`modules`), the block registry
 * the public site renders with (core blocks + blocks of the enabled modules), their settings and
 * encrypted credentials, and the `ctx` each module gets. The admin API (`/api/modules`) calls
 * it; every change is audited.
 *
 * At construction, every loaded module gets its row (disabled at first; the version is updated
 * when a new one is installed). Rows of modules absent at this start are kept, with their data:
 * the module is `unavailable` until its code comes back.
 */
export class ModuleHost {
  readonly #db: Database;
  readonly #modules: ReadonlyMap<string, LoadedModule>;
  readonly #failures: readonly ModuleLoadFailure[];
  readonly #coreBlocks: readonly BlockDefinition[];
  readonly #cipher: CredentialCipher;
  readonly #logger: HostLogger;
  readonly #audit: typeof writeAudit;
  readonly #enabled = new Set<string>();
  readonly #pending = new Set<string>();
  #registry: BlockRegistry | undefined;

  constructor(options: ModuleHostOptions) {
    this.#db = options.db;
    this.#modules = new Map(options.modules.map((module) => [module.manifest.id, module]));
    this.#failures = options.failures ?? [];
    this.#coreBlocks = options.coreBlocks;
    this.#cipher = new CredentialCipher(options.secretKey);
    this.#logger = options.logger ?? console;
    this.#audit = options.audit ?? writeAudit;
    this.#syncRows();
  }

  #syncRows(): void {
    const db = this.#db;
    db.transaction(() => {
      for (const { manifest } of this.#modules.values()) {
        const row = db
          .select({ version: modulesTable.version })
          .from(modulesTable)
          .where(eq(modulesTable.id, manifest.id))
          .get();
        if (row === undefined) {
          db.insert(modulesTable).values({ id: manifest.id, version: manifest.version }).run();
        } else if (row.version !== manifest.version) {
          db.update(modulesTable)
            .set({ version: manifest.version })
            .where(eq(modulesTable.id, manifest.id))
            .run();
          this.#logger.info?.(
            `Module « ${manifest.id} » : version ${row.version} remplacée par ${manifest.version}.`,
          );
        }
      }
    });
    for (const row of db
      .select({ id: modulesTable.id, enabled: modulesTable.enabled })
      .from(modulesTable)
      .all()) {
      if (row.enabled) {
        this.#enabled.add(row.id);
      }
    }
  }

  /**
   * Blocks the public site renders and the pages API validates with: the core blocks, then the
   * blocks of the enabled, loaded modules. The same object until a module is enabled or
   * disabled: `createApp` empties its HTML cache when it changes.
   */
  blocks(): BlockRegistry {
    if (this.#registry === undefined) {
      const moduleBlocks = [...this.#modules.values()]
        .filter((module) => this.#enabled.has(module.manifest.id))
        .flatMap((module) => module.definition.blocks ?? []);
      this.#registry = createBlockRegistry([...this.#coreBlocks, ...moduleBlocks]);
    }
    return this.#registry;
  }

  /** Whether the module is loaded and enabled. */
  isEnabled(id: string): boolean {
    return this.#modules.has(id) && this.#enabled.has(id);
  }

  /** Modules refused at this start. */
  failures(): readonly ModuleLoadFailure[] {
    return this.#failures;
  }

  /** Every module: the loaded ones, then those only known to the database, by identifier. */
  list(): ModuleView[] {
    const rows = this.#db.select().from(modulesTable).all();
    const ids = new Set([...this.#modules.keys(), ...rows.map((row) => row.id)]);
    return [...ids]
      .sort()
      .map((id) => this.view(id))
      .filter((view): view is ModuleView => view !== undefined);
  }

  /** One module, or `undefined` when neither loaded nor known to the database. */
  view(id: string): ModuleView | undefined {
    const row = this.#db.select().from(modulesTable).where(eq(modulesTable.id, id)).get();
    const module = this.#modules.get(id);
    if (row === undefined && module === undefined) {
      return undefined;
    }
    const credentialsRow = this.#db
      .select({ updatedAt: moduleCredentials.updatedAt })
      .from(moduleCredentials)
      .where(eq(moduleCredentials.moduleId, id))
      .get();
    const failure = this.#failures.find((candidate) => candidate.id === id);
    const definition = module?.definition;
    const credentialsSchema = jsonSchemaOf(definition?.credentials);
    return {
      id,
      name: module?.manifest.name ?? id,
      version: module?.manifest.version ?? row?.version ?? "",
      description: module?.manifest.description ?? null,
      category: module?.manifest.category ?? null,
      source: module?.source ?? null,
      status: module === undefined ? "unavailable" : "available",
      enabled: row?.enabled ?? false,
      permissions: module?.manifest.permissions ?? [],
      dataProcessing: module?.manifest.dataProcessing ?? [],
      blocks: (definition?.blocks ?? []).map((block) => ({ type: block.type, label: block.label })),
      settings: row?.settings ?? {},
      settingsSchema: jsonSchemaOf(definition?.settings),
      credentials: {
        declared: definition?.credentials !== undefined,
        configured: credentialsRow !== undefined,
        fields: propertiesOf(credentialsSchema),
        schema: credentialsSchema,
        updatedAt: credentialsRow?.updatedAt.getTime() ?? null,
      },
      failure: module === undefined && failure !== undefined ? failure.reasons : null,
    };
  }

  /** The loaded module, or the reason it cannot be operated. */
  #operable(id: string): LoadedModule | Extract<ModuleOperation, { ok: false }> {
    const module = this.#modules.get(id);
    if (module !== undefined) {
      return module;
    }
    return this.view(id) === undefined
      ? { ok: false, reason: "not_found", error: "Module introuvable." }
      : {
          ok: false,
          reason: "unavailable",
          error:
            "Ce module n'est pas chargé par l'instance : il a été retiré ou refusé au démarrage.",
        };
  }

  #success(id: string): ModuleOperation {
    const module = this.view(id);
    return module === undefined
      ? { ok: false, reason: "not_found", error: "Module introuvable." }
      : { ok: true, module };
  }

  #setEnabled(id: string, enabled: boolean): void {
    if (enabled) {
      this.#enabled.add(id);
    } else {
      this.#enabled.delete(id);
    }
    this.#registry = undefined;
  }

  /**
   * Enables a loaded module: its saved settings must fit its schema, then its `onEnable` hook
   * runs (throwing keeps it disabled), then it is marked enabled and its blocks join the
   * registry. Enabling an enabled module changes nothing.
   */
  async enable(id: string, actorId: string | null): Promise<ModuleOperation> {
    const module = this.#operable(id);
    if (!("definition" in module)) {
      return module;
    }
    if (this.#pending.has(id)) {
      return { ok: false, reason: "busy", error: BUSY };
    }
    if (this.#enabled.has(id)) {
      return this.#success(id);
    }
    this.#pending.add(id);
    try {
      const settingsSchema = module.definition.settings;
      if (settingsSchema !== undefined) {
        const parsed = parseWith(settingsSchema, this.#storedSettings(id));
        if (!parsed.success) {
          return {
            ok: false,
            reason: "invalid",
            error: "Complétez les réglages du module avant de l'activer.",
            fields: fieldsOf(parsed.error.issues),
          };
        }
      }
      try {
        await module.definition.lifecycle?.onEnable?.(this.context(id) as ModuleContext);
      } catch (error) {
        this.#logger.error(`Module « ${id} » : échec de son activation (onEnable)`, error);
        return {
          ok: false,
          reason: "failed",
          error: "Le module a refusé son activation : consultez les journaux du serveur.",
        };
      }
      this.#db.transaction(() => {
        this.#db.update(modulesTable).set({ enabled: true }).where(eq(modulesTable.id, id)).run();
        this.#audit(this.#db, {
          actorId,
          action: "modules.enabled",
          targetType: "module",
          targetId: id,
          // What the owner granted by enabling it: the accesses the module asks for.
          details: {
            version: module.manifest.version,
            permissions: [...module.manifest.permissions],
          },
        });
      });
      this.#setEnabled(id, true);
      return this.#success(id);
    } finally {
      this.#pending.delete(id);
    }
  }

  /**
   * Disables a module, loaded or not (its settings and data are kept): its blocks leave the
   * registry, then its `onDisable` hook runs (an error is only logged). Disabling a disabled
   * module changes nothing.
   */
  async disable(id: string, actorId: string | null): Promise<ModuleOperation> {
    const view = this.view(id);
    if (view === undefined) {
      return { ok: false, reason: "not_found", error: "Module introuvable." };
    }
    if (this.#pending.has(id)) {
      return { ok: false, reason: "busy", error: BUSY };
    }
    if (!view.enabled) {
      return { ok: true, module: view };
    }
    this.#pending.add(id);
    try {
      this.#db.transaction(() => {
        this.#db.update(modulesTable).set({ enabled: false }).where(eq(modulesTable.id, id)).run();
        this.#audit(this.#db, {
          actorId,
          action: "modules.disabled",
          targetType: "module",
          targetId: id,
          details: { version: view.version },
        });
      });
      this.#setEnabled(id, false);
      const module = this.#modules.get(id);
      if (module !== undefined) {
        try {
          await module.definition.lifecycle?.onDisable?.(this.context(id) as ModuleContext);
        } catch (error) {
          this.#logger.error(`Module « ${id} » : échec de sa désactivation (onDisable)`, error);
        }
      }
      return this.#success(id);
    } finally {
      this.#pending.delete(id);
    }
  }

  #storedSettings(id: string): JsonObject {
    const row = this.#db
      .select({ settings: modulesTable.settings })
      .from(modulesTable)
      .where(eq(modulesTable.id, id))
      .get();
    return row?.settings ?? {};
  }

  /**
   * Saves the settings of a loaded module, validated by its `settings` schema; what is stored is
   * the parsed value (defaults applied), as JSON.
   */
  updateSettings(id: string, input: unknown, actorId: string | null): ModuleOperation {
    const module = this.#operable(id);
    if (!("definition" in module)) {
      return module;
    }
    if (this.#pending.has(id)) {
      return { ok: false, reason: "busy", error: BUSY };
    }
    const schema = module.definition.settings;
    if (schema === undefined) {
      return { ok: false, reason: "invalid", error: "Ce module n'a pas de réglages." };
    }
    const parsed = parseWith(schema, input);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        error: "Réglages invalides.",
        fields: fieldsOf(parsed.error.issues),
      };
    }
    const settings = toJsonObject(parsed.data);
    if (settings === undefined) {
      this.#logger.error(`Module « ${id} » : ses réglages ne s'enregistrent pas en JSON.`);
      return { ok: false, reason: "failed", error: "Les réglages n'ont pas pu être enregistrés." };
    }
    this.#db.transaction(() => {
      this.#db.update(modulesTable).set({ settings }).where(eq(modulesTable.id, id)).run();
      this.#audit(this.#db, {
        actorId,
        action: "modules.settings_updated",
        targetType: "module",
        targetId: id,
        details: { keys: Object.keys(settings).sort() },
      });
    });
    return this.#success(id);
  }

  /**
   * Saves the credentials of a loaded module, validated by its `credentials` schema, encrypted
   * (AES-256-GCM). They replace the previous ones; the response never contains them.
   */
  setCredentials(id: string, input: unknown, actorId: string | null): ModuleOperation {
    const module = this.#operable(id);
    if (!("definition" in module)) {
      return module;
    }
    if (this.#pending.has(id)) {
      return { ok: false, reason: "busy", error: BUSY };
    }
    const schema = module.definition.credentials;
    if (schema === undefined) {
      return { ok: false, reason: "invalid", error: "Ce module n'utilise pas d'identifiants." };
    }
    const parsed = parseWith(schema, input);
    if (!parsed.success) {
      return {
        ok: false,
        reason: "invalid",
        error: "Identifiants invalides.",
        fields: fieldsOf(parsed.error.issues),
      };
    }
    const value = toJsonObject(parsed.data);
    if (value === undefined) {
      this.#logger.error(`Module « ${id} » : ses identifiants ne s'enregistrent pas en JSON.`);
      return {
        ok: false,
        reason: "failed",
        error: "Les identifiants n'ont pas pu être enregistrés.",
      };
    }
    const encryptedValue = this.#cipher.encrypt(id, value);
    this.#db.transaction(() => {
      this.#db
        .insert(moduleCredentials)
        .values({ moduleId: id, encryptedValue })
        .onConflictDoUpdate({
          target: moduleCredentials.moduleId,
          set: { encryptedValue, updatedAt: new Date() },
        })
        .run();
      this.#audit(this.#db, {
        actorId,
        action: "modules.credentials_updated",
        targetType: "module",
        targetId: id,
        // The names of the fields only: never a value.
        details: { fields: Object.keys(value).sort() },
      });
    });
    return this.#success(id);
  }

  /** Forgets the credentials of a module (loaded or not). */
  deleteCredentials(id: string, actorId: string | null): ModuleOperation {
    if (this.view(id) === undefined) {
      return { ok: false, reason: "not_found", error: "Module introuvable." };
    }
    if (this.#pending.has(id)) {
      return { ok: false, reason: "busy", error: BUSY };
    }
    this.#db.transaction(() => {
      const deleted = this.#db
        .delete(moduleCredentials)
        .where(eq(moduleCredentials.moduleId, id))
        .returning({ moduleId: moduleCredentials.moduleId })
        .all();
      if (deleted.length > 0) {
        this.#audit(this.#db, {
          actorId,
          action: "modules.credentials_deleted",
          targetType: "module",
          targetId: id,
        });
      }
    });
    return this.#success(id);
  }

  /** The `ctx` of a loaded module: its own settings, credentials and data, and a logger. */
  context(id: string): ModuleContext | undefined {
    const module = this.#modules.get(id);
    if (module === undefined) {
      return undefined;
    }
    const db = this.#db;
    const cipher = this.#cipher;
    const host = this.#logger;
    const prefix = `[module ${id}]`;
    const logger: ModuleLogger = {
      info: (message, ...details) =>
        (host.info ?? console.info).call(host, `${prefix} ${message}`, ...details),
      warn: (message, ...details) =>
        (host.warn ?? host.error).call(host, `${prefix} ${message}`, ...details),
      error: (message, ...details) => host.error(`${prefix} ${message}`, ...details),
    };
    return {
      module: { id, version: module.manifest.version },
      logger,
      settings: async () => {
        const stored = this.#storedSettings(id);
        const schema = module.definition.settings;
        if (schema === undefined) {
          return stored;
        }
        const parsed = parseWith(schema, stored);
        if (!parsed.success) {
          throw new Error(`Les réglages du module « ${id} » ne respectent plus son schéma.`);
        }
        return parsed.data;
      },
      credentials: async () => {
        const row = db
          .select({ encryptedValue: moduleCredentials.encryptedValue })
          .from(moduleCredentials)
          .where(eq(moduleCredentials.moduleId, id))
          .get();
        if (row === undefined) {
          return undefined;
        }
        const value = cipher.decrypt(id, row.encryptedValue);
        const schema = module.definition.credentials;
        const parsed = schema === undefined ? undefined : parseWith(schema, value);
        if (parsed?.success === false || (parsed === undefined && !isJsonObject(value))) {
          throw new Error(
            `Les identifiants du module « ${id} » ne respectent plus son schéma : ` +
              "enregistrez-les à nouveau.",
          );
        }
        return parsed === undefined ? (value as Record<string, unknown>) : parsed.data;
      },
      kv: {
        get: async (key) => {
          const row = db
            .select({ value: moduleKv.value })
            .from(moduleKv)
            .where(and(eq(moduleKv.moduleId, id), eq(moduleKv.key, key)))
            .get();
          return row?.value as JsonValue | undefined;
        },
        set: async (key, value) => {
          db.insert(moduleKv)
            .values({ moduleId: id, key, value })
            .onConflictDoUpdate({
              target: [moduleKv.moduleId, moduleKv.key],
              set: { value, updatedAt: new Date() },
            })
            .run();
        },
        delete: async (key) =>
          db
            .delete(moduleKv)
            .where(and(eq(moduleKv.moduleId, id), eq(moduleKv.key, key)))
            .returning({ key: moduleKv.key })
            .all().length > 0,
      },
    };
  }
}
