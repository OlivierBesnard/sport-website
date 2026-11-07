import { createHash, type KeyObject } from "node:crypto";
import {
  type BlockRegistry,
  coreBlocks,
  createBlockRegistry,
  safeImageUrl,
} from "@sport-cms/blocks";
import { loadPageBlocks, renderPageContent } from "@sport-cms/blocks/server";
import {
  type ContentReader,
  encodePagePath,
  normalizePagePath,
  type SportReader,
} from "@sport-cms/core";
import type { Database } from "@sport-cms/db";
import { buildThemeCss, defaultTheme, type ThemeTokens } from "@sport-cms/themes";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { findPostPage, postArticleBlock } from "./content/post-page.js";
import { createContentReader } from "./content/reader.js";
import { type CacheTicket, HtmlCache } from "./html-cache.js";
import { DEFAULT_MENU, readNavigation } from "./navigation.js";
import { findPublishedPage, type PublishedPage } from "./pages.js";
import {
  type PageHead,
  renderDocument,
  renderNotFoundPage,
  renderServerErrorPage,
} from "./render/document.js";
import { sameOriginWrites } from "./same-origin.js";
import { securityHeaders } from "./security-headers.js";
import { createSportReader } from "./sport/reader.js";

/** Largest body accepted by the API (`/api/*`): 413 beyond. */
export const MAX_API_BODY_BYTES = 4 * 1024 * 1024;

/** Where the server reports errors (`console` by default). */
export interface Logger {
  error(message: string, ...details: unknown[]): void;
}

export interface AppDependencies {
  /** Migrated database of the instance. */
  readonly db: Database;
  /** Public origin of the site, without trailing slash (`RuntimeConfig.baseUrl`). */
  readonly baseUrl: string;
  /**
   * Instance secret (`RuntimeConfig.secretKey`), signing the session cookies of the auth API
   * (registered by `routes`) and, later, encrypting the secrets at rest.
   */
  readonly secretKey: KeyObject;
  /** Rendered pages; pass one to invalidate pages from elsewhere (publication…). */
  readonly htmlCache?: HtmlCache;
  /**
   * Blocks that can be rendered, read on every page request (the core blocks by default). Return
   * the same object as long as the blocks do not change: a new one empties the HTML cache.
   */
  readonly blocks?: () => BlockRegistry;
  /** Theme of the site, read on every request, with the same rule as `blocks`. */
  readonly theme?: () => ThemeTokens;
  readonly logger?: Logger;
  /** Sports content read by the blocks bound to it (the database of `db` by default). */
  readonly sport?: SportReader;
  /** News, partners and media read by the blocks (the database of `db` by default). */
  readonly content?: ContentReader;
  /** Clock of the rendering ("upcoming" matches are relative to it). */
  readonly now?: () => Date;
  /**
   * Registers the other routes of the instance (API, back-office, webhooks…), matched before the
   * public site, whose pages answer any other path. They get the security headers (unless they
   * set their own), the not-found page and the error handler.
   */
  readonly routes?: (app: Hono) => void;
}

/** What the public site needs from the theme, computed once per theme. */
interface ThemeAssets {
  readonly stylesheet: string;
  /** File name of the stylesheet, with a hash of its content: it can be cached forever. */
  readonly stylesheetName: string;
  readonly stylesheetHref: string;
  readonly notFoundHtml: string;
  readonly serverErrorHtml: string;
}

function buildThemeAssets(theme: ThemeTokens): ThemeAssets {
  const stylesheet = buildThemeCss(theme);
  const hash = createHash("sha256").update(stylesheet).digest("hex").slice(0, 16);
  const stylesheetName = `theme.${hash}.css`;
  const stylesheetHref = `/assets/${stylesheetName}`;
  return {
    stylesheet,
    stylesheetName,
    stylesheetHref,
    notFoundHtml: renderNotFoundPage(stylesheetHref),
    serverErrorHtml: renderServerErrorPage(stylesheetHref),
  };
}

function sendHtml(context: Context, html: string, status: 200 | 404 | 500 = 200): Response {
  // Pages change when they are published: browsers and proxies revalidate them every time.
  return context.html(html, status, { "Cache-Control": status === 500 ? "no-store" : "no-cache" });
}

/** Strong entity tag of a page: the hash of the exact HTML served. */
function etagOf(html: string): string {
  return `"${createHash("sha256").update(html).digest("hex")}"`;
}

/** Whether an `If-None-Match` header lets the server answer 304 for this entity tag. */
function ifNoneMatchSatisfied(header: string | undefined, etag: string): boolean {
  if (header === undefined) {
    return false;
  }
  if (header.trim() === "*") {
    return true;
  }
  // Weak comparison, as RFC 9110 requires for If-None-Match: a `W/` prefix is ignored (a proxy
  // that compresses the page may weaken the tag the client then sends back).
  return header.split(",").some((candidate) => candidate.trim().replace(/^W\//, "") === etag);
}

/** Sends a page with its `ETag`, answering 304 when the client already has that exact HTML. */
function sendPage(context: Context, html: string): Response {
  const etag = etagOf(html);
  if (ifNoneMatchSatisfied(context.req.header("If-None-Match"), etag)) {
    // A 304 carries the metadata, never a body.
    return context.newResponse(null, 304, { ETag: etag, "Cache-Control": "no-cache" });
  }
  return context.html(html, 200, { ETag: etag, "Cache-Control": "no-cache" });
}

/**
 * HTTP application of the instance: the public site and its health check, plus the routes given
 * by `routes`. Everything it uses is passed in, so tests can build it on a test database and call
 * `app.request()`.
 *
 * - `GET /health`: `{ "status": "ok" }` once the database answers, 503 otherwise.
 * - routes registered by `routes`.
 * - `GET /assets/theme.<hash>.css`: stylesheet of the site (theme variables and block styles).
 * - `GET <path>`: published page at that path, rendered on the server and cached; a variant of a
 *   path (trailing slash, repeated slash, dot segments, decomposed accents) is redirected (301)
 *   to its canonical form; any other request gets the 404 page.
 */
export function createApp(dependencies: AppDependencies): Hono {
  const { db, baseUrl, htmlCache = new HtmlCache(), logger = console, routes } = dependencies;
  const now = dependencies.now ?? (() => new Date());
  const sport = dependencies.sport ?? createSportReader(db, now);
  const contentReader = dependencies.content ?? createContentReader(db, now);

  let renderRegistry: { readonly blocks: BlockRegistry; readonly value: BlockRegistry } | undefined;
  /**
   * The blocks the pages render with: those of `blocks`, plus the article of the pages of the
   * news (a block of the server, never offered by the editor), rebuilt when `blocks` changes.
   */
  function renderingBlocks(registry: BlockRegistry): BlockRegistry {
    if (renderRegistry?.blocks !== registry) {
      renderRegistry = {
        blocks: registry,
        value: createBlockRegistry([...registry.values(), postArticleBlock]),
      };
    }
    return renderRegistry.value;
  }
  const coreRegistry = createBlockRegistry(coreBlocks);
  const blocks = dependencies.blocks ?? (() => coreRegistry);
  const theme = dependencies.theme ?? (() => defaultTheme);

  let assets: { readonly theme: ThemeTokens; readonly value: ThemeAssets } | undefined;
  /** Assets of the current theme, rebuilt only when the theme changes. */
  function themeAssets(): ThemeAssets {
    const current = theme();
    if (assets?.theme !== current) {
      assets = { theme: current, value: buildThemeAssets(current) };
    }
    return assets.value;
  }

  // Shown when even the theme cannot be read or turned into a stylesheet.
  const bareServerErrorHtml = renderServerErrorPage(undefined);

  let cachedWith: { readonly theme: ThemeTokens; readonly blocks: BlockRegistry } | undefined;
  /** Empties the HTML cache when the theme or the blocks change: cached pages used the old ones. */
  function syncHtmlCache(currentTheme: ThemeTokens, currentBlocks: BlockRegistry): void {
    if (cachedWith?.theme !== currentTheme || cachedWith.blocks !== currentBlocks) {
      htmlCache.clear();
      cachedWith = { theme: currentTheme, blocks: currentBlocks };
    }
  }

  /** The page document, and whether every block rendered (only then may it be cached). */
  /**
   * Failed blocks already logged, by page: a page with a failed block is not cached, so it is
   * rendered again on every request, but its failures are logged once until the page is
   * invalidated or the cache cleared (a new publication, other blocks… may change the outcome).
   * Bounded by the published pages: entries of the past epochs are dropped at once.
   */
  let reportedEpoch = -1;
  const reported = new Map<string, { ticket: CacheTicket; blocks: Set<string> }>();

  /** Whether the failure of this block on this page is new for this version of the page. */
  function firstReport(ticket: CacheTicket, type: string, id: string): boolean {
    if (ticket.epoch !== reportedEpoch) {
      reported.clear();
      reportedEpoch = ticket.epoch;
    }
    let entry = reported.get(ticket.path);
    if (entry === undefined || entry.ticket.generation !== ticket.generation) {
      entry = { ticket, blocks: new Set() };
      reported.set(ticket.path, entry);
    }
    const key = JSON.stringify([type, id]);
    if (entry.blocks.has(key)) {
      return false;
    }
    entry.blocks.add(key);
    return true;
  }

  async function renderPage(
    path: string,
    page: PublishedPage,
    registry: BlockRegistry,
    ticket: CacheTicket,
  ): Promise<{
    html: string;
    complete: boolean;
    dependencies: Set<string>;
    expiresAt: number | undefined;
  }> {
    let complete = true;
    // Events after which this page is out of date: the `dependsOn` of the blocks it renders.
    const dependencies = new Set<string>();
    // Date after which it is out of date anyway (the next match has started…).
    let expiresAt: number | undefined;
    const onBlockError = (error: unknown, block: { type: string; id: string }): void => {
      complete = false;
      if (firstReport(ticket, block.type, block.id)) {
        logger.error(`Bloc « ${block.type} » (${block.id}) non affiché sur la page ${path}`, error);
      }
    };
    // The data of the blocks bound to the instance (matches, teams…), all loaded before the
    // synchronous rendering.
    const loaded = await loadPageBlocks(page.data, {
      registry,
      onBlockError,
      context: {
        sport,
        content: contentReader,
        now: now(),
        expiresAt: (date) => {
          const time = date.getTime();
          if (Number.isFinite(time) && (expiresAt === undefined || time < expiresAt)) {
            expiresAt = time;
          }
        },
      },
    });
    const image = safeImageUrl(page.image);
    const head: PageHead = {
      title: page.title,
      description: page.description,
      canonicalUrl: `${baseUrl}${encodePagePath(path)}`,
      imageUrl: image === undefined ? undefined : new URL(image, `${baseUrl}/`).href,
    };
    const content = renderPageContent(page.data, {
      registry,
      loaded,
      onBlockRendered: (definition) => {
        for (const dependency of definition.dependsOn ?? []) {
          dependencies.add(dependency);
        }
      },
      onBlockError,
    });
    // Rendering is synchronous: `complete` is final once the document is built.
    const html = renderDocument(
      head,
      themeAssets().stylesheetHref,
      content,
      readNavigation(db, DEFAULT_MENU),
    );
    return { html, complete, dependencies, expiresAt };
  }

  const app = new Hono();
  app.use(securityHeaders({ https: baseUrl.startsWith("https:") }));

  app.get("/health", (context) => {
    context.header("Cache-Control", "no-store");
    try {
      db.$client.prepare("SELECT 1").pluck().get();
      return context.json({ status: "ok" });
    } catch (error) {
      logger.error("Contrôle de santé : la base de données ne répond pas", error);
      return context.json({ status: "unavailable" }, 503);
    }
  });

  // Before the routes of the API: a write from another site never reaches them, nor does a body
  // too large for any of them (the pages, the biggest, weigh a few hundred kilobytes at most).
  app.use("/api/*", sameOriginWrites(baseUrl));
  const apiBodyLimit = bodyLimit({
    maxSize: MAX_API_BODY_BYTES,
    onError: (context) =>
      context.json(
        {
          error: `La requête est trop volumineuse (${MAX_API_BODY_BYTES / 1024 / 1024} Mo au maximum).`,
        },
        413,
      ),
  });
  // The upload of an image has its own, larger limit (`POST /api/media`).
  app.use("/api/*", (context, next) =>
    context.req.method === "POST" && context.req.path === "/api/media"
      ? next()
      : apiBodyLimit(context, next),
  );
  routes?.(app);

  app.get("/assets/:name", (context) => {
    const { stylesheet, stylesheetName } = themeAssets();
    if (context.req.param("name") !== stylesheetName) {
      return context.notFound();
    }
    return context.body(stylesheet, 200, {
      "Content-Type": "text/css; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    });
  });

  app.get("*", async (context) => {
    const url = new URL(context.req.url);
    let requested: string;
    try {
      requested = decodeURIComponent(url.pathname);
    } catch {
      // Malformed percent-encoding: no page can have this path.
      return context.notFound();
    }
    const path = normalizePagePath(requested);
    if (path !== requested) {
      return context.redirect(`${encodePagePath(path)}${url.search}`, 301);
    }

    const registry = blocks();
    syncHtmlCache(theme(), registry);
    const cached = htmlCache.get(path);
    if (cached !== undefined) {
      return sendPage(context, cached);
    }
    // Taken before the page is read: if it is invalidated while it renders, the HTML of this
    // render is served once but not cached.
    const ticket = htmlCache.ticket(path);
    const page = findPublishedPage(db, path) ?? findPostPage(db, path);
    if (page === undefined) {
      return context.notFound();
    }
    const { html, complete, dependencies, expiresAt } = await renderPage(
      path,
      page,
      renderingBlocks(registry),
      ticket,
    );
    if (complete) {
      htmlCache.set(path, html, ticket, dependencies, expiresAt);
    }
    return sendPage(context, html);
  });

  app.notFound((context) => sendHtml(context, themeAssets().notFoundHtml, 404));

  app.onError((error, context) => {
    // The raw path stays percent-encoded: a decoded line break could forge log lines.
    const { pathname } = new URL(context.req.url);
    logger.error(`Erreur en servant ${context.req.method} ${pathname}`, error);
    let html = bareServerErrorHtml;
    try {
      html = themeAssets().serverErrorHtml;
    } catch (themeError) {
      logger.error("Thème illisible : page d'erreur affichée sans feuille de style", themeError);
    }
    return sendHtml(context, html, 500);
  });

  return app;
}
