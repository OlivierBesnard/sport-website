import { type Database, INBOUND_WEBHOOK_STATUSES, inboundWebhooks } from "@sport-cms/db";
import { replayWebhook } from "@sport-cms/module-loader";
import { and, desc, eq, type SQL, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requirePermission } from "./auth/middlewares.js";

/**
 * Admin API of the received webhooks, under `/api/webhooks` (`modules.manage`):
 *
 * - `GET /api/webhooks?module=<id>&status=<pending|processed|failed>&limit=<n>`: the latest
 *   webhooks (50 by default, 200 at most), newest first, without their body nor headers (they
 *   may hold personal data): id, module, name, status, attempts, last error, dates, size;
 * - `POST /api/webhooks/:id/replay`: processes the webhook again (status back to `pending`, a
 *   new processing planned, audited `webhooks.replayed`); 404 for an unknown id.
 */

export interface WebhooksApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  /** Called after a replay: the scheduler processes it without waiting. */
  readonly onReplayed?: () => void;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const selection = {
  id: inboundWebhooks.id,
  module: inboundWebhooks.moduleId,
  name: inboundWebhooks.name,
  status: inboundWebhooks.status,
  attempts: inboundWebhooks.attempts,
  lastError: inboundWebhooks.lastError,
  receivedAt: inboundWebhooks.createdAt,
  processedAt: inboundWebhooks.processedAt,
  size: sql<number>`length(${inboundWebhooks.body})`,
};

function findWebhook(db: Database, id: number) {
  return db.select(selection).from(inboundWebhooks).where(eq(inboundWebhooks.id, id)).get();
}

type WebhookRow = NonNullable<ReturnType<typeof findWebhook>>;

function view(row: WebhookRow) {
  return {
    ...row,
    receivedAt: row.receivedAt.getTime(),
    processedAt: row.processedAt === null ? null : row.processedAt.getTime(),
  };
}

export function webhooksApiRoutes({
  auth,
  db,
  onReplayed,
}: WebhooksApiDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "modules.manage"));

  api.get("/", (context) => {
    const moduleId = context.req.query("module");
    const status = context.req.query("status");
    const limitText = context.req.query("limit");
    if (status !== undefined && !(INBOUND_WEBHOOK_STATUSES as readonly string[]).includes(status)) {
      return context.json(
        { error: "Statut inconnu : pending, processed ou failed sont attendus." },
        400,
      );
    }
    const limit = limitText === undefined ? DEFAULT_LIMIT : Number(limitText);
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
      return context.json(
        { error: `Le nombre de webhooks demandé doit être compris entre 1 et ${MAX_LIMIT}.` },
        400,
      );
    }
    const filters: SQL[] = [];
    if (moduleId !== undefined) {
      filters.push(eq(inboundWebhooks.moduleId, moduleId));
    }
    if (status !== undefined) {
      filters.push(eq(inboundWebhooks.status, status as (typeof INBOUND_WEBHOOK_STATUSES)[number]));
    }
    const rows = db
      .select(selection)
      .from(inboundWebhooks)
      .where(filters.length === 0 ? undefined : and(...filters))
      .orderBy(desc(inboundWebhooks.id))
      .limit(limit)
      .all();
    return context.json({ webhooks: rows.map(view) });
  });

  api.post("/:id/replay", (context: Context<ApiEnv>) => {
    const text = context.req.param("id") ?? "";
    const id = /^[1-9]\d{0,15}$/.test(text) ? Number(text) : undefined;
    if (id === undefined || !replayWebhook(db, id, context.get("user").id)) {
      return context.json({ error: "Webhook introuvable." }, 404);
    }
    onReplayed?.();
    const row = findWebhook(db, id);
    return row === undefined
      ? context.json({ error: "Webhook introuvable." }, 404)
      : context.json({ webhook: view(row) });
  });

  return (app) => {
    app.route("/api/webhooks", api);
  };
}
