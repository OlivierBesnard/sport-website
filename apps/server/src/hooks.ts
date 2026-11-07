import type { Database } from "@sport-cms/db";
import { type ModuleHost, receiveWebhook, storableHeaders } from "@sport-cms/module-loader";
import { MODULE_ID_PATTERN, MODULE_NAME_PATTERN } from "@sport-cms/module-sdk";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { Logger } from "./app.js";
import { createRateLimiter, type RateLimitOptions, rateLimit } from "./auth/rate-limit.js";

/**
 * Incoming webhooks of the modules (PLAN §6.7): `POST /hooks/<module>/<name>`, the URL a module
 * tells the club to paste into the external service.
 *
 * The request is stored raw (`inbound_webhooks`: headers without cookies, exact bytes of the
 * body, for signatures) and answered 200 at once; the module's handler runs afterwards, in a
 * round of the scheduler, retried on failure and replayable from the back-office. Anyone can
 * reach this URL: the handler must check that the request comes from the service (its
 * signature, or by reading the data again through the service's API) before trusting it.
 *
 * 404 when the module is unknown, disabled, or declares no such webhook; 413 beyond
 * {@link MAX_WEBHOOK_BODY_BYTES}; 429 beyond the rate limit, by client address.
 */

/** Largest body stored for a webhook: notifications are small. */
export const MAX_WEBHOOK_BODY_BYTES = 1024 * 1024;

/** Default rate limit of `/hooks`, per client address: generous for a service, not for a flood. */
export const WEBHOOK_RATE_LIMIT: RateLimitOptions = { windowMs: 60_000, max: 120 };

export interface HooksRoutesDependencies {
  readonly db: Database;
  readonly modules: ModuleHost;
  readonly logger?: Logger;
  /** Called once a webhook is stored: the scheduler processes it without waiting. */
  readonly onReceived?: () => void;
  readonly limit?: RateLimitOptions;
  /** Rate-limit key from `x-forwarded-for` (behind the reverse proxy that overwrites it). */
  readonly trustProxy?: boolean;
}

export function hooksRoutes({
  db,
  modules,
  logger = console,
  onReceived,
  limit = WEBHOOK_RATE_LIMIT,
  trustProxy = false,
}: HooksRoutesDependencies): (app: Hono) => void {
  const hooks = new Hono();
  const notFound = (context: Context): Response => context.json({ error: "Webhook inconnu." }, 404);

  hooks.use("*", rateLimit(createRateLimiter(limit), { trustProxy }));
  hooks.post(
    "/:module/:name",
    // Checked before the body is read: an unknown webhook costs nothing to refuse.
    async (context, next) => {
      const moduleId = context.req.param("module");
      const name = context.req.param("name");
      if (!MODULE_ID_PATTERN.test(moduleId) || !MODULE_NAME_PATTERN.test(name)) {
        return notFound(context);
      }
      const module = modules.enabledModules().find((loaded) => loaded.manifest.id === moduleId);
      if (module?.definition.webhooks?.[name] === undefined) {
        return notFound(context);
      }
      return next();
    },
    bodyLimit({
      maxSize: MAX_WEBHOOK_BODY_BYTES,
      onError: (context) =>
        context.json(
          {
            error: `Le webhook est trop volumineux (${MAX_WEBHOOK_BODY_BYTES / 1024} Ko au maximum).`,
          },
          413,
        ),
    }),
    async (context) => {
      const moduleId = context.req.param("module");
      const name = context.req.param("name");
      try {
        const body = new Uint8Array(await context.req.arrayBuffer());
        const id = receiveWebhook(db, {
          moduleId,
          name,
          headers: storableHeaders(context.req.raw.headers),
          body,
        });
        onReceived?.();
        return context.json({ received: true, id });
      } catch (error) {
        logger.error(`Webhook « ${moduleId}/${name} » non enregistré`, error);
        return context.json({ error: "Le webhook n'a pas pu être enregistré." }, 500);
      }
    },
  );
  // Any other method on a webhook URL.
  hooks.all("*", notFound);

  return (app) => {
    app.route("/hooks", hooks);
  };
}
