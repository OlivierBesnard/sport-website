import { existsSync, realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, sep } from "node:path";
import type { LoadedModule, ModuleHost } from "@sport-cms/module-loader";
import { MODULE_ID_PATTERN } from "@sport-cms/module-sdk";
import { type Context, Hono } from "hono";
import { ADMIN_CONTENT_SECURITY_POLICY, ADMIN_PREFIX, fileWithin } from "./admin.js";
import type { Logger } from "./app.js";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requireUser } from "./auth/middlewares.js";

/**
 * Client entries of the modules: the files the back-office imports, in the browser, for each
 * enabled module (its blocks for the editor, its pages).
 *
 * - `GET /api/client-modules` (any signed-in user: the editor of the pages needs the blocks):
 *   `{ modules: [{ id, name, version, blocks, client }] }`, the enabled and loaded modules, with
 *   the block types the server renders for them and the URL of their client entry (`null`
 *   without one).
 * - `GET /admin/_modules/<id>/<version>/<file>.js`: the JavaScript files of an enabled module's
 *   client, imported by the back-office (the entry, then its relative imports, which keep the
 *   same prefix). Only `.js` files, inside the module's client directory, for the version
 *   loaded at this start; a signed-in session is required. Revalidated on every load
 *   (`no-cache`): an installed module may be replaced without changing its version.
 *
 * Bare imports of these files (`react`, `@sport-cms/module-sdk`…) are resolved by the import map
 * of the back-office (see `apps/admin/vite-shared-modules.ts`): one copy of React for the
 * back-office and the modules.
 */

/** Where the client files of a module are, on disk. */
export interface ModuleClientFiles {
  /** Directory served under `/admin/_modules/<id>/<version>/`. */
  readonly directory: string;
  /** Path of the entry inside `directory` (`client.js`). */
  readonly entry: string;
}

/** Client entry of a module installed in `DATA_DIR/modules/<id>/`, next to `server.js`. */
export const INSTALLED_CLIENT_ENTRY = "client.js";

/** Prefix of the client files of the modules, outside the routes of the back-office's SPA. */
export const MODULE_CLIENT_PREFIX = `${ADMIN_PREFIX}/_modules`;

/**
 * Client files of an official module, a package of the workspace (`@sport-cms/module-…`) whose
 * build writes `dist/client.js` (its `./client` export). The package must export its
 * `./package.json`.
 */
export function officialClientFiles(packageName: string): ModuleClientFiles {
  const require = createRequire(import.meta.url);
  const directory = join(dirname(require.resolve(`${packageName}/package.json`)), "dist");
  return { directory, entry: "client.js" };
}

/**
 * Where the client of each loaded module is: the official modules from `official` (by id), the
 * installed ones next to their `server.js`.
 */
export function moduleClientFiles(
  modules: readonly LoadedModule[],
  official: Readonly<Record<string, ModuleClientFiles>>,
): ReadonlyMap<string, ModuleClientFiles> {
  const files = new Map<string, ModuleClientFiles>();
  for (const module of modules) {
    const { id } = module.manifest;
    if (module.source === "official") {
      const client = official[id];
      if (client !== undefined) {
        files.set(id, client);
      }
    } else if (module.directory !== undefined) {
      files.set(id, { directory: module.directory, entry: INSTALLED_CLIENT_ENTRY });
    }
  }
  return files;
}

/** URL of a file of a module's client. */
export function moduleClientUrl(id: string, version: string, file: string): string {
  return `${MODULE_CLIENT_PREFIX}/${id}/${encodeURIComponent(version)}/${file}`;
}

export interface ModuleClientRoutesDependencies {
  readonly auth: Auth;
  readonly modules: ModuleHost;
  /** Client files of the loaded modules, by id (see {@link moduleClientFiles}). */
  readonly clients: ReadonlyMap<string, ModuleClientFiles>;
  readonly logger?: Logger;
}

/** The module's entry when it exists on disk. */
function existingEntry(files: ModuleClientFiles | undefined): string | undefined {
  return files !== undefined && existsSync(join(files.directory, files.entry))
    ? files.entry
    : undefined;
}

/**
 * The real path of `target` when it stays inside the real `directory`: a link inside the
 * client directory must not lead to a file outside it.
 */
function realFileWithin(directory: string, target: string): string | undefined {
  try {
    const root = realpathSync(directory);
    const real = realpathSync(target);
    const boundary = root.endsWith(sep) ? root : root + sep;
    return real.startsWith(boundary) ? real : undefined;
  } catch {
    return undefined;
  }
}

/** Registers `GET /api/client-modules` and `GET /admin/_modules/*`, before the back-office. */
export function moduleClientRoutes({
  auth,
  modules,
  clients,
  logger = console,
}: ModuleClientRoutesDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requireUser(auth));
  api.get("/", (context) =>
    context.json({
      modules: modules
        .list()
        .filter((module) => module.enabled && module.status === "available")
        .map((module) => {
          const entry = existingEntry(clients.get(module.id));
          return {
            id: module.id,
            name: module.name,
            version: module.version,
            blocks: module.blocks.map((block) => block.type),
            client: entry === undefined ? null : moduleClientUrl(module.id, module.version, entry),
          };
        }),
    }),
  );

  const files = new Hono<ApiEnv>();
  files.use("*", requireUser(auth));
  files.get("/:id/:version/*", async (context: Context<ApiEnv>) => {
    const notFound = (): Response =>
      context.text("Fichier introuvable.", 404, {
        "Cache-Control": "no-store",
        "Content-Security-Policy": ADMIN_CONTENT_SECURITY_POLICY,
      });
    const id = context.req.param("id") ?? "";
    const version = context.req.param("version") ?? "";
    const client = clients.get(id);
    const view = MODULE_ID_PATTERN.test(id) ? modules.view(id) : undefined;
    if (
      client === undefined ||
      view === undefined ||
      !view.enabled ||
      view.status !== "available" ||
      view.version !== version
    ) {
      return notFound();
    }
    const prefix = `${MODULE_CLIENT_PREFIX}/${id}/${encodeURIComponent(version)}`;
    const { pathname } = new URL(context.req.url);
    if (!pathname.startsWith(`${prefix}/`)) {
      return notFound();
    }
    let relative: string;
    try {
      relative = decodeURIComponent(pathname.slice(prefix.length));
    } catch {
      return notFound();
    }
    const target = fileWithin(client.directory, relative);
    if (target === undefined || extname(target) !== ".js") {
      return notFound();
    }
    const real = realFileWithin(client.directory, target);
    if (real === undefined) {
      return notFound();
    }
    try {
      const content = await readFile(real);
      return context.body(new Uint8Array(content), 200, {
        "Cache-Control": "no-cache",
        "Content-Security-Policy": ADMIN_CONTENT_SECURITY_POLICY,
        "Content-Type": "text/javascript; charset=utf-8",
      });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code === "ENOENT" || code === "EISDIR") {
        return notFound();
      }
      logger.error(`Erreur en servant le client du module « ${id} »`, error);
      return context.text("Erreur en servant le fichier du module.", 500, {
        "Cache-Control": "no-store",
      });
    }
  });

  return (app) => {
    app.route("/api/client-modules", api);
    app.route(MODULE_CLIENT_PREFIX, files);
  };
}
