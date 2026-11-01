import type { Database, writeAudit } from "@sport-cms/db";
import type { Hono } from "hono";
import type { Logger } from "../app.js";
import type { Auth } from "./create-auth.js";
import { createRateLimiter, type RateLimitOptions, rateLimit } from "./rate-limit.js";
import { setupPostHandler, setupStatus } from "./setup.js";
import { signInHandler } from "./sign-in.js";

/** Rate limits of the authentication API, per window and per client IP. */
export interface AuthLimits {
  /** Attempts of `POST /api/auth/sign-in/email` (on top of Better Auth's own limiter). */
  readonly signIn: RateLimitOptions;
  /** Attempts of `POST /api/setup`. */
  readonly setup: RateLimitOptions;
}

export const DEFAULT_AUTH_LIMITS: AuthLimits = {
  signIn: { windowMs: 60_000, max: 10 },
  setup: { windowMs: 60_000, max: 5 },
};

export interface AuthRoutesDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly logger?: Logger;
  readonly limits?: AuthLimits;
  /** Writer of the audit entry of the setup; a test replaces it. */
  readonly audit?: typeof writeAudit;
  /**
   * Whether the requests are trusted to have gone through the reverse proxy of the instance
   * (supervisor, Caddy), which overwrites `x-forwarded-for`. Until then the rate limits key on
   * the address of the socket, the only one a visitor cannot forge.
   */
  readonly trustProxy?: boolean;
}

/**
 * Registers the authentication and installation API on a Hono application:
 *
 * - `GET /api/setup`: whether the instance is installed (`{ installed, clubName }`).
 * - `POST /api/setup`: creates the owner account and the identity of the club, once.
 * - `POST /api/auth/sign-in/email`: sign-in (rate limited, failures audited).
 * - `POST /api/auth/sign-up/email`: refused — accounts are created by the setup now, and by
 *   the back-office API later, never by visitors.
 * - every other `POST` or `GET /api/auth/*` path is Better Auth's (sign-out, get-session…).
 *
 * The routes match before the public site, and get its security headers, not-found page and
 * error handler from `createApp`.
 */
export function authRoutes({
  auth,
  db,
  logger = console,
  limits = DEFAULT_AUTH_LIMITS,
  audit,
  trustProxy = false,
}: AuthRoutesDependencies): (app: Hono) => void {
  const signInLimiter = createRateLimiter(limits.signIn);
  const setupLimiter = createRateLimiter(limits.setup);
  return (app) => {
    app.get("/api/setup", (context) => context.json(setupStatus(db)));
    app.post(
      "/api/setup",
      rateLimit(setupLimiter, { trustProxy }),
      setupPostHandler({ auth, db, logger, audit }),
    );
    app.post(
      "/api/auth/sign-in/email",
      rateLimit(signInLimiter, { trustProxy }),
      signInHandler({ auth, db, logger }),
    );
    app.post("/api/auth/sign-up/email", (context) =>
      context.json({ error: "L'inscription publique est désactivée." }, 403),
    );
    app.on(["POST", "GET"], "/api/auth/*", (context) => auth.handler(context.req.raw));
  };
}
