import { type Database, type JsonObject, pages } from "@sport-cms/db";
import { and, eq, isNotNull } from "drizzle-orm";

/** What the public site needs to render a page, all of it from its published version. */
export interface PublishedPage {
  readonly title: string;
  readonly description: string | undefined;
  /** Sharing image as written; the caller keeps it only if it is a safe image URL. */
  readonly image: string | undefined;
  /** Published content, in Puck's format. */
  readonly data: JsonObject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Props of the root of page data (Puck's `root.props`), or none when the data has no such object. */
function rootProps(data: unknown): Record<string, unknown> {
  if (isRecord(data) && isRecord(data.root) && isRecord(data.root.props)) {
    return data.root.props;
  }
  return {};
}

/**
 * The published version of the page at `path` (canonical form), or `undefined` when no page is
 * there or when it is not published: never published, or unpublished since.
 *
 * Title, description and sharing image are those of the published version: the root fields of
 * its data (`root.props.title`, `description`, `image`), so that editing the draft never changes
 * the public site. When one is missing or not a non-empty string, the `seo` column is used, then
 * the page name (`pages.title`) for the title. Unlike the root fields, those columns are not
 * versioned: they are read live, so editing them in the back-office changes the public site
 * without publishing; they only serve as a fallback for pages without root fields.
 */
export function findPublishedPage(db: Database, path: string): PublishedPage | undefined {
  const row = db
    .select({ title: pages.title, seo: pages.seo, data: pages.publishedData })
    .from(pages)
    .where(and(eq(pages.path, path), eq(pages.status, "published"), isNotNull(pages.publishedData)))
    .get();
  if (row?.data == null) {
    return undefined;
  }
  const root = rootProps(row.data);
  // Raw SQL may have left something else than an object (JSON `null`, a string, a list).
  const seo: Record<string, unknown> = isRecord(row.seo) ? row.seo : {};
  return {
    title: nonEmpty(root.title) ?? nonEmpty(seo.title) ?? row.title,
    description: nonEmpty(root.description) ?? nonEmpty(seo.description),
    image: nonEmpty(root.image) ?? nonEmpty(seo.image),
    data: row.data,
  };
}
