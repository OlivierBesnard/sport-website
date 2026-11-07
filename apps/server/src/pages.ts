import { type Database, type JsonObject, pages } from "@sport-cms/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";

/** What the public site needs to render a page, all of it from its published version. */
export interface PublishedPage {
  readonly title: string;
  readonly description: string | undefined;
  /** Sharing image as written; the caller keeps it only if it is a safe image URL. */
  readonly image: string | undefined;
  /** Published content, in Puck's format. */
  readonly data: JsonObject;
}

export interface PageRow {
  readonly id: number;
  readonly path: string;
  readonly title: string;
  readonly seo: Record<string, unknown> | null;
  readonly draftData: JsonObject;
  readonly publishedData: JsonObject | null;
  readonly status: "draft" | "published";
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly publishedAt: Date | null;
}

/** Selects every column of `pages`; typed once, reused by the admin API. */
export function pageSelection() {
  return {
    id: pages.id,
    path: pages.path,
    title: pages.title,
    seo: pages.seo,
    draftData: pages.draftData,
    publishedData: pages.publishedData,
    status: pages.status,
    createdAt: pages.createdAt,
    updatedAt: pages.updatedAt,
    publishedAt: pages.publishedAt,
  };
}

export function findPageRow(db: Database, path: string): PageRow | undefined {
  return db.select(pageSelection()).from(pages).where(eq(pages.path, path)).get();
}

export function listPageRows(db: Database): PageRow[] {
  return db.select(pageSelection()).from(pages).orderBy(asc(pages.path)).all();
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
 * Title, description and sharing image come from the published snapshot only: publication
 * resolves them once and writes the result into the root fields of `published_data` (see
 * `buildPublishedSnapshot` in `pages-api.ts`) — the title from the root field, then `seo.title`,
 * then the `pages.title` column; the description and the image from the root fields, then the
 * `pages.seo` columns. A page
 * whose published data carries a non-empty `root.props.title` was published through the admin
 * API and is fully self-contained — editing the draft, its name or its SEO columns afterwards
 * never changes the public site until the next publication. Pages published before that rule
 * (data without root fields) still fall back to the columns, which are then read live: they
 * cannot be edited from the back-office anyway.
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
  if (nonEmpty(root.title) !== undefined) {
    return {
      title: nonEmpty(root.title) ?? row.title,
      description: nonEmpty(root.description),
      image: nonEmpty(root.image),
      data: row.data,
    };
  }
  // Legacy published data, without root fields: the (unversioned) columns serve as before.
  const seo: Record<string, unknown> = isRecord(row.seo) ? row.seo : {};
  return {
    title: nonEmpty(seo.title) ?? row.title,
    description: nonEmpty(root.description) ?? nonEmpty(seo.description),
    image: nonEmpty(root.image) ?? nonEmpty(seo.image),
    data: row.data,
  };
}
