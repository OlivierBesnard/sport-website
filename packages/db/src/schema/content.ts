import { MEDIA_RIGHTS, type MediaRights, PARTNER_LEVELS, type PartnerLevel } from "@sport-cms/core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns.js";
import { calendarEvents, teams } from "./sport.js";

/*
 * Editorial content (PLAN §3.3, §6.6): media, news and their categories, partners. Deleting a
 * medium, a category, a team or a match only unlinks what pointed at it.
 */

/** One stored size of an image: a WebP file of `DATA_DIR/media`. */
export type StoredVariant = { file: string; width: number; height: number };

/**
 * Uploaded images. The original is never kept: it is decoded, turned upright, stripped of its
 * metadata (location, device) and stored as a few WebP sizes (`variants`, smallest first).
 */
export const media = sqliteTable("media", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  /** File name as uploaded, shown in the back-office only. */
  originalName: text("original_name").notNull(),
  /** Real type of the upload, read from its bytes (`image/jpeg`…). */
  mimeType: text("mime_type").notNull(),
  /** Size of the upload, in bytes. */
  size: integer("size").notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  variants: text("variants", { mode: "json" }).$type<StoredVariant[]>().notNull(),
  alt: text("alt").notNull().default(""),
  /** Image rights: an `unverified` medium is never shown on the public site. */
  rights: text("rights", { enum: MEDIA_RIGHTS }).notNull().$type<MediaRights>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const postCategories = sqliteTable("post_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const POST_STATUSES = ["draft", "published"] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** News; each published one has its own page at `/actualites/<slug>`. */
export const posts = sqliteTable(
  "posts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    excerpt: text("excerpt").notNull().default(""),
    /** Plain text, paragraphs separated by blank lines. */
    body: text("body").notNull().default(""),
    categoryId: integer("category_id").references(() => postCategories.id, {
      onDelete: "set null",
    }),
    imageId: integer("image_id").references(() => media.id, { onDelete: "set null" }),
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    matchId: integer("match_id").references(() => calendarEvents.id, { onDelete: "set null" }),
    featured: integer("featured", { mode: "boolean" }).notNull().default(false),
    status: text("status", { enum: POST_STATUSES }).notNull().default("draft"),
    /** Set at the first publication, kept afterwards (the date the news shows). */
    publishedAt: timestamp("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("posts_status_published_at_idx").on(table.status, table.publishedAt),
    index("posts_category_id_idx").on(table.categoryId),
    index("posts_image_id_idx").on(table.imageId),
    index("posts_team_id_idx").on(table.teamId),
    index("posts_match_id_idx").on(table.matchId),
  ],
);

/** Partners and sponsors, shown during their period (`YYYY-MM-DD` days, both ends included). */
export const partners = sqliteTable(
  "partners",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    url: text("url").notNull().default(""),
    logoId: integer("logo_id").references(() => media.id, { onDelete: "set null" }),
    level: text("level", { enum: PARTNER_LEVELS }).notNull().default("other").$type<PartnerLevel>(),
    startsOn: text("starts_on"),
    endsOn: text("ends_on"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("partners_logo_id_idx").on(table.logoId)],
);
