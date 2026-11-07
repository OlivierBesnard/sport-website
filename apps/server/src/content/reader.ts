import {
  type ContentReader,
  isPublicMedia,
  MAX_POSTS_PER_QUERY,
  type MediaView,
  PARTNER_LEVELS,
  type PartnerLevel,
  type PartnerView,
  type PostQuery,
  type PostSummaryView,
  type PostView,
  postPath,
} from "@sport-cms/core";
import {
  type Database,
  media,
  partners,
  postCategories,
  posts,
  type StoredVariant,
  teams,
} from "@sport-cms/db";
import { and, asc, desc, eq, inArray, type SQL } from "drizzle-orm";
import { mediaUrl } from "./media-store.js";

/*
 * Public reads of the editorial content, for the blocks and the pages of the news: published
 * news, partners of the day, media whose image rights allow it. Nothing else.
 */

type MediaRow = Pick<typeof media.$inferSelect, "id" | "alt" | "rights" | "variants">;

/** The public view of a medium, or `null` when its rights keep it off the site. */
export function mediaView(row: MediaRow | null | undefined): MediaView | null {
  if (row === null || row === undefined || !isPublicMedia(row.rights)) {
    return null;
  }
  return {
    id: row.id,
    alt: row.alt,
    variants: [...row.variants]
      .sort((a, b) => a.width - b.width)
      .map((variant: StoredVariant) => ({
        url: mediaUrl(variant.file),
        width: variant.width,
        height: variant.height,
      })),
  };
}

function mediaByIds(db: Database, ids: readonly number[]): Map<number, MediaRow> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) {
    return new Map();
  }
  const rows = db
    .select({ id: media.id, alt: media.alt, rights: media.rights, variants: media.variants })
    .from(media)
    .where(inArray(media.id, unique))
    .all();
  return new Map(rows.map((row) => [row.id, row]));
}

const postColumns = {
  id: posts.id,
  slug: posts.slug,
  title: posts.title,
  excerpt: posts.excerpt,
  body: posts.body,
  publishedAt: posts.publishedAt,
  featured: posts.featured,
  imageId: posts.imageId,
  categoryId: postCategories.id,
  categoryName: postCategories.name,
  teamId: teams.id,
  teamName: teams.name,
};

function selectPosts(db: Database, filters: SQL[], limit: number) {
  return db
    .select(postColumns)
    .from(posts)
    .leftJoin(postCategories, eq(postCategories.id, posts.categoryId))
    .leftJoin(teams, eq(teams.id, posts.teamId))
    .where(and(eq(posts.status, "published"), ...filters))
    .orderBy(desc(posts.publishedAt), desc(posts.id))
    .limit(limit)
    .all();
}

type PostRow = ReturnType<typeof selectPosts>[number];

function postView(row: PostRow, images: Map<number, MediaRow>): PostView {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    body: row.body,
    path: postPath(row.slug),
    publishedAt: row.publishedAt?.getTime() ?? 0,
    featured: row.featured,
    category:
      row.categoryId === null || row.categoryName === null
        ? null
        : { id: row.categoryId, name: row.categoryName },
    team:
      row.teamId === null || row.teamName === null ? null : { id: row.teamId, name: row.teamName },
    image: row.imageId === null ? null : mediaView(images.get(row.imageId)),
  };
}

export function readPosts(db: Database, query: PostQuery): PostSummaryView[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit), 1), MAX_POSTS_PER_QUERY);
  const filters: SQL[] = [];
  if (query.categoryId !== undefined) {
    filters.push(eq(posts.categoryId, query.categoryId));
  }
  if (query.teamId !== undefined) {
    filters.push(eq(posts.teamId, query.teamId));
  }
  if (query.featuredOnly === true) {
    filters.push(eq(posts.featured, true));
  }
  const rows = selectPosts(db, filters, limit);
  const images = mediaByIds(
    db,
    rows.flatMap((row) => (row.imageId === null ? [] : [row.imageId])),
  );
  return rows.map((row) => {
    const { body: _body, ...summary } = postView(row, images);
    return summary;
  });
}

export function readPost(db: Database, slug: string): PostView | null {
  const [row] = selectPosts(db, [eq(posts.slug, slug)], 1);
  if (row === undefined) {
    return null;
  }
  return postView(row, mediaByIds(db, row.imageId === null ? [] : [row.imageId]));
}

/** `YYYY-MM-DD` of `date` in the time zone of the server. */
export function localDay(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Midnight (server time) starting the day `day`, in epoch milliseconds. */
function startOfDay(day: string): number {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, date ?? 1).getTime();
}

function nextDay(day: string): string {
  const time = new Date(startOfDay(day));
  time.setDate(time.getDate() + 1);
  return localDay(time);
}

export function readPartners(
  db: Database,
  query: { level?: PartnerLevel },
  now: Date,
): { partners: PartnerView[]; nextChange: number | null } {
  const rows = db
    .select()
    .from(partners)
    .where(query.level === undefined ? undefined : eq(partners.level, query.level))
    .orderBy(asc(partners.position), asc(partners.name), asc(partners.id))
    .all();
  const today = localDay(now);
  let nextChange: number | null = null;
  const consider = (time: number): void => {
    if (time > now.getTime() && (nextChange === null || time < nextChange)) {
      nextChange = time;
    }
  };
  const active = rows.filter((row) => {
    if (row.startsOn !== null) {
      consider(startOfDay(row.startsOn));
    }
    if (row.endsOn !== null) {
      // Shown until the end of its last day.
      consider(startOfDay(nextDay(row.endsOn)));
    }
    return (
      (row.startsOn === null || row.startsOn <= today) &&
      (row.endsOn === null || row.endsOn >= today)
    );
  });
  const logos = mediaByIds(
    db,
    active.flatMap((row) => (row.logoId === null ? [] : [row.logoId])),
  );
  const order = (level: PartnerLevel) => PARTNER_LEVELS.indexOf(level);
  return {
    partners: active
      .sort((a, b) => order(a.level) - order(b.level))
      .map((row) => ({
        id: row.id,
        name: row.name,
        url: row.url,
        level: row.level,
        logo: row.logoId === null ? null : mediaView(logos.get(row.logoId)),
      })),
    nextChange,
  };
}

export function readMedia(db: Database, ids: readonly number[]): MediaView[] {
  const rows = mediaByIds(db, ids);
  const views: MediaView[] = [];
  for (const id of new Set(ids)) {
    const view = mediaView(rows.get(id));
    if (view !== null) {
      views.push(view);
    }
  }
  return views;
}

/** The {@link ContentReader} of the blocks, reading the database of the instance. */
export function createContentReader(
  db: Database,
  now: () => Date = () => new Date(),
): ContentReader {
  return {
    posts: async (query) => readPosts(db, query),
    post: async (slug) => readPost(db, slug),
    partners: async (query) => readPartners(db, query, now()),
    media: async (ids) => readMedia(db, ids),
  };
}
