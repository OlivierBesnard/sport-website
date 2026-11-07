import type { ModuleHost, ModuleOperation } from "@sport-cms/module-loader";
import { MODULE_ID_PATTERN } from "@sport-cms/module-sdk";
import { type Context, Hono } from "hono";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requirePermission } from "./auth/middlewares.js";
import type { HtmlCache } from "./html-cache.js";

/**
 * Admin API of the modules, under `/api/modules`, registered through the `routes` hook of
 * `createApp`. Every route requires the `modules.manage` permission (the owner's).
 *
 * - `GET /api/modules`: `{ modules, failures }`, every module (loaded, or only known to the
 *   database) and the modules refused at this start, with their reasons.
 * - `GET /api/modules/:id`: one module.
 * - `POST /api/modules/:id/enable`, `POST /api/modules/:id/disable`: the blocks of the module
 *   join or leave the public site, so the whole HTML cache is cleared.
 * - `PUT /api/modules/:id/settings`: the settings object, validated by the module's schema.
 * - `PUT /api/modules/:id/credentials`: the credentials object, validated then encrypted;
 *   `DELETE` forgets them. Responses only say whether credentials are saved, never their values.
 *
 * Errors: 400 (`{ error, fields }`), 404 unknown module, 409 module not loaded or busy, 500 when
 * the module's hook threw. Every change is audited (`modules.*`).
 */

export interface ModulesApiDependencies {
  readonly auth: Auth;
  readonly modules: ModuleHost;
  /** Cache of the public site, cleared when the blocks a page can show change. */
  readonly htmlCache: HtmlCache;
}

const STATUS: Readonly<
  Record<Extract<ModuleOperation, { ok: false }>["reason"], 400 | 404 | 409 | 500>
> = {
  invalid: 400,
  not_found: 404,
  unavailable: 409,
  busy: 409,
  failed: 500,
};

function respond(context: Context<ApiEnv>, result: ModuleOperation): Response {
  if (result.ok) {
    return context.json({ module: result.module });
  }
  return context.json(
    result.fields === undefined
      ? { error: result.error }
      : { error: result.error, fields: result.fields },
    STATUS[result.reason],
  );
}

/** The `:id` of the route, when it can be a module identifier. */
function moduleId(context: Context<ApiEnv>): string | undefined {
  const id = context.req.param("id");
  return id !== undefined && MODULE_ID_PATTERN.test(id) ? id : undefined;
}

const NOT_FOUND = { error: "Module introuvable." };

async function jsonBody(context: Context<ApiEnv>): Promise<unknown> {
  return context.req.json().catch(() => undefined);
}

export function modulesApiRoutes({
  auth,
  modules,
  htmlCache,
}: ModulesApiDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "modules.manage"));

  api.get("/", (context) =>
    context.json({ modules: modules.list(), failures: modules.failures() }),
  );

  api.get("/:id", (context) => {
    const id = moduleId(context);
    const view = id === undefined ? undefined : modules.view(id);
    return view === undefined ? context.json(NOT_FOUND, 404) : context.json({ module: view });
  });

  for (const action of ["enable", "disable"] as const) {
    api.post(`/:id/${action}`, async (context) => {
      const id = moduleId(context);
      if (id === undefined) {
        return context.json(NOT_FOUND, 404);
      }
      const before = modules.blocks();
      const actorId = context.get("user").id;
      const result =
        action === "enable"
          ? await modules.enable(id, actorId)
          : await modules.disable(id, actorId);
      if (modules.blocks() !== before) {
        // The module's blocks appear on, or leave, published pages: no cached page is right.
        htmlCache.clear();
      }
      return respond(context, result);
    });
  }

  api.put("/:id/settings", async (context) => {
    const id = moduleId(context);
    if (id === undefined) {
      return context.json(NOT_FOUND, 404);
    }
    const body = await jsonBody(context);
    if (body === undefined) {
      return context.json({ error: "Requête invalide : un objet JSON est attendu." }, 400);
    }
    return respond(context, modules.updateSettings(id, body, context.get("user").id));
  });

  api.put("/:id/credentials", async (context) => {
    const id = moduleId(context);
    if (id === undefined) {
      return context.json(NOT_FOUND, 404);
    }
    const body = await jsonBody(context);
    if (body === undefined) {
      return context.json({ error: "Requête invalide : un objet JSON est attendu." }, 400);
    }
    return respond(context, modules.setCredentials(id, body, context.get("user").id));
  });

  api.delete("/:id/credentials", (context) => {
    const id = moduleId(context);
    if (id === undefined) {
      return context.json(NOT_FOUND, 404);
    }
    return respond(context, modules.deleteCredentials(id, context.get("user").id));
  });

  return (app) => {
    app.route("/api/modules", api);
  };
}
