import type { MiddlewareHandler } from "hono";

/**
 * Content-Security-Policy of the public site. Pages are static HTML: no script at all, styles
 * only from the site's own stylesheet (no inline `style`), images from the site or over HTTPS.
 * The page can neither be framed, nor change its base URL, nor post a form elsewhere.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "style-src 'self'",
  "img-src 'self' https:",
  "font-src 'self'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/** Headers added to every response that does not set them itself. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CONTENT_SECURITY_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  // For browsers that ignore `frame-ancestors`.
  "X-Frame-Options": "DENY",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

/**
 * Sent when the site is served over HTTPS: browsers then refuse plain HTTP for a year. Without
 * `includeSubDomains`, since other subdomains of the club's domain are not ours.
 */
export const STRICT_TRANSPORT_SECURITY = "max-age=31536000";

export interface SecurityHeadersOptions {
  /** Whether the public address of the site is `https:` (adds `Strict-Transport-Security`). */
  readonly https: boolean;
}

/**
 * Sets {@link SECURITY_HEADERS} on every response, error and not-found pages included. A header
 * a route already set is left as it is: the back-office, for instance, needs its own policy.
 */
export function securityHeaders({ https }: SecurityHeadersOptions): MiddlewareHandler {
  const headers = https
    ? { ...SECURITY_HEADERS, "Strict-Transport-Security": STRICT_TRANSPORT_SECURITY }
    : SECURITY_HEADERS;
  return async (context, next) => {
    await next();
    for (const [name, value] of Object.entries(headers)) {
      if (!context.res.headers.has(name)) {
        context.res.headers.set(name, value);
      }
    }
  };
}
