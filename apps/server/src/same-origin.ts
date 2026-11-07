import type { MiddlewareHandler } from "hono";

/** Methods that only read: a cross-site page may trigger them, they change nothing. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export const FOREIGN_ORIGIN_MESSAGE =
  "Requête refusée : elle ne provient pas du site de l'instance.";

/**
 * Cross-site request guard of the instance API (`/api/*`): a request that writes (any method
 * but GET, HEAD, OPTIONS) and carries an `Origin` header other than the origin of `baseUrl` is
 * refused with 403. A browser always sends `Origin` on such a request, so a page of another site
 * cannot act with the session cookie of a signed-in person, whatever `SameSite` allows; a client
 * without any `Origin` (curl, a script) is not a browser and goes on to the session checks.
 * `Origin: null` (sandboxed frame, `fetch` of Node) is refused too.
 *
 * The routes of Better Auth (`/api/auth/*`) are left to its own check, which already applies the
 * same rule and answers its own error codes.
 */
export function sameOriginWrites(baseUrl: string): MiddlewareHandler {
  const expected = new URL(baseUrl).origin;
  return async (context, next) => {
    if (SAFE_METHODS.has(context.req.method) || context.req.path.startsWith("/api/auth/")) {
      return next();
    }
    const origin = context.req.header("Origin");
    if (origin !== undefined && origin !== expected) {
      return context.json({ error: FOREIGN_ORIGIN_MESSAGE }, 403);
    }
    return next();
  };
}
