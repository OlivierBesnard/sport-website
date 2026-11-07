import { join } from "node:path";
import { coreBlocks } from "@sport-cms/blocks";
import type { RuntimeConfig, RuntimeEnv } from "@sport-cms/core/config";
import type { Database } from "@sport-cms/db";
import {
  type EventSubscriber,
  type HostLogger,
  loadModules,
  ModuleHost,
  ModuleRuntime,
} from "@sport-cms/module-loader";
import type { Hono } from "hono";
import { adminBuildDirectory, adminRoutes } from "./admin.js";
import { createApp } from "./app.js";
import { createAuth } from "./auth/create-auth.js";
import { authRoutes } from "./auth/routes.js";
import { hooksRoutes } from "./hooks.js";
import { HtmlCache } from "./html-cache.js";
import { openInstance } from "./instance.js";
import { type ModuleClientFiles, moduleClientFiles, moduleClientRoutes } from "./module-clients.js";
import { modulesApiRoutes } from "./modules-api.js";
import { navigationApiRoutes } from "./navigation-api.js";
import { officialModuleClients, officialModules } from "./official-modules.js";
import { pagesApiRoutes } from "./pages-api.js";
import { webhooksApiRoutes } from "./webhooks-api.js";

/** Directory of `DATA_DIR` holding the installed modules, one directory each. */
export const MODULES_DIRECTORY = "modules";

/** The instance cannot start; the message, in French, says what to do. */
export class StartupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StartupError";
  }
}

export interface BootOptions {
  /** Official modules (those of `modules/*` by default). */
  readonly officialModules?: readonly unknown[];
  /** Client entries of the official modules, by id (those of `modules/*` by default). */
  readonly officialModuleClients?: Readonly<Record<string, ModuleClientFiles>>;
  /** Version of the CMS checked against `engines.cms` (`CMS_VERSION` by default). */
  readonly cmsVersion?: string;
  /** Where the server reports errors (`console` by default). */
  readonly logger?: HostLogger;
  /** Directory of the back-office build (`apps/admin/dist` by default). */
  readonly adminDirectory?: string;
}

/** A started instance, ready to serve; `close()` releases the database. */
export interface BootedInstance {
  readonly config: RuntimeConfig;
  readonly db: Database;
  readonly app: Hono;
  readonly htmlCache: HtmlCache;
  readonly modules: ModuleHost;
  /**
   * The scheduler (events, jobs, webhooks): not started by `bootInstance` (the tests drive it
   * with `tick()`); the entry point starts it, and stops it before `close()`.
   */
  readonly runtime: ModuleRuntime;
  close(): void;
}

/**
 * Consumer of the core: forgets the cached pages whose blocks depend on the event
 * (`dependsOn`). The cache lives in memory: after a restart, the events replayed find it empty.
 */
export function htmlCacheSubscriber(htmlCache: HtmlCache): EventSubscriber {
  return {
    name: "core:html-cache",
    accepts: () => true,
    handle: async (event) => {
      htmlCache.invalidateDependency(event.type);
    },
  };
}

/**
 * Starts an instance from `env` (`process.env`, given by the entry point): configuration,
 * database (opened and migrated), modules (official ones, then those of `DATA_DIR/modules`,
 * imported now: an installed module is picked up at the next start), then the application with
 * every route. A refused module is logged and left out; the instance starts without it.
 *
 * One HTML cache and one block registry (the module host's) are shared by the public site and
 * the admin API: a publication, or a module enabled, changes exactly what the site serves.
 *
 * @throws {RuntimeConfigError} when a variable of `env` is invalid.
 * @throws {StartupError} without `SECRET_KEY`.
 */
export async function bootInstance(
  env: RuntimeEnv,
  options: BootOptions = {},
): Promise<BootedInstance> {
  const { config, db } = openInstance(env);
  const logger = options.logger ?? console;
  try {
    const { secretKey } = config;
    if (secretKey === undefined) {
      // The auth API needs it to sign the session cookies, and the module credentials are
      // encrypted with it: without it, an instance would lose both at the next restart.
      throw new StartupError(
        "La variable SECRET_KEY est requise : une clé de 256 bits en base64, à générer par " +
          "exemple avec « openssl rand -base64 32 ». Elle protège les sessions et les secrets " +
          "de l'instance.",
      );
    }
    const loaded = await loadModules({
      official: options.officialModules ?? officialModules,
      modulesDirectory: join(config.dataDir, MODULES_DIRECTORY),
      reservedBlockTypes: coreBlocks.map((block) => block.type),
      logger,
      ...(options.cmsVersion === undefined ? {} : { cmsVersion: options.cmsVersion }),
    });
    const modules = new ModuleHost({
      db,
      modules: loaded.modules,
      failures: loaded.failures,
      coreBlocks,
      secretKey,
      logger,
    });
    const clients = moduleClientFiles(
      loaded.modules,
      options.officialModuleClients ??
        (options.officialModules === undefined ? officialModuleClients : {}),
    );
    const auth = createAuth({ db, baseUrl: config.baseUrl, secretKey, logger });
    const htmlCache = new HtmlCache();
    const blocks = () => modules.blocks();
    const runtime = new ModuleRuntime({
      db,
      host: modules,
      coreSubscribers: [htmlCacheSubscriber(htmlCache)],
      logger,
    });
    const wake = () => runtime.wake();
    const adminDirectory = options.adminDirectory ?? adminBuildDirectory();
    const app = createApp({
      db,
      baseUrl: config.baseUrl,
      secretKey,
      htmlCache,
      blocks,
      logger,
      routes: (routes) => {
        // Before the back-office: its catch-all route would answer `/admin/_modules/*`.
        moduleClientRoutes({ auth, modules, clients, logger })(routes);
        adminRoutes({ directory: adminDirectory, logger })(routes);
        authRoutes({ auth, db, logger })(routes);
        pagesApiRoutes({ auth, db, blocks, htmlCache, logger })(routes);
        navigationApiRoutes({ auth, db, htmlCache, logger })(routes);
        modulesApiRoutes({ auth, modules, htmlCache })(routes);
        webhooksApiRoutes({ auth, db, onReplayed: wake })(routes);
        hooksRoutes({ db, modules, logger, onReceived: wake })(routes);
      },
    });
    return { config, db, app, htmlCache, modules, runtime, close: () => db.$client.close() };
  } catch (error) {
    db.$client.close();
    throw error;
  }
}
