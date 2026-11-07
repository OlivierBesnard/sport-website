import type { BlockRegistry } from "@sport-cms/blocks";
import { normalizePagePath } from "@sport-cms/core";
import {
  type Database,
  emitEvent,
  type JsonObject,
  navigation,
  type PageSeo,
  pages,
  pageVersions,
  writeAudit,
} from "@sport-cms/db";
import { and, eq, sql } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import type { Logger } from "./app.js";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requirePermission } from "./auth/middlewares.js";
import { fieldsOf } from "./fields.js";
import type { HtmlCache } from "./html-cache.js";
import { countLevel1Headings, findContentIssues } from "./page-content.js";
import { findPageRow, listPageRows, type PageRow, pageSelection } from "./pages.js";

/**
 * Admin API of the pages, under `/api/pages`, registered through the `routes` hook of
 * `createApp` (matched before the public site). Every route requires the `pages.edit`
 * permission. The editing routes touch the draft only: the public site keeps serving the
 * published version until `POST /api/pages/publish` copies it over, with its root fields
 * resolved (title, description, image) and a new row in `page_versions`.
 *
 * The URL path names the action, the `path` query parameter names the page: `GET|PUT|DELETE
 * /api/pages/page?path=/le-club`, `GET /api/pages/versions?path=…`, `POST
 * /api/pages/{publish,unpublish,restore,rename}?path=…`. No page path can be mistaken for an
 * action (`/publish`, `/equipe/versions` are ordinary pages) and the home page `/` is
 * `?path=%2F`.
 */

/** First path segments the instance serves itself: a page can never take them. */
const RESERVED_PREFIXES = ["health", "assets", "admin", "api", "hooks", "media"] as const;

const RESERVED_MESSAGE =
  "Ce chemin est réservé aux pages internes de l'instance : choisissez-en un autre.";

/** Whether `path` (canonical form) is one of the reserved paths or inside one of them. */
export function isReservedPagePath(path: string): boolean {
  return RESERVED_PREFIXES.some(
    (segment) => path === `/${segment}` || path.startsWith(`/${segment}/`),
  );
}

const titleSchema = z
  .string()
  .trim()
  .min(1, "Le titre de la page est requis.")
  .max(200, "Le titre de la page est trop long (200 caractères maximum).");

const pathSchema = z
  .string()
  .max(2000, "Le chemin de la page est trop long (2000 caractères maximum).");

const seoSchema = z.object({
  title: z
    .string()
    .max(200, "Le titre de référencement est trop long (200 caractères maximum).")
    .optional(),
  description: z
    .string()
    .max(500, "La description est trop longue (500 caractères maximum).")
    .optional(),
  image: z
    .string()
    .max(2000, "L'adresse de l'image de partage est trop longue (2000 caractères maximum).")
    .optional(),
});

const componentSchema = z.looseObject({
  type: z.string().min(1, "Chaque bloc doit avoir un type."),
  props: z.record(z.string(), z.unknown()),
});

const pageDataSchema = z.looseObject({
  root: z.looseObject({ props: z.record(z.string(), z.unknown()) }).default({ props: {} }),
  content: z.array(componentSchema).default([]),
  zones: z.record(z.string(), z.array(componentSchema)).optional(),
});

const createSchema = z.object({ path: pathSchema, title: titleSchema });

const updateSchema = z.object({
  data: pageDataSchema,
  title: titleSchema.optional(),
  seo: seoSchema.optional(),
});

const renameSchema = z.object({ path: pathSchema });

const restoreSchema = z.object({ version: z.number().int().min(1) });

const PAGE_NOT_FOUND = "Page introuvable.";

/** Prefix of every route of this API. */
const PREFIX = "/api/pages";

const MISSING_PATH = "Le chemin de la page est requis (paramètre « path »).";

/** Content of a page before anything is published: an empty page to fill in the editor. */
function emptyDraft(): JsonObject {
  return { root: { props: {} }, content: [], zones: {} };
}

/** The page as the back-office sees it: metadata first, dates as epoch milliseconds. */
function pageView(row: PageRow) {
  return {
    id: row.id,
    path: row.path,
    title: row.title,
    seo: row.seo,
    status: row.status,
    published: row.status === "published" && row.publishedData !== null,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
    publishedAt: row.publishedAt === null ? null : row.publishedAt.getTime(),
  };
}

function notFound(context: Context<ApiEnv>): Response {
  return context.json({ error: PAGE_NOT_FOUND }, 404);
}

/** Invalid body: the fields carry the first French message of each offending path. */
function invalid(context: Context<ApiEnv>, error: z.ZodError): Response {
  return context.json({ error: "Requête invalide.", fields: fieldsOf(error) }, 400);
}

/**
 * The page a request targets, from its `path` query parameter (percent-decoded by Hono, then
 * put in canonical form) — never from the URL path, which names the action: a page may be called
 * `/publish` or `/equipe/versions`, and the home page `/` needs no special case. Answers the
 * error response (400 without the parameter, 404 without such a page) when there is no page.
 */
function targetPage(
  context: Context<ApiEnv>,
  db: Database,
): { readonly row: PageRow; readonly path: string } | Response {
  const raw = context.req.query("path");
  if (raw === undefined) {
    return context.json({ error: MISSING_PATH, fields: { path: MISSING_PATH } }, 400);
  }
  const path = normalizePagePath(raw);
  const row = findPageRow(db, path);
  return row === undefined ? notFound(context) : { row, path };
}

/** Whether a menu entry points at the page: its link is then part of every public page. */
function inAnyMenu(db: Database, pageId: number): boolean {
  return (
    db
      .select({ id: navigation.id })
      .from(navigation)
      .where(eq(navigation.pageId, pageId))
      .limit(1)
      .get() !== undefined
  );
}

/** The SEO columns of a page row, as a plain object. */
function seoOf(row: { seo: unknown }): PageSeo {
  const seo: Record<string, unknown> =
    typeof row.seo === "object" && row.seo !== null && !Array.isArray(row.seo)
      ? (row.seo as Record<string, unknown>)
      : {};
  return {
    title: typeof seo.title === "string" ? seo.title : undefined,
    description: typeof seo.description === "string" ? seo.description : undefined,
    image: typeof seo.image === "string" ? seo.image : undefined,
  };
}

/**
 * The published snapshot of the draft: the data as stored, with its root fields made complete
 * and final. The title always gets a value (root field, then the SEO title column `seo.title`,
 * then the page name — the precedence the public site applied to the columns before); the
 * description and the sharing image are resolved from the root fields, then the SEO columns,
 * and dropped when nowhere to be found. From then on the public site reads the snapshot alone: editing the
 * draft, the name or the columns does not change anything until the next publication.
 */
export function buildPublishedSnapshot(
  data: JsonObject,
  fallbackTitle: string,
  seo: PageSeo,
): JsonObject {
  const snapshot = structuredClone(data);
  if (typeof snapshot.root !== "object" || snapshot.root === null || Array.isArray(snapshot.root)) {
    snapshot.root = { props: {} };
  }
  const root = snapshot.root as { props?: unknown };
  if (typeof root.props !== "object" || root.props === null || Array.isArray(root.props)) {
    root.props = {};
  }
  const props = root.props as Record<string, unknown>;
  const storedTitle = props.title;
  const seoTitle = seo.title?.trim();
  props.title =
    typeof storedTitle === "string" && storedTitle.trim() !== ""
      ? storedTitle.trim()
      : seoTitle !== undefined && seoTitle !== ""
        ? seoTitle
        : fallbackTitle;
  const resolve = (key: "description" | "image"): void => {
    const stored = props[key];
    const fromRoot = typeof stored === "string" && stored.trim() !== "" ? stored.trim() : undefined;
    const fromSeo = seo[key];
    const value = fromRoot ?? fromSeo;
    if (value === undefined) {
      delete props[key];
    } else {
      props[key] = value;
    }
  };
  resolve("description");
  resolve("image");
  return snapshot;
}

export interface PagesApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  /** Blocks that can be rendered, the same registry the public site renders with. */
  readonly blocks: () => BlockRegistry;
  /** Cache of the public site, invalidated here when a published page changes. */
  readonly htmlCache: HtmlCache;
  readonly logger?: Logger;
  readonly audit?: typeof writeAudit;
}

export function pagesApiRoutes({
  auth,
  db,
  blocks,
  htmlCache,
  logger = console,
  audit = writeAudit,
}: PagesApiDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "pages.edit"));

  api.get("/", (context) => {
    return context.json({ pages: listPageRows(db).map(pageView) });
  });

  api.post("/", async (context) => {
    const parsed = createSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return invalid(context, parsed.error);
    }
    const path = normalizePagePath(parsed.data.path);
    if (isReservedPagePath(path)) {
      return context.json({ error: RESERVED_MESSAGE, fields: { path: RESERVED_MESSAGE } }, 400);
    }
    if (findPageRow(db, path) !== undefined) {
      const message = "Une page existe déjà à ce chemin.";
      return context.json({ error: message, fields: { path: message } }, 409);
    }
    const row = db
      .insert(pages)
      .values({ path, title: parsed.data.title, draftData: emptyDraft(), publishedData: null })
      .returning(pageSelection())
      .get();
    return context.json({ ...pageView(row), draftData: row.draftData }, 201);
  });

  /** The content problems that stop a save or a publication, as `{ block path: message }`. */
  function contentIssueFields(data: JsonObject): Record<string, string> {
    const fields: Record<string, string> = {};
    for (const issue of findContentIssues(data, blocks())) {
      if (fields[issue.path] === undefined) {
        fields[issue.path] = issue.message;
      }
    }
    return fields;
  }

  /**
   * Clears what the public site may show of the page at `paths`: the cache entries of those
   * paths, or the whole cache when a menu points at the page — its link (path, presence) is then
   * rendered on every page, which the per-page dependencies of E09 will narrow down.
   */
  function invalidatePage(pageId: number, ...paths: string[]): void {
    if (inAnyMenu(db, pageId)) {
      htmlCache.clear();
      return;
    }
    for (const path of paths) {
      htmlCache.invalidate(path);
    }
  }

  api.get("/page", (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    return context.json({ ...pageView(target.row), draftData: target.row.draftData });
  });

  api.put("/page", async (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    const parsed = updateSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return invalid(context, parsed.error);
    }
    // Normalized form of the data: `zones` exists as soon as it is stored, the root keeps its
    // props only. Unknown keys of a component are kept (`looseObject`): a newer editor must be
    // able to store what an older one ignores.
    const data = JSON.parse(
      JSON.stringify({
        root: { props: parsed.data.data.root.props },
        content: parsed.data.data.content,
        zones: parsed.data.data.zones ?? {},
      }),
    ) as JsonObject;
    const fields = contentIssueFields(data);
    if (Object.keys(fields).length > 0) {
      return context.json(
        { error: "Le brouillon contient des problèmes à corriger.", fields },
        400,
      );
    }
    db.update(pages)
      .set({
        draftData: data,
        ...(parsed.data.title === undefined ? {} : { title: parsed.data.title }),
        ...(parsed.data.seo === undefined ? {} : { seo: parsed.data.seo }),
      })
      .where(eq(pages.id, row.id))
      .run();
    // The draft is not the public site: nothing to invalidate here.
    const updated = findPageRow(db, path);
    if (updated === undefined) {
      return notFound(context);
    }
    return context.json({ ...pageView(updated), draftData: updated.draftData });
  });

  api.delete("/page", (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    // Read before the deletion, which unlinks the menu entries.
    const linked = inAnyMenu(db, row.id);
    try {
      db.transaction(() => {
        db.delete(pages).where(eq(pages.id, row.id)).run();
        audit(db, {
          actorId: context.get("user").id,
          action: "pages.deleted",
          targetType: "page",
          targetId: row.path,
          details: { title: row.title, published: row.status === "published" },
        });
      });
    } catch (error) {
      logger.error(`Échec de la suppression de la page ${row.path}`, error);
      return context.json({ error: "La suppression a échoué. Réessayez." }, 500);
    }
    if (linked) {
      htmlCache.clear();
    } else {
      htmlCache.invalidate(path);
    }
    return context.body(null, 204);
  });

  api.get("/versions", (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const rows = db
      .select({
        version: pageVersions.version,
        title: pageVersions.title,
        createdAt: pageVersions.createdAt,
      })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, target.row.id))
      .orderBy(sql`${pageVersions.version} desc`)
      .all();
    return context.json({
      versions: rows.map((version) => ({
        version: version.version,
        title: version.title,
        createdAt: version.createdAt.getTime(),
      })),
    });
  });

  api.post("/publish", (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    const fields = contentIssueFields(row.draftData);
    if (Object.keys(fields).length > 0) {
      return context.json(
        {
          error: "La page ne peut pas être publiée : corrigez d'abord les blocs signalés.",
          fields,
        },
        400,
      );
    }
    const headings = countLevel1Headings(row.draftData, blocks());
    if (headings !== 1) {
      const message =
        headings === 0
          ? "La page doit contenir exactement un titre de niveau 1 : ajoutez un bloc « Titre » de niveau 1, ou une « Bannière d'accueil » avec un titre."
          : `La page doit contenir exactement un titre de niveau 1 : ${headings} titres de niveau 1 ont été trouvés, n'en gardez qu'un.`;
      return context.json({ error: message, fields: {} }, 400);
    }
    const seo = seoOf(row);
    const snapshot = buildPublishedSnapshot(row.draftData, row.title, seo);
    const snapshotRoot = snapshot.root as { props?: Record<string, unknown> };
    const versionTitle =
      typeof snapshotRoot.props?.title === "string" ? snapshotRoot.props.title : row.title;
    const lastVersion = db
      .select({ version: pageVersions.version })
      .from(pageVersions)
      .where(eq(pageVersions.pageId, row.id))
      .orderBy(sql`${pageVersions.version} desc`)
      .limit(1)
      .get();
    const version = (lastVersion?.version ?? 0) + 1;
    try {
      db.transaction(() => {
        db.update(pages)
          .set({ publishedData: snapshot, status: "published", publishedAt: new Date() })
          .where(eq(pages.id, row.id))
          .run();
        db.insert(pageVersions)
          .values({
            pageId: row.id,
            version,
            title: versionTitle,
            seo: { title: seo.title, description: seo.description, image: seo.image },
            data: snapshot,
          })
          .run();
        audit(db, {
          actorId: context.get("user").id,
          action: "pages.published",
          targetType: "page",
          targetId: row.path,
          details: { version },
        });
        // In the same transaction (outbox): the event exists if and only if the publication does.
        emitEvent(db, {
          type: "page.published",
          source: "core",
          payload: { pageId: row.id, path: row.path, version },
        });
      });
    } catch (error) {
      logger.error(`Échec de la publication de la page ${row.path}`, error);
      return context.json({ error: "La publication a échoué. Réessayez." }, 500);
    }
    if (row.status === "published" && row.publishedData !== null) {
      // Already on the site: its menu links are unchanged, only the page itself is stale.
      htmlCache.invalidate(path);
    } else {
      // A first publication (or one after unpublishing) brings its menu entries back.
      invalidatePage(row.id, path);
    }
    const updated = findPageRow(db, path);
    return updated === undefined
      ? notFound(context)
      : context.json({ ...pageView(updated), version });
  });

  api.post("/unpublish", (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    if (row.status !== "published") {
      return context.json({ error: "Cette page n'est pas publiée." }, 409);
    }
    try {
      db.transaction(() => {
        db.update(pages).set({ status: "draft" }).where(eq(pages.id, row.id)).run();
        audit(db, {
          actorId: context.get("user").id,
          action: "pages.unpublished",
          targetType: "page",
          targetId: row.path,
        });
      });
    } catch (error) {
      logger.error(`Échec de la dépublication de la page ${row.path}`, error);
      return context.json({ error: "La dépublication a échoué. Réessayez." }, 500);
    }
    // Its menu entries disappear from every page.
    invalidatePage(row.id, path);
    const updated = findPageRow(db, path);
    return updated === undefined ? notFound(context) : context.json(pageView(updated));
  });

  api.post("/restore", async (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    const parsed = restoreSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return invalid(context, parsed.error);
    }
    const versionRow = db
      .select()
      .from(pageVersions)
      .where(and(eq(pageVersions.pageId, row.id), eq(pageVersions.version, parsed.data.version)))
      .get();
    if (versionRow === undefined) {
      return context.json({ error: "Cette version n'existe pas." }, 404);
    }
    try {
      db.transaction(() => {
        db.update(pages).set({ draftData: versionRow.data }).where(eq(pages.id, row.id)).run();
        audit(db, {
          actorId: context.get("user").id,
          action: "pages.restored",
          targetType: "page",
          targetId: row.path,
          details: { version: versionRow.version },
        });
      });
    } catch (error) {
      logger.error(`Échec de la restauration de la page ${row.path}`, error);
      return context.json({ error: "La restauration a échoué. Réessayez." }, 500);
    }
    // Only the draft changed: the public site keeps the published version.
    const updated = findPageRow(db, path);
    return updated === undefined
      ? notFound(context)
      : context.json({ ...pageView(updated), draftData: updated.draftData });
  });

  api.post("/rename", async (context) => {
    const target = targetPage(context, db);
    if (target instanceof Response) {
      return target;
    }
    const { row, path } = target;
    const parsed = renameSchema.safeParse(await context.req.json().catch(() => undefined));
    if (!parsed.success) {
      return invalid(context, parsed.error);
    }
    const newPath = normalizePagePath(parsed.data.path);
    if (isReservedPagePath(newPath)) {
      return context.json({ error: RESERVED_MESSAGE, fields: { path: RESERVED_MESSAGE } }, 400);
    }
    if (newPath === path) {
      const message = "La page est déjà à ce chemin.";
      return context.json({ error: message, fields: { path: message } }, 400);
    }
    if (findPageRow(db, newPath) !== undefined) {
      const message = "Une page existe déjà à ce chemin.";
      return context.json({ error: message, fields: { path: message } }, 409);
    }
    try {
      db.transaction(() => {
        db.update(pages).set({ path: newPath }).where(eq(pages.id, row.id)).run();
        audit(db, {
          actorId: context.get("user").id,
          action: "pages.renamed",
          targetType: "page",
          targetId: row.path,
          details: { from: row.path, to: newPath },
        });
      });
    } catch (error) {
      logger.error(`Échec du renommage de la page ${row.path}`, error);
      return context.json({ error: "Le renommage a échoué. Réessayez." }, 500);
    }
    // The menu links to the page follow the new path on every page.
    invalidatePage(row.id, path, newPath);
    const updated = findPageRow(db, newPath);
    return updated === undefined ? notFound(context) : context.json(pageView(updated));
  });

  return (app) => {
    app.route(PREFIX, api);
  };
}
