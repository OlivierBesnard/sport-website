import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CMS_VERSION,
  DEFAULT_UPDATE_SETTINGS,
  MAX_UPDATE_PAUSE_MS,
  SUPERVISOR_STATE_FILE,
  type SupervisorState,
  supervisorStateSchema,
  UPDATE_ACTIONS,
  UPDATE_REQUEST_FILE,
  UPDATE_SETTINGS_FILE,
  UPDATES_DIRECTORY,
  type UpdateRequest,
  type UpdateSettings,
  updateRequestSchema,
  updateSettingsSchema,
} from "@sport-cms/core";
import { type Database, writeAudit } from "@sport-cms/db";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requirePermission } from "./auth/middlewares.js";
import { fieldsOf } from "./fields.js";

/**
 * Admin API of the automatic updates, under `/api/updates` (`settings.manage`). The instance and
 * its supervisor share three files of `DATA_DIR/updates/` (see `@sport-cms/core`, `updates.ts`):
 * this API writes the club's settings and its requests, and reads what the supervisor did.
 *
 * - `GET /api/updates`: `{ version, settings, state, request }` (`state`: `null` when no
 *   supervisor runs the instance, in development for instance);
 * - `PUT /api/updates/settings`: policy, channel, window, pause (14 days at most), audited
 *   `updates.settings_updated`;
 * - `POST /api/updates/request` (`{ action: "update" | "rollback" }`): picked up by the
 *   supervisor within seconds, audited `updates.requested`; 409 without a supervisor, or without
 *   a previous version to go back to.
 */

export interface UpdatesApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly dataDir: string;
  readonly now?: () => number;
}

const INVALID = "Certains réglages sont invalides.";
const FRENCH = { error: z.locales.fr().localeError, reportInput: true } as const;

const requestBodySchema = z.object({ action: z.enum(UPDATE_ACTIONS) });

async function readJson(path: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch {
    return undefined;
  }
}

/** Temporary file then rename: the supervisor never reads half a file. */
async function writeJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

export function updatesApiRoutes({
  auth,
  db,
  dataDir,
  now = Date.now,
}: UpdatesApiDependencies): (app: Hono) => void {
  const directory = join(dataDir, UPDATES_DIRECTORY);
  const paths = {
    settings: join(directory, UPDATE_SETTINGS_FILE),
    request: join(directory, UPDATE_REQUEST_FILE),
    state: join(directory, SUPERVISOR_STATE_FILE),
  };

  async function readSettings(): Promise<UpdateSettings> {
    const parsed = updateSettingsSchema.safeParse(await readJson(paths.settings));
    return parsed.success ? parsed.data : DEFAULT_UPDATE_SETTINGS;
  }

  async function readState(): Promise<SupervisorState | null> {
    const parsed = supervisorStateSchema.safeParse(await readJson(paths.state));
    return parsed.success ? parsed.data : null;
  }

  async function readRequest(): Promise<UpdateRequest | null> {
    const parsed = updateRequestSchema.safeParse(await readJson(paths.request));
    return parsed.success ? parsed.data : null;
  }

  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "settings.manage"));

  api.get("/", async (context) => {
    context.header("Cache-Control", "no-store");
    const [settings, state, request] = await Promise.all([
      readSettings(),
      readState(),
      readRequest(),
    ]);
    return context.json({ version: CMS_VERSION, settings, state, request });
  });

  api.put("/settings", async (context: Context<ApiEnv>) => {
    const raw = await context.req.json().catch(() => undefined);
    const parsed = updateSettingsSchema.safeParse(raw, FRENCH);
    if (!parsed.success) {
      return context.json({ error: INVALID, fields: fieldsOf(parsed.error) }, 400);
    }
    const current = now();
    const { pausedUntil } = parsed.data;
    if (pausedUntil !== null && pausedUntil > current + MAX_UPDATE_PAUSE_MS) {
      return context.json(
        { error: INVALID, fields: { pausedUntil: "La pause ne peut pas dépasser 14 jours." } },
        400,
      );
    }
    // A pause already over is no pause.
    const settings: UpdateSettings = {
      ...parsed.data,
      pausedUntil: pausedUntil !== null && pausedUntil > current ? pausedUntil : null,
    };
    await mkdir(directory, { recursive: true });
    await writeJson(paths.settings, settings);
    writeAudit(db, {
      actorId: context.get("user").id,
      action: "updates.settings_updated",
      details: {
        policy: settings.policy,
        channel: settings.channel,
        window: `${settings.window.start}-${settings.window.end}`,
        pausedUntil: settings.pausedUntil,
      },
    });
    return context.json({ settings });
  });

  api.post("/request", async (context: Context<ApiEnv>) => {
    const raw = await context.req.json().catch(() => undefined);
    const parsed = requestBodySchema.safeParse(raw, FRENCH);
    if (!parsed.success) {
      return context.json({ error: "Action inconnue : update ou rollback sont attendus." }, 400);
    }
    const state = await readState();
    if (state === null) {
      return context.json(
        {
          error:
            "Aucun superviseur ne gère cette instance : les mises à jour se font à la main (nouvelle version du serveur).",
        },
        409,
      );
    }
    const { action } = parsed.data;
    if (action === "rollback" && state.previous === null) {
      return context.json({ error: "Aucune version précédente n'est disponible." }, 409);
    }
    const request: UpdateRequest = { action, requestedAt: now() };
    await mkdir(directory, { recursive: true });
    await writeJson(paths.request, request);
    writeAudit(db, {
      actorId: context.get("user").id,
      action: "updates.requested",
      details: { action, current: state.current, previous: state.previous },
    });
    return context.json({ request }, 202);
  });

  return (app) => {
    app.route("/api/updates", api);
  };
}
