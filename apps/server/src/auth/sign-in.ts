import { type Database, writeAudit } from "@sport-cms/db";
import type { Context } from "hono";
import type { Logger } from "../app.js";
import type { Auth } from "./create-auth.js";

export interface SignInDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly logger?: Logger;
}

/** The email a failed attempt tried, truncated: the audit must not hold an arbitrary blob. */
function emailOf(body: unknown): string | null {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return null;
  }
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" ? email.slice(0, 200) : null;
}

/**
 * Proxies Better Auth's sign-in endpoint: the same request, with a rate limiter upstream (see
 * the auth routes) and an audit entry on failure, so the log tells who tried to get in. The
 * body is read on a clone: the original request goes to Better Auth untouched.
 */
export function signInHandler({ auth, db, logger = console }: SignInDependencies) {
  return async (context: Context): Promise<Response> => {
    const request = context.req.raw;
    const body: unknown = await request
      .clone()
      .json()
      .catch(() => undefined);
    try {
      const response = await auth.handler(request);
      if (response.status === 401) {
        writeAudit(db, {
          action: "auth.sign_in_failed",
          details: { email: emailOf(body) },
        });
      }
      return response;
    } catch (error) {
      logger.error("Échec de la connexion", error);
      return context.json({ error: "La connexion a échoué." }, 500);
    }
  };
}
