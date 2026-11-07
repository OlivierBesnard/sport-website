import type { NamedRef } from "./sport.js";

/**
 * Editorial content of the core (PLAN §3.3): media, news, partners. Shapes shared by the server,
 * the back-office and the blocks; free of Node.js built-ins (root entry).
 */

/**
 * Image rights of a medium (PLAN §8.1): whether recognizable people appear on it, and whether
 * their authorization was checked. An `unverified` medium never reaches the public site.
 */
export const MEDIA_RIGHTS = ["none", "authorized", "unverified"] as const;
export type MediaRights = (typeof MEDIA_RIGHTS)[number];
export const MEDIA_RIGHTS_LABELS: Readonly<Record<MediaRights, string>> = {
  none: "Aucune personne reconnaissable",
  authorized: "Personnes reconnaissables, autorisations vérifiées",
  unverified: "Personnes reconnaissables, autorisations non vérifiées (non publiée)",
};

/** Whether a medium with these rights may be shown to visitors. */
export function isPublicMedia(rights: MediaRights): boolean {
  return rights !== "unverified";
}

export const PARTNER_LEVELS = ["gold", "silver", "bronze", "other"] as const;
export type PartnerLevel = (typeof PARTNER_LEVELS)[number];
export const PARTNER_LEVEL_LABELS: Readonly<Record<PartnerLevel, string>> = {
  gold: "Partenaires or",
  silver: "Partenaires argent",
  bronze: "Partenaires bronze",
  other: "Partenaires",
};

/** Path under which each published news item gets its own page: `/actualites/<slug>`. */
export const POSTS_PATH_PREFIX = "/actualites";

/** Public path of a news item. */
export function postPath(slug: string): string {
  return `${POSTS_PATH_PREFIX}/${slug}`;
}

/** A slug: lowercase words of letters and digits joined by `-`. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One image size of a medium, served by the instance (`/media/<file>`). */
export interface MediaVariant {
  readonly url: string;
  readonly width: number;
  readonly height: number;
}

/** An image ready for a public page: its sizes (smallest first) and its alternative text. */
export interface MediaView {
  readonly id: number;
  readonly alt: string;
  readonly variants: readonly MediaVariant[];
}

export interface PostSummaryView {
  readonly id: number;
  readonly slug: string;
  readonly title: string;
  readonly excerpt: string;
  /** `/actualites/<slug>`. */
  readonly path: string;
  /** Epoch milliseconds. */
  readonly publishedAt: number;
  readonly featured: boolean;
  readonly category: NamedRef | null;
  readonly team: NamedRef | null;
  /** `null` without image, or when the image may not be shown (rights not checked). */
  readonly image: MediaView | null;
}

export interface PostView extends PostSummaryView {
  /** Plain text, paragraphs separated by blank lines. */
  readonly body: string;
}

export interface PartnerView {
  readonly id: number;
  readonly name: string;
  /** Site of the partner, as typed (checked by the block before it becomes a link). */
  readonly url: string;
  readonly level: PartnerLevel;
  readonly logo: MediaView | null;
}

export interface PostQuery {
  readonly limit: number;
  readonly categoryId?: number;
  readonly teamId?: number;
  readonly featuredOnly?: boolean;
}

/**
 * Read access to the editorial content, for the blocks: published news, partners of the day,
 * media whose rights allow it. What any visitor may see, nothing else.
 */
export interface ContentReader {
  /** Published news, latest first. */
  posts(query: PostQuery): Promise<readonly PostSummaryView[]>;
  /** A published news item; `null` when unknown or not published. */
  post(slug: string): Promise<PostView | null>;
  /**
   * Partners whose period includes the day of `now` (in the server's time zone), by level then
   * position; `nextChange` is the next start or end of a period, to render the page again then.
   */
  partners(query: {
    readonly level?: PartnerLevel;
  }): Promise<{ readonly partners: readonly PartnerView[]; readonly nextChange: number | null }>;
  /** Media of `ids` that may be shown, in the order of `ids`. */
  media(ids: readonly number[]): Promise<readonly MediaView[]>;
}

/** Most news a block may list. */
export const MAX_POSTS_PER_QUERY = 24;
