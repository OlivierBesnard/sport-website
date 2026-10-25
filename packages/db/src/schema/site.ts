import {
  type AnySQLiteColumn,
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import type { JsonObject, StoredJson } from "../json.js";
import { createdAt, timestamp, updatedAt } from "./columns.js";

/** Instance settings (club identity, domain, theme, email…): one JSON value per key. */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<StoredJson>().notNull(),
  updatedAt: updatedAt(),
});

export const PAGE_STATUSES = ["draft", "published"] as const;
/** `draft`: not visible on the public site; `published`: `published_data` is served. */
export type PageStatus = (typeof PAGE_STATUSES)[number];

/** Search engine and social sharing metadata of a page. */
export type PageSeo = {
  /** Replaces the page title in `<title>` and OpenGraph. */
  title?: string;
  description?: string;
  /** Image shared on social networks (OpenGraph). */
  image?: string;
};

/**
 * Site pages. Content is a JSON tree of blocks (Puck format), kept twice: the draft being
 * edited and the published copy served to visitors (`NULL` until the first publication).
 */
export const pages = sqliteTable("pages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** Public path, unique and case-sensitive (e.g. `/`, `/equipes/u13`). */
  path: text("path").notNull().unique(),
  title: text("title").notNull(),
  seo: text("seo", { mode: "json" }).$type<PageSeo>().notNull().default({}),
  draftData: text("draft_data", { mode: "json" }).$type<JsonObject>().notNull(),
  publishedData: text("published_data", { mode: "json" }).$type<JsonObject>(),
  status: text("status", { enum: PAGE_STATUSES }).notNull().default("draft"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  publishedAt: timestamp("published_at"),
});

/** Snapshots of a page, numbered from 1 for each page, deleted with the page. */
export const pageVersions = sqliteTable(
  "page_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    pageId: integer("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    seo: text("seo", { mode: "json" }).$type<PageSeo>().notNull(),
    data: text("data", { mode: "json" }).$type<JsonObject>().notNull(),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("page_versions_page_id_version_unique").on(table.pageId, table.version)],
);

/**
 * Items of the site menus, as a tree: `parent_id` is `NULL` at the top level and `position`
 * orders siblings. An item links to a page or to a URL; without either it only groups its
 * children. Deleting a page keeps its items (and their children) but unlinks them.
 */
export const navigation = sqliteTable(
  "navigation",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Menu the item belongs to (`main`, `footer`…). */
    menu: text("menu").notNull().default("main"),
    parentId: integer("parent_id").references((): AnySQLiteColumn => navigation.id, {
      onDelete: "cascade",
    }),
    position: integer("position").notNull().default(0),
    label: text("label").notNull(),
    pageId: integer("page_id").references(() => pages.id, { onDelete: "set null" }),
    url: text("url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("navigation_menu_parent_id_position_idx").on(table.menu, table.parentId, table.position),
    index("navigation_parent_id_idx").on(table.parentId),
    index("navigation_page_id_idx").on(table.pageId),
  ],
);
