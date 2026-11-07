import { MAX_MATCHES_PER_QUERY } from "@sport-cms/core";
import { type Database, seasons, sections, teams, venues } from "@sport-cms/db";
import { asc, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import type { Auth } from "../auth/create-auth.js";
import { type ApiEnv, requirePermission } from "../auth/middlewares.js";
import { readMatches, readTeam, readTeams, readTrainingSlots, readVenues } from "./reader.js";

/**
 * What the editor needs to show the blocks bound to the sports content, under
 * `/api/sport-blocks` (`pages.edit`):
 *
 * - `GET /references`: the choices of the `reference` fields (teams of every season, the current
 *   one first, sections, venues), as `{ value, label }`;
 * - `GET /read?method=<name>&query=<JSON>`: one read of the `SportReader` of the blocks, the
 *   same the public site renders with (`matches`, `teams`, `team`, `trainingSlots`, `venues`),
 *   so the preview shows the real data.
 */

const optionalId = z.number().int().positive().optional();

const READS = {
  matches: z.object({
    teamId: optionalId,
    when: z.enum(["upcoming", "results"]),
    limit: z.number().int().min(1).max(MAX_MATCHES_PER_QUERY),
  }),
  teams: z.object({ sectionId: optionalId }),
  team: z.object({ id: z.number().int().positive() }),
  trainingSlots: z.object({ teamId: optionalId, sectionId: optionalId }),
  venues: z.object({ ids: z.array(z.number().int().positive()).max(100).optional() }),
} as const;

type ReadMethod = keyof typeof READS;

function isReadMethod(name: string): name is ReadMethod {
  return Object.hasOwn(READS, name);
}

export interface SportBlocksApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly now?: () => Date;
}

export function sportBlocksApiRoutes({
  auth,
  db,
  now = () => new Date(),
}: SportBlocksApiDependencies): (app: Hono) => void {
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
    switch (method) {
      case "matches":
        return context.json({ result: readMatches(db, query, now()) });
      case "teams":
        return context.json({ result: readTeams(db, query) });
      case "team":
        return context.json({ result: readTeam(db, (parsed.data as { id: number }).id) });
      case "trainingSlots":
        return context.json({ result: readTrainingSlots(db, query) });
      case "venues":
        return context.json({ result: readVenues(db, query) });
    }
  });

  return (app) => {
    app.route("/api/sport-blocks", api);
  };
}
