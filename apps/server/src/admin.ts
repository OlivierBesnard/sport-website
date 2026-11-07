import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { Context, Hono } from "hono";
import type { Logger } from "./app.js";

/**
 * Serving of the back-office (the `apps/admin` build) under `/admin`, registered by the
 * `routes` hook of `createApp`, so before the public site:
 *
 * - `/admin` and `/admin/…` serve the static files of the build; unknown paths fall back to
 *   `index.html` (a single-page application with its own router), except under `/assets/`,
 *   whose files are hashed and must exist.
 * - When the build is absent (development without `pnpm build`), a clean 503 page in French.
 *
 * The back-office has its own Content-Security-Policy (it needs `script-src 'self'`), set on
 * every response here: a header a route sets itself wins over the middleware's, which would
 * otherwise impose the script-less policy of the public site.
 */

/** Prefix of every back-office URL. */
export const ADMIN_PREFIX = "/admin";

/**
 * Content-Security-Policy of the back-office. Unlike the public site, it runs JavaScript: the
 * bundle comes from the instance itself (`script-src 'self'`), the API is called same-origin
 * (`connect-src 'self'`), and styles may be inline (React sets `style` attributes; Tailwind
 * ships the stylesheet as a file). The editor of the pages previews its work in an
 * `about:srcdoc` iframe (`frame-src 'self' about:`), whose images are the ones of the site or
 * any `https:` address the club may embed, and whose only foreign frame is the OpenStreetMap map
 * of the block « Lieux et carte », as on the site. The back-office cannot be framed, post a form
 * elsewhere or change its base URI.
 */
export const ADMIN_CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self' about: https://www.openstreetmap.org",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

/**
 * Inline import maps of `index.html` (the build writes one: it maps `react`,
 * `@sport-cms/module-sdk`… to the copies of the back-office, for the client entries of the
 * modules). The content between the tags, exactly as the browser hashes it.
 */
const IMPORT_MAP = /<script type="importmap">([\s\S]*?)<\/script>/g;

/**
 * Content-Security-Policy of `index.html`: the policy of the back-office, plus the hash of each
 * inline import map it contains — the only inline script allowed (an import map is a script for
 * CSP, and browsers do not load an external one).
 */
export function adminIndexContentSecurityPolicy(html: string): string {
  const hashes = [...html.matchAll(IMPORT_MAP)].map(
    (match) =>
      `'sha256-${createHash("sha256")
        .update(match[1] ?? "")
        .digest("base64")}'`,
  );
  if (hashes.length === 0) {
    return ADMIN_CONTENT_SECURITY_POLICY;
  }
  return ADMIN_CONTENT_SECURITY_POLICY.replace(
    "script-src 'self'",
    `script-src 'self' ${hashes.join(" ")}`,
  );
}

const HTML_TYPE = "text/html; charset=utf-8";

/** Content types of the files the build can contain. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".avif": "image/avif",
  ".css": "text/css; charset=utf-8",
  ".gif": "image/gif",
  ".html": HTML_TYPE,
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

/** Cache of the hashed assets of the build: they never change, only their names do. */
const ASSETS_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Page sent when the build of the back-office is missing (development without `pnpm build`). */
const UNAVAILABLE_PAGE = [
  "<!DOCTYPE html>",
  '<html lang="fr">',
  '<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/><title>Back-office indisponible</title></head>',
  "<body><main>",
  "<h1>Back-office indisponible</h1>",
  "<p>Le back-office n'a pas encore été construit.</p>",
  "<p>Lancez <code>pnpm build</code> à la racine du projet, puis rechargez cette page.</p>",
  "</main></body></html>",
].join("");

/**
 * Directory of the built back-office (`apps/admin/dist`), resolved from this module's own
 * location: `apps/server/src` under `tsx watch`, `apps/server/dist` once compiled — both at
 * the same depth, so `../../admin/dist` reaches the build from either one.
 */
export function adminBuildDirectory(): string {
  return fileURLToPath(new URL("../../admin/dist", import.meta.url));
}

/** Decoded path under `/admin` (`""` or `"/…"`), or `undefined` when the encoding is malformed. */
export function decodeAdminPath(pathname: string): string | undefined {
  const rest =
    pathname === ADMIN_PREFIX
      ? ""
      : pathname.startsWith(`${ADMIN_PREFIX}/`)
        ? pathname.slice(ADMIN_PREFIX.length)
        : undefined;
  if (rest === undefined) {
    return undefined;
  }
  try {
    return decodeURIComponent(rest);
  } catch {
    return undefined;
  }
}

/** Reserved device names of Windows (case-insensitive, with or without an extension). */
const WINDOWS_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..+)?$/i;

/** Whether a segment of a requested path names something Windows would read differently. */
function forbiddenSegment(segment: string): boolean {
  // A colon opens an NTFS alternate stream or names a drive: never part of a build file.
  if (segment.includes(":")) {
    return true;
  }
  // The dot segments are resolved by `resolve` and stay inside thanks to the boundary check.
  if (segment === "." || segment === "..") {
    return false;
  }
  // Win32 strips a trailing dot or space and reads device names as devices, whatever the
  // extension: the build cannot contain such a name, so refuse the request.
  return /[. ]$/.test(segment) || WINDOWS_DEVICE.test(segment);
}

/**
 * Path of a file of the build, or `undefined` when it would escape the directory or name a
 * file the system would read differently: a request like `/admin/../secret` (or its
 * percent-encoded or backslash variants) must never reach a file outside `directory`.
 */
export function fileWithin(directory: string, relative: string): string | undefined {
  if (relative.includes("\0")) {
    return undefined;
  }
  if (relative.replaceAll("\\", "/").split("/").some(forbiddenSegment)) {
    return undefined;
  }
  const target = resolve(directory, `.${relative.replaceAll("\\", "/")}`);
  const boundary = directory.endsWith(sep) ? directory : directory + sep;
  return target === directory || target.startsWith(boundary) ? target : undefined;
}

export interface AdminRoutesDependencies {
  /** Directory of the built back-office (`apps/admin/dist`). */
  readonly directory: string;
  readonly logger?: Logger;
}

/**
 * Registers `GET /admin` and `GET /admin/*` on the application. The build is read from disk on
 * every request: no cache to invalidate, and a build produced while the server runs is served
 * without a restart.
 */
export function adminRoutes({
  directory,
  logger = console,
}: AdminRoutesDependencies): (app: Hono) => void {
  function respond(
    context: Context,
    body: string | Uint8Array<ArrayBuffer>,
    status: 200 | 404 | 500 | 503,
    cacheControl: string,
    contentType: string,
    policy: string = ADMIN_CONTENT_SECURITY_POLICY,
  ): Response {
    return context.body(body, status, {
      "Cache-Control": cacheControl,
      "Content-Security-Policy": policy,
      "Content-Type": contentType,
    });
  }

  function notFound(context: Context): Response {
    return respond(context, "Ressource introuvable.", 404, "no-store", "text/plain; charset=utf-8");
  }

  function unavailable(context: Context): Response {
    return respond(context, UNAVAILABLE_PAGE, 503, "no-store", HTML_TYPE);
  }

  /** `index.html` of the SPA, or the 503 page when even it is missing (half-built directory). */
  async function sendIndex(context: Context): Promise<Response> {
    try {
      const content = await readFile(join(directory, "index.html"));
      return respond(
        context,
        new Uint8Array(content),
        200,
        "no-cache",
        HTML_TYPE,
        adminIndexContentSecurityPolicy(content.toString("utf8")),
      );
    } catch {
      return unavailable(context);
    }
  }

  const handler = async (context: Context): Promise<Response> => {
    const { pathname } = new URL(context.req.url);
    const relative = decodeAdminPath(pathname);
    if (relative === undefined) {
      return notFound(context);
    }

    try {
      if (!(await stat(directory)).isDirectory()) {
        return unavailable(context);
      }
    } catch {
      return unavailable(context);
    }

    if (relative === "" || relative === "/") {
      return sendIndex(context);
    }
    const target = fileWithin(directory, relative);
    if (target === undefined) {
      return notFound(context);
    }

    try {
      const content = await readFile(target);
      const type = CONTENT_TYPES[extname(target).toLowerCase()] ?? "application/octet-stream";
      return respond(
        context,
        new Uint8Array(content),
        200,
        // The cache is decided on the resolved file: an encoded path that ends up on
        // `index.html` is revalidated, whatever it looks like in the request.
        target.startsWith(join(directory, "assets") + sep) ? ASSETS_CACHE_CONTROL : "no-cache",
        type,
        // `/admin/index.html` asked by name carries its import map too.
        type === HTML_TYPE
          ? adminIndexContentSecurityPolicy(content.toString("utf8"))
          : ADMIN_CONTENT_SECURITY_POLICY,
      );
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== "ENOENT" && code !== "EISDIR") {
        logger.error(`Erreur en servant le back-office ${pathname}`, error);
        return respond(
          context,
          "Erreur en servant le back-office.",
          500,
          "no-store",
          "text/plain; charset=utf-8",
        );
      }
      // A hashed asset must exist; any other unknown path is a route of the SPA.
      if (relative.startsWith("/assets/")) {
        return notFound(context);
      }
      return sendIndex(context);
    }
  };

  return (app) => {
    app.get(ADMIN_PREFIX, handler);
    app.get(`${ADMIN_PREFIX}/*`, handler);
  };
}
