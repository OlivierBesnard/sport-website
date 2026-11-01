import { can, type Permission } from "@sport-cms/core";
import type { Context, MiddlewareHandler } from "hono";
import type { Auth } from "./create-auth.js";

/** Session and user, as returned by Better Auth's `getSession` for a valid session cookie. */
export type AuthSession = NonNullable<Awaited<ReturnType<Auth["api"]["getSession"]>>>;

/** Variables the auth middlewares put on the context for the handlers that follow them. */
export interface AuthVariables {
  readonly user: AuthSession["user"];
  readonly session: AuthSession["session"];
}

/** Hono environment of the API routes protected by the auth middlewares. */
export type ApiEnv = { Variables: AuthVariables };

async function sessionOf(auth: Auth, context: Context): Promise<AuthSession | null> {
  return auth.api.getSession({ headers: context.req.raw.headers });
}

/** Refuses 401 when the request carries no valid session cookie. */
export function requireUser(auth: Auth): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const session = await sessionOf(auth, context);
    if (session === null) {
      return context.json({ error: "Authentification requise." }, 401);
    }
    context.set("user", session.user);
    context.set("session", session.session);
    return next();
  };
}

/**
 * Refuses 401 without a session, then 403 when the signed-in user's role does not hold
 * `permission` (see `can` of `@sport-cms/core`).
 */
export function requirePermission(auth: Auth, permission: Permission): MiddlewareHandler<ApiEnv> {
  return async (context, next) => {
    const session = await sessionOf(auth, context);
    if (session === null) {
      return context.json({ error: "Authentification requise." }, 401);
    }
    if (!can(session.user, permission)) {
      return context.json(
        { error: `Accès refusé : la permission « ${permission} » est requise.` },
        403,
      );
    }
    context.set("user", session.user);
    context.set("session", session.session);
    return next();
  };
}
