import { safeLinkUrl } from "@sport-cms/blocks";
import { encodePagePath, normalizePagePath } from "@sport-cms/core";
import { type Database, navigation, pages } from "@sport-cms/db";
import { and, asc, eq, isNotNull, isNull } from "drizzle-orm";

/** One entry of the menu as the public site renders it. */
export interface NavigationLink {
  readonly label: string;
  /** Path of the page (`/le-club`, percent-encoded) or the safe link target. */
  readonly href: string;
}

/** Name of the menu the public site renders (the other menus arrive with later steps). */
export const DEFAULT_MENU = "main";

/**
 * The entries of a menu, in order, as links for the public site. An entry pointing at a page
 * that no longer exists or is not published (never, or unpublished since), or at a URL the site
 * refuses (`javascript:`…), is left out — no link of the menu leads to a 404 — and the menu
 * never breaks the page because of one bad entry. Only the top level is rendered for now; the
 * sub-items arrive with a later step.
 */
export function readNavigation(db: Database, menu: string): NavigationLink[] {
  const rows = db
    .select({
      label: navigation.label,
      pageId: navigation.pageId,
      url: navigation.url,
      path: pages.path,
    })
    .from(navigation)
    // Only a published page gives its path: the others leave the entry without a target.
    .leftJoin(
      pages,
      and(
        eq(navigation.pageId, pages.id),
        eq(pages.status, "published"),
        isNotNull(pages.publishedData),
      ),
    )
    .where(and(eq(navigation.menu, menu), isNull(navigation.parentId)))
    .orderBy(asc(navigation.position))
    .all();
  const links: NavigationLink[] = [];
  for (const row of rows) {
    let href: string | undefined;
    if (row.pageId !== null) {
      href =
        row.path !== null && row.path !== ""
          ? encodePagePath(normalizePagePath(row.path))
          : undefined;
    } else {
      href = safeLinkUrl(row.url);
    }
    if (href !== undefined) {
      links.push({ label: row.label, href });
    }
  }
  return links;
}
