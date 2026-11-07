import { safeLinkUrl } from "@sport-cms/blocks";
import { type Database, navigation, pages, writeAudit } from "@sport-cms/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Logger } from "./app.js";
import type { Auth } from "./auth/create-auth.js";
import { type ApiEnv, requirePermission } from "./auth/middlewares.js";
import { fieldsOf } from "./fields.js";
import type { HtmlCache } from "./html-cache.js";

/**
 * Admin API of the navigation menus, under `/api/navigation`, registered through the `routes`
 * hook of `createApp`. Every route requires the `pages.edit` permission: the menu shapes every
 * public page, like the pages themselves.
 *
 * `PUT` replaces the whole list of a menu (the back-office sends it as the person arranged it):
 * the items keep no identity of their own worth keeping, and `position` is the order of the
 * list. A change clears the whole HTML cache — the menu is rendered by every page — while the
 * per-page invalidations of E09 will narrow that down.
 */

const MAX_ITEMS = 50;

const menuSchema = z
  .string()
  .trim()
  .min(1, "Le nom du menu est requis.")
  .max(50, "Le nom du menu est trop long (50 caractères maximum).");

const itemSchema = z
  .looseObject({
    label: z
      .string()
      .trim()
      .min(1, "Le libellé d'une entrée est requis.")
      .max(100, "Le libellé d'une entrée est trop long (100 caractères maximum)."),
    pageId: z.number().int().positive().optional(),
    url: z
      .string()
      .max(2000, "L'adresse du lien est trop longue (2000 caractères maximum).")
      .optional(),
  })
  .refine((item) => (item.pageId === undefined) !== (item.url === undefined), {
    message: "Chaque entrée pointe soit vers une page, soit vers un lien externe.",
  });

const putSchema = z.object({
  menu: menuSchema,
  items: z.array(itemSchema).max(MAX_ITEMS, `Le menu est limité à ${MAX_ITEMS} entrées.`),
});

const LINK_MESSAGE =
  "L'adresse du lien est invalide : utilisez une adresse https://, un e-mail (mailto:), " +
  "un numéro (tel:) ou un chemin de la forme /mon-lien.";

/** One entry of a menu, as the back-office sent it and with the page path resolved. */
export interface NavigationItemView {
  readonly id: number;
  readonly label: string;
  readonly pageId: number | null;
  /** Public path of the page the entry points at, when it points at one. */
  readonly path: string | null;
  /** External target as written, when the entry is an external link. */
  readonly url: string | null;
}

export function navigationItems(db: Database, menu: string): NavigationItemView[] {
  const rows = db
    .select({
      id: navigation.id,
      label: navigation.label,
      pageId: navigation.pageId,
      url: navigation.url,
      position: navigation.position,
      path: pages.path,
    })
    .from(navigation)
    .leftJoin(pages, eq(navigation.pageId, pages.id))
    .where(eq(navigation.menu, menu))
    .all();
  return rows
    .sort((a, b) => a.position - b.position)
    .map((row) => ({
      id: row.id,
      label: row.label,
      pageId: row.pageId,
      path: row.pageId === null ? null : (row.path ?? null),
      url: row.url,
    }));
}

export interface NavigationApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  /** Cache of the public site, cleared here: the menu is part of every page. */
  readonly htmlCache: HtmlCache;
  readonly logger?: Logger;
  readonly audit?: typeof writeAudit;
}

export function navigationApiRoutes({
  auth,
  db,
  htmlCache,
  logger = console,
  audit = writeAudit,
}: NavigationApiDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "pages.edit"));

  api.get("/", (context) => {
    const menu = menuSchema.safeParse(context.req.query("menu") ?? "main");
    if (!menu.success) {
      return context.json(
        { error: "Requête invalide.", fields: { menu: "Le nom du menu est invalide." } },
        400,
      );
    }
    return context.json({ menu: menu.data, items: navigationItems(db, menu.data) });
  });

  api.put("/", async (context) => {
    const raw = await context.req.json().catch(() => undefined);
    const parsed = putSchema.safeParse(raw);
    if (!parsed.success) {
      return context.json({ error: "Requête invalide.", fields: fieldsOf(parsed.error) }, 400);
    }
    const { menu, items } = parsed.data;
    for (const [index, item] of items.entries()) {
      if (item.pageId !== undefined) {
        const page = db.select({ id: pages.id }).from(pages).where(eq(pages.id, item.pageId)).get();
        if (page === undefined) {
          return context.json(
            {
              error: "Requête invalide.",
              fields: { [`items.${index}.pageId`]: "Cette page n'existe pas." },
            },
            400,
          );
        }
      } else if (safeLinkUrl(item.url) === undefined) {
        return context.json(
          { error: "Requête invalide.", fields: { [`items.${index}.url`]: LINK_MESSAGE } },
          400,
        );
      }
    }
    try {
      db.transaction(() => {
        db.delete(navigation).where(eq(navigation.menu, menu)).run();
        if (items.length > 0) {
          db.insert(navigation)
            .values(
              items.map((item, position) => ({
                menu,
                position,
                label: item.label,
                pageId: item.pageId ?? null,
                url: item.url ?? null,
              })),
            )
            .run();
        }
        audit(db, {
          actorId: context.get("user").id,
          action: "navigation.updated",
          targetType: "navigation",
          targetId: menu,
          details: { items: items.length },
        });
      });
    } catch (error) {
      logger.error(`Échec de l'enregistrement du menu ${menu}`, error);
      return context.json({ error: "L'enregistrement du menu a échoué. Réessayez." }, 500);
    }
    // The menu shows on every page: the whole cache is stale, whatever page was re-rendered.
    htmlCache.clear();
    return context.json({ menu, items: navigationItems(db, menu) });
  });

  return (app) => {
    app.route("/api/navigation", api);
  };
}
