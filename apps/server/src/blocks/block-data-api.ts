import {
  MAX_MATCHES_PER_QUERY,
  MAX_POSTS_PER_QUERY,
  MEDIA_RIGHTS_LABELS,
  PARTNER_LEVELS,
} from "@sport-cms/core";
import {
  type Database,
  media,
  postCategories,
  seasons,
  sections,
  teams,
  venues,
} from "@sport-cms/db";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Auth } from "../auth/create-auth.js";
import { type ApiEnv, requirePermission } from "../auth/middlewares.js";
import { readMedia, readPartners, readPost, readPosts } from "../content/reader.js";
import {
  readMatches,
  readTeam,
  readTeams,
  readTrainingSlots,
  readVenues,
} from "../sport/reader.js";

/**
 * What the editor needs to show the blocks bound to the data of the instance, under
 * `/api/block-data` (`pages.edit`):
 *
 * - `GET /references`: the choices of the `reference` fields (teams of every season, the current
 *   one first, sections, venues, news categories, images), as `{ value, label }`;
 * - `GET /read?method=<name>&query=<JSON>`: one read of the readers of the blocks, the same the
 *   public site renders with (`matches`, `teams`, `team`, `trainingSlots`, `venues`, `posts`,
 *   `post`, `partners`, `media`), so the preview shows the real data.
 */

const optionalId = z.number().int().positive().optional();
const id = z.number().int().positive();

const READS = {
  matches: z.object({
    teamId: optionalId,
    when: z.enum(["upcoming", "results"]),
    limit: z.number().int().min(1).max(MAX_MATCHES_PER_QUERY),
  }),
  teams: z.object({ sectionId: optionalId }),
  team: z.object({ id }),
  trainingSlots: z.object({ teamId: optionalId, sectionId: optionalId }),
  venues: z.object({ ids: z.array(id).max(100).optional() }),
  posts: z.object({
    limit: z.number().int().min(1).max(MAX_POSTS_PER_QUERY),
    categoryId: optionalId,
    teamId: optionalId,
    featuredOnly: z.boolean().optional(),
  }),
  post: z.object({ slug: z.string().max(100) }),
  partners: z.object({ level: z.enum(PARTNER_LEVELS).optional() }),
  media: z.object({ ids: z.array(id).max(100) }),
} as const;

type ReadMethod = keyof typeof READS;

function isReadMethod(name: string): name is ReadMethod {
  return Object.hasOwn(READS, name);
}

export interface BlockDataApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly now?: () => Date;
}

export function blockDataApiRoutes({
  auth,
  db,
  now = () => new Date(),
}: BlockDataApiDependencies): (app: Hono) => void {
  const api = new Hono<ApiEnv>();
  api.use("*", requirePermission(auth, "pages.edit"));

  api.get("/references", (context) => {
    const teamRows = db
      .select({
        id: teams.id,
        name: teams.name,
        season: seasons.name,
        current: seasons.current,
      })
      .from(teams)
      .innerJoin(seasons, eq(seasons.id, teams.seasonId))
      .orderBy(desc(seasons.current), desc(seasons.startsOn), asc(teams.position), asc(teams.name))
      .all();
    const mediaRows = db
      .select({ id: media.id, alt: media.alt, name: media.originalName, rights: media.rights })
      .from(media)
      .orderBy(desc(media.createdAt), desc(media.id))
      .all();
    return context.json({
      teams: teamRows.map((team) => ({
        value: team.id,
        label: team.current ? team.name : `${team.name} (${team.season})`,
      })),
      sections: db
        .select({ value: sections.id, label: sections.name })
        .from(sections)
        .orderBy(asc(sections.position), asc(sections.name))
        .all(),
      venues: db
        .select({ value: venues.id, label: venues.name })
        .from(venues)
        .orderBy(asc(venues.name))
        .all(),
      postCategories: db
        .select({ value: postCategories.id, label: postCategories.name })
        .from(postCategories)
        .orderBy(asc(postCategories.position), asc(postCategories.name))
        .all(),
      media: mediaRows.map((row) => ({
        value: row.id,
        label:
          (row.alt === "" ? row.name : row.alt) +
          (row.rights === "unverified" ? ` — ${MEDIA_RIGHTS_LABELS.unverified}` : ""),
      })),
    });
  });

  api.get("/read", (context) => {
    const method = context.req.query("method") ?? "";
    if (!isReadMethod(method)) {
      return context.json({ error: "Lecture inconnue." }, 400);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(context.req.query("query") ?? "{}");
    } catch {
      return context.json({ error: "Requête invalide." }, 400);
    }
    const parsed = READS[method].safeParse(raw);
    if (!parsed.success) {
      return context.json({ error: "Requête invalide." }, 400);
    }
    const query = parsed.data as never;
    const result = (() => {
      switch (method) {
        case "matches":
          return readMatches(db, query, now());
        case "teams":
          return readTeams(db, query);
        case "team":
          return readTeam(db, (parsed.data as { id: number }).id);
        case "trainingSlots":
          return readTrainingSlots(db, query);
        case "venues":
          return readVenues(db, query);
        case "posts":
          return readPosts(db, query);
        case "post":
          return readPost(db, (parsed.data as { slug: string }).slug);
        case "partners":
          return readPartners(db, query, now());
        case "media":
          return readMedia(db, (parsed.data as { ids: number[] }).ids);
      }
    })();
    return context.json({ result });
  });

  return (app) => {
    app.route("/api/block-data", api);
  };
}
