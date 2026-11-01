import { createHash, type KeyObject } from "node:crypto";
import {
  type BlockRegistry,
  coreBlocks,
  createBlockRegistry,
  safeImageUrl,
} from "@sport-cms/blocks";
import { renderPageContent } from "@sport-cms/blocks/server";
import { encodePagePath, normalizePagePath } from "@sport-cms/core";
import type { Database } from "@sport-cms/db";
import { buildThemeCss, defaultTheme, type ThemeTokens } from "@sport-cms/themes";
import { type Context, Hono } from "hono";
import { HtmlCache } from "./html-cache.js";
import { findPublishedPage, type PublishedPage } from "./pages.js";
import {
  type PageHead,
  renderDocument,
  renderNotFoundPage,
  renderServerErrorPage,
} from "./render/document.js";
import { securityHeaders } from "./security-headers.js";

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
  function renderPage(
    path: string,
    page: PublishedPage,
    registry: BlockRegistry,
  ): { html: string; complete: boolean } {
    let complete = true;
    const image = safeImageUrl(page.image);
    const head: PageHead = {
      title: page.title,
      description: page.description,
      canonicalUrl: `${baseUrl}${encodePagePath(path)}`,
      imageUrl: image === undefined ? undefined : new URL(image, `${baseUrl}/`).href,
    };
    const content = renderPageContent(page.data, {
      registry,
      onBlockError: (error, block) => {
        complete = false;
        logger.error(`Bloc « ${block.type} » (${block.id}) non affiché sur la page ${path}`, error);
      },
    });
    // Rendering is synchronous: `complete` is final once the document is built.
    const html = renderDocument(head, themeAssets().stylesheetHref, content);
    return { html, complete };
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

  app.get("*", (context) => {
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
      return sendHtml(context, cached);
    }
    const page = findPublishedPage(db, path);
    if (page === undefined) {
      return context.notFound();
    }
    const { html, complete } = renderPage(path, page, registry);
    if (complete) {
      htmlCache.set(path, html);
    }
    return sendHtml(context, html);
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
