import { can } from "@sport-cms/core";
import {
  calendarEvents,
  type Database,
  emitEvent,
  type JsonObject,
  matches,
  seasons,
  sections,
  teamAssignments,
  teams,
  trainingSlots,
  user as userTable,
  venues,
  writeAudit,
} from "@sport-cms/db";
import { and, asc, count, eq, inArray, type SQL } from "drizzle-orm";
import { type Context, Hono } from "hono";
import type { z } from "zod";
import type { Logger } from "../app.js";
import type { Auth } from "../auth/create-auth.js";
import { type AuthVariables, requireUser } from "../auth/middlewares.js";
import { fieldsOf } from "../fields.js";
import {
  type CalendarEventInput,
  calendarEventSchema,
  seasonSchema,
  sectionSchema,
  TEAM_IDENTITY_FIELDS,
  type TeamInput,
  teamSchema,
  venueSchema,
} from "./schemas.js";

/**
 * Admin API of the sports content (PLAN §3.3), under `/api/sport`:
 *
 * - `sections`, `seasons`, `venues`: `GET` (list), `POST`, `PUT /:id`, `DELETE /:id`, plus
 *   `POST /seasons/:id/current` (the season the public site shows; one at most);
 * - `teams` (`?season=<id>`): `GET`, `GET /:id`, `POST`, `PUT /:id` (training times replaced as
 *   a whole, coaches with `coachIds`), `DELETE /:id`; `GET /coaches`: the accounts of role coach;
 * - `events` (`?season=&team=&from=&to=`): the calendar, matches included (`match`: opponent,
 *   home or away, competition, score, report): `GET`, `GET /:id`, `POST`, `PUT /:id`,
 *   `DELETE /:id`.
 *
 * Access: `sport.manage` edits everything; `teams.own` (a coach) reads everything but only edits
 * the teams assigned to the account — their presentation, training times and calendar, results
 * included — never their identity (season, name, category…) nor their coaches, and creates no
 * team; every other account gets 403. Each item listed says whether the account may edit it
 * (`canEdit`).
 *
 * Every change emits its event in its transaction (source `core`): `match.scheduled`,
 * `match.updated`, `match.result_published` (a score entered or corrected), `match.deleted`,
 * `event.created`, `event.updated`, `event.deleted`, `team.updated`, `season.updated`,
 * `section.updated`, `venue.updated`; the blocks of the site depend on them (`dependsOn`).
 */

/** What the account may edit in the sports content. */
export interface SportScope {
  /** `sport.manage`: everything. */
  readonly manage: boolean;
  /** Teams assigned to the account (`teams.own`), when it does not manage everything. */
  readonly teams: ReadonlySet<number>;
}

type SportEnv = { Variables: AuthVariables & { scope: SportScope } };

export interface SportApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly logger?: Logger;
  /** Called after a change emitted events: the dispatcher delivers them without waiting. */
  readonly onEmitted?: () => void;
}

export function scopeOf(
  db: Database,
  account: { id: string; role?: string | null },
): SportScope | undefined {
  const holder = { role: account.role as Parameters<typeof can>[0]["role"] };
  if (can(holder, "sport.manage")) {
    return { manage: true, teams: new Set() };
  }
  if (!can(holder, "teams.own")) {
    return undefined;
  }
  const rows = db
    .select({ teamId: teamAssignments.teamId })
    .from(teamAssignments)
    .where(eq(teamAssignments.userId, account.id))
    .all();
  return { manage: false, teams: new Set(rows.map((row) => row.teamId)) };
}

function canEditTeam(scope: SportScope, teamId: number | null): boolean {
  return scope.manage || (teamId !== null && scope.teams.has(teamId));
}

const MANAGE_REQUIRED = "Accès refusé : seul un responsable des contenus sport peut faire cela.";
const TEAM_REQUIRED =
  "Accès refusé : vous ne pouvez modifier que les équipes qui vous sont confiées.";
const INVALID = "Requête invalide.";

class HttpError extends Error {
  readonly status: 400 | 403 | 404 | 409;
  readonly fields: Record<string, string> | undefined;

  constructor(status: 400 | 403 | 404 | 409, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function invalidField(field: string, message: string): HttpError {
  return new HttpError(400, INVALID, { [field]: message });
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  return false;
}

async function parseBody<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  const raw = await context.req.json().catch(() => undefined);
  const parsed = schema.safeParse(raw, { reportInput: true });
  if (!parsed.success) {
    throw new HttpError(400, INVALID, fieldsOf(parsed.error));
  }
  return parsed.data;
}

function idParam(context: Context): number {
  const text = context.req.param("id") ?? "";
  if (!/^[1-9]\d{0,15}$/.test(text)) {
    throw new HttpError(404, "Élément introuvable.");
  }
  return Number(text);
}

function optionalQueryId(context: Context, name: string): number | undefined {
  const text = context.req.query(name);
  if (text === undefined || text === "") {
    return undefined;
  }
  if (!/^[1-9]\d{0,15}$/.test(text)) {
    throw invalidField(name, "Identifiant invalide.");
  }
  return Number(text);
}

function requireManage(context: Context<SportEnv>): void {
  if (!context.get("scope").manage) {
    throw new HttpError(403, MANAGE_REQUIRED);
  }
}

/** Emits an event of the core, inside the transaction of the change. */
function emit(db: Database, type: string, payload: JsonObject): void {
  emitEvent(db, { type, source: "core", payload });
}

// --- Views --------------------------------------------------------------------------------

function listSections(db: Database) {
  return db
    .select({
      id: sections.id,
      name: sections.name,
      sport: sections.sport,
      position: sections.position,
    })
    .from(sections)
    .orderBy(asc(sections.position), asc(sections.name))
    .all();
}

function listSeasons(db: Database) {
  return db
    .select({
      id: seasons.id,
      name: seasons.name,
      startsOn: seasons.startsOn,
      endsOn: seasons.endsOn,
      current: seasons.current,
    })
    .from(seasons)
    .orderBy(asc(seasons.startsOn), asc(seasons.id))
    .all();
}

function listVenues(db: Database) {
  return db
    .select({
      id: venues.id,
      name: venues.name,
      address: venues.address,
      postalCode: venues.postalCode,
      city: venues.city,
      accessInfo: venues.accessInfo,
      latitude: venues.latitude,
      longitude: venues.longitude,
    })
    .from(venues)
    .orderBy(asc(venues.name), asc(venues.id))
    .all();
}

export interface TeamAdminView {
  readonly id: number;
  readonly seasonId: number;
  readonly sectionId: number | null;
  readonly name: string;
  readonly category: string;
  readonly level: string;
  readonly gender: string;
  readonly description: string;
  readonly pagePath: string | null;
  readonly position: number;
  readonly coaches: readonly { id: string; name: string; email: string }[];
  readonly slots: readonly {
    id: number;
    weekday: number;
    startsAt: string;
    endsAt: string;
    venueId: number | null;
  }[];
  readonly canEdit: boolean;
}

function teamViews(db: Database, scope: SportScope, filter: SQL | undefined): TeamAdminView[] {
  const rows = db
    .select()
    .from(teams)
    .where(filter)
    .orderBy(asc(teams.position), asc(teams.name), asc(teams.id))
    .all();
  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);
  const coachRows = db
    .select({
      teamId: teamAssignments.teamId,
      id: userTable.id,
      name: userTable.name,
      email: userTable.email,
    })
    .from(teamAssignments)
    .innerJoin(userTable, eq(userTable.id, teamAssignments.userId))
    .where(inArray(teamAssignments.teamId, ids))
    .orderBy(asc(userTable.name))
    .all();
  const slotRows = db
    .select()
    .from(trainingSlots)
    .where(inArray(trainingSlots.teamId, ids))
    .orderBy(asc(trainingSlots.weekday), asc(trainingSlots.startsAt), asc(trainingSlots.id))
    .all();
  return rows.map((row) => ({
    id: row.id,
    seasonId: row.seasonId,
    sectionId: row.sectionId,
    name: row.name,
    category: row.category,
    level: row.level,
    gender: row.gender,
    description: row.description,
    pagePath: row.pagePath,
    position: row.position,
    coaches: coachRows
      .filter((coach) => coach.teamId === row.id)
      .map(({ id, name, email }) => ({ id, name, email })),
    slots: slotRows
      .filter((slot) => slot.teamId === row.id)
      .map(({ id, weekday, startsAt, endsAt, venueId }) => ({
        id,
        weekday,
        startsAt,
        endsAt,
        venueId,
      })),
    canEdit: canEditTeam(scope, row.id),
  }));
}

export interface CalendarEventAdminView {
  readonly id: number;
  readonly seasonId: number;
  readonly teamId: number | null;
  readonly kind: string;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly venueId: number | null;
  readonly description: string;
  readonly match: {
    readonly home: boolean;
    readonly opponent: string;
    readonly competition: string;
    readonly scoreFor: number | null;
    readonly scoreAgainst: number | null;
    readonly report: string;
    readonly resultPublishedAt: number | null;
  } | null;
  readonly canEdit: boolean;
}

function eventViews(db: Database, scope: SportScope, filter: SQL | undefined) {
  return db
    .select({ event: calendarEvents, match: matches })
    .from(calendarEvents)
    .leftJoin(matches, eq(matches.eventId, calendarEvents.id))
    .where(filter)
    .orderBy(asc(calendarEvents.startsAt), asc(calendarEvents.id))
    .all()
    .map(
      ({ event, match }): CalendarEventAdminView => ({
        id: event.id,
        seasonId: event.seasonId,
        teamId: event.teamId,
        kind: event.kind,
        title: event.title,
        startsAt: event.startsAt.getTime(),
        endsAt: event.endsAt === null ? null : event.endsAt.getTime(),
        venueId: event.venueId,
        description: event.description,
        match:
          match === null
            ? null
            : {
                home: match.home,
                opponent: match.opponent,
                competition: match.competition,
                scoreFor: match.scoreFor,
                scoreAgainst: match.scoreAgainst,
                report: match.report,
                resultPublishedAt:
                  match.resultPublishedAt === null ? null : match.resultPublishedAt.getTime(),
              },
        canEdit: canEditTeam(scope, event.teamId),
      }),
    );
}

// --- Checks -------------------------------------------------------------------------------

function exists(db: Database, table: typeof seasons | typeof sections | typeof venues, id: number) {
  return db.select({ id: table.id }).from(table).where(eq(table.id, id)).get() !== undefined;
}

function checkReference(
  db: Database,
  table: typeof seasons | typeof sections | typeof venues,
  id: number | null,
  field: string,
  message: string,
): void {
  if (id !== null && !exists(db, table, id)) {
    throw invalidField(field, message);
  }
}

function checkSlots(db: Database, input: TeamInput): void {
  for (const [index, slot] of input.slots.entries()) {
    checkReference(db, venues, slot.venueId, `slots.${index}.venueId`, "Ce lieu n'existe pas.");
  }
}

function checkCoaches(db: Database, coachIds: readonly string[]): void {
  if (coachIds.length === 0) {
    return;
  }
  const found = db
    .select({ id: userTable.id, role: userTable.role })
    .from(userTable)
    .where(inArray(userTable.id, [...coachIds]))
    .all();
  for (const [index, id] of coachIds.entries()) {
    if (!found.some((row) => row.id === id)) {
      throw invalidField(`coachIds.${index}`, "Ce compte n'existe pas.");
    }
  }
}

function findTeam(db: Database, id: number) {
  return db.select().from(teams).where(eq(teams.id, id)).get();
}

function checkEventInput(db: Database, input: CalendarEventInput): void {
  checkReference(db, seasons, input.seasonId, "seasonId", "Cette saison n'existe pas.");
  checkReference(db, venues, input.venueId, "venueId", "Ce lieu n'existe pas.");
  if (input.teamId !== null) {
    const team = findTeam(db, input.teamId);
    if (team === undefined) {
      throw invalidField("teamId", "Cette équipe n'existe pas.");
    }
    if (team.seasonId !== input.seasonId) {
      throw invalidField("teamId", "Cette équipe n'appartient pas à la saison choisie.");
    }
  }
}

function eventPayload(event: { id: number; kind: string; teamId: number | null }): JsonObject {
  return { eventId: event.id, kind: event.kind, teamId: event.teamId };
}

function matchPayload(event: {
  id: number;
  teamId: number | null;
  seasonId: number;
  startsAt: number;
}): JsonObject {
  return {
    matchId: event.id,
    teamId: event.teamId,
    seasonId: event.seasonId,
    startsAt: event.startsAt,
  };
}

// --- Routes -------------------------------------------------------------------------------

export function sportApiRoutes({
  auth,
  db,
  logger = console,
  onEmitted,
}: SportApiDependencies): (app: Hono) => void {
  const api = new Hono<SportEnv>();
  api.use("*", requireUser(auth) as never);
  api.use("*", async (context, next) => {
    const scope = scopeOf(db, context.get("user"));
    if (scope === undefined) {
      return context.json(
        { error: "Accès refusé : la gestion des équipes ou des contenus sport est requise." },
        403,
      );
    }
    context.set("scope", scope);
    return next();
  });
  api.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json(
        error.fields === undefined
          ? { error: error.message }
          : { error: error.message, fields: error.fields },
        error.status,
      );
    }
    logger.error(`Contenus sport : échec de ${context.req.method} ${context.req.path}`, error);
    return context.json({ error: "L'opération a échoué. Réessayez." }, 500);
  });

  /** Runs a change in a transaction, mapping a uniqueness conflict to 409. */
  function change<T>(conflict: string, run: () => T): T {
    let result: T;
    try {
      result = db.transaction(run);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, conflict);
      }
      throw error;
    }
    onEmitted?.();
    return result;
  }

  // Sections ---------------------------------------------------------------------------------

  const SECTION_CONFLICT = "Une section porte déjà ce nom.";

  api.get("/sections", (context) => context.json({ sections: listSections(db) }));

  api.post("/sections", async (context) => {
    requireManage(context);
    const input = await parseBody(context, sectionSchema);
    const id = change(SECTION_CONFLICT, () => {
      const row = db.insert(sections).values(input).returning({ id: sections.id }).get();
      emit(db, "section.updated", { sectionId: row.id });
      return row.id;
    });
    return context.json({ section: listSections(db).find((row) => row.id === id) }, 201);
  });

  api.put("/sections/:id", async (context) => {
    requireManage(context);
    const id = idParam(context);
    const input = await parseBody(context, sectionSchema);
    if (!exists(db, sections, id)) {
      throw new HttpError(404, "Section introuvable.");
    }
    change(SECTION_CONFLICT, () => {
      db.update(sections).set(input).where(eq(sections.id, id)).run();
      emit(db, "section.updated", { sectionId: id });
    });
    return context.json({ section: listSections(db).find((row) => row.id === id) });
  });

  api.delete("/sections/:id", (context) => {
    requireManage(context);
    const id = idParam(context);
    if (!exists(db, sections, id)) {
      throw new HttpError(404, "Section introuvable.");
    }
    change(SECTION_CONFLICT, () => {
      db.delete(sections).where(eq(sections.id, id)).run();
      emit(db, "section.updated", { sectionId: id, deleted: true });
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.section_deleted",
        targetType: "section",
        targetId: String(id),
      });
    });
    return context.body(null, 204);
  });

  // Seasons ----------------------------------------------------------------------------------

  const SEASON_CONFLICT = "Une saison porte déjà ce nom.";

  api.get("/seasons", (context) => context.json({ seasons: listSeasons(db) }));

  api.post("/seasons", async (context) => {
    requireManage(context);
    const input = await parseBody(context, seasonSchema);
    const id = change(SEASON_CONFLICT, () => {
      // The first season becomes the current one: the site has something to show at once.
      const first = db.select({ total: count() }).from(seasons).get()?.total === 0;
      const row = db
        .insert(seasons)
        .values({ ...input, current: first })
        .returning({ id: seasons.id })
        .get();
      emit(db, "season.updated", { seasonId: row.id });
      return row.id;
    });
    return context.json({ season: listSeasons(db).find((row) => row.id === id) }, 201);
  });

  api.put("/seasons/:id", async (context) => {
    requireManage(context);
    const id = idParam(context);
    const input = await parseBody(context, seasonSchema);
    if (!exists(db, seasons, id)) {
      throw new HttpError(404, "Saison introuvable.");
    }
    change(SEASON_CONFLICT, () => {
      db.update(seasons).set(input).where(eq(seasons.id, id)).run();
      emit(db, "season.updated", { seasonId: id });
    });
    return context.json({ season: listSeasons(db).find((row) => row.id === id) });
  });

  api.post("/seasons/:id/current", (context) => {
    requireManage(context);
    const id = idParam(context);
    if (!exists(db, seasons, id)) {
      throw new HttpError(404, "Saison introuvable.");
    }
    change(SEASON_CONFLICT, () => {
      db.update(seasons).set({ current: false }).where(eq(seasons.current, true)).run();
      db.update(seasons).set({ current: true }).where(eq(seasons.id, id)).run();
      emit(db, "season.updated", { seasonId: id, current: true });
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.season_current",
        targetType: "season",
        targetId: String(id),
      });
    });
    return context.json({ seasons: listSeasons(db) });
  });

  api.delete("/seasons/:id", (context) => {
    requireManage(context);
    const id = idParam(context);
    if (!exists(db, seasons, id)) {
      throw new HttpError(404, "Saison introuvable.");
    }
    const teamCount = db.select({ total: count() }).from(teams).where(eq(teams.seasonId, id)).get();
    const eventCount = db
      .select({ total: count() })
      .from(calendarEvents)
      .where(eq(calendarEvents.seasonId, id))
      .get();
    if ((teamCount?.total ?? 0) > 0 || (eventCount?.total ?? 0) > 0) {
      throw new HttpError(
        409,
        "Cette saison a des équipes ou des événements : supprimez-les d'abord.",
      );
    }
    change(SEASON_CONFLICT, () => {
      db.delete(seasons).where(eq(seasons.id, id)).run();
      emit(db, "season.updated", { seasonId: id, deleted: true });
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.season_deleted",
        targetType: "season",
        targetId: String(id),
      });
    });
    return context.body(null, 204);
  });

  // Venues -----------------------------------------------------------------------------------

  api.get("/venues", (context) => context.json({ venues: listVenues(db) }));

  api.post("/venues", async (context) => {
    requireManage(context);
    const input = await parseBody(context, venueSchema);
    const id = change("Ce lieu existe déjà.", () => {
      const row = db.insert(venues).values(input).returning({ id: venues.id }).get();
      emit(db, "venue.updated", { venueId: row.id });
      return row.id;
    });
    return context.json({ venue: listVenues(db).find((row) => row.id === id) }, 201);
  });

  api.put("/venues/:id", async (context) => {
    requireManage(context);
    const id = idParam(context);
    const input = await parseBody(context, venueSchema);
    if (!exists(db, venues, id)) {
      throw new HttpError(404, "Lieu introuvable.");
    }
    change("Ce lieu existe déjà.", () => {
      db.update(venues).set(input).where(eq(venues.id, id)).run();
      emit(db, "venue.updated", { venueId: id });
    });
    return context.json({ venue: listVenues(db).find((row) => row.id === id) });
  });

  api.delete("/venues/:id", (context) => {
    requireManage(context);
    const id = idParam(context);
    if (!exists(db, venues, id)) {
      throw new HttpError(404, "Lieu introuvable.");
    }
    change("Ce lieu existe déjà.", () => {
      db.delete(venues).where(eq(venues.id, id)).run();
      emit(db, "venue.updated", { venueId: id, deleted: true });
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.venue_deleted",
        targetType: "venue",
        targetId: String(id),
      });
    });
    return context.body(null, 204);
  });

  // Teams ------------------------------------------------------------------------------------

  const TEAM_CONFLICT = "Une équipe de cette saison porte déjà ce nom.";

  api.get("/coaches", (context) => {
    requireManage(context);
    const coaches = db
      .select({ id: userTable.id, name: userTable.name, email: userTable.email })
      .from(userTable)
      .where(eq(userTable.role, "coach"))
      .orderBy(asc(userTable.name), asc(userTable.email))
      .all();
    return context.json({ coaches });
  });

  api.get("/teams", (context) => {
    const season = optionalQueryId(context, "season");
    return context.json({
      teams: teamViews(
        db,
        context.get("scope"),
        season === undefined ? undefined : eq(teams.seasonId, season),
      ),
    });
  });

  api.get("/teams/:id", (context) => {
    const id = idParam(context);
    const [team] = teamViews(db, context.get("scope"), eq(teams.id, id));
    if (team === undefined) {
      throw new HttpError(404, "Équipe introuvable.");
    }
    return context.json({ team });
  });

  function checkTeamInput(input: TeamInput): void {
    checkReference(db, seasons, input.seasonId, "seasonId", "Cette saison n'existe pas.");
    checkReference(db, sections, input.sectionId, "sectionId", "Cette section n'existe pas.");
    checkSlots(db, input);
    if (input.coachIds !== undefined) {
      checkCoaches(db, input.coachIds);
    }
  }

  function writeTeamDetails(teamId: number, input: TeamInput, actorId: string): void {
    db.delete(trainingSlots).where(eq(trainingSlots.teamId, teamId)).run();
    if (input.slots.length > 0) {
      db.insert(trainingSlots)
        .values(input.slots.map((slot) => ({ ...slot, teamId })))
        .run();
    }
    if (input.coachIds !== undefined) {
      const coachIds = [...new Set(input.coachIds)];
      db.delete(teamAssignments).where(eq(teamAssignments.teamId, teamId)).run();
      if (coachIds.length > 0) {
        db.insert(teamAssignments)
          .values(coachIds.map((userId) => ({ teamId, userId })))
          .run();
      }
      writeAudit(db, {
        actorId,
        action: "sport.team_coaches_updated",
        targetType: "team",
        targetId: String(teamId),
        details: { coaches: coachIds },
      });
    }
  }

  api.post("/teams", async (context) => {
    requireManage(context);
    const input = await parseBody(context, teamSchema);
    checkTeamInput(input);
    const id = change(TEAM_CONFLICT, () => {
      const { slots: _slots, coachIds: _coaches, ...columns } = input;
      const row = db.insert(teams).values(columns).returning({ id: teams.id }).get();
      writeTeamDetails(row.id, input, context.get("user").id);
      emit(db, "team.updated", { teamId: row.id });
      return row.id;
    });
    const [team] = teamViews(db, context.get("scope"), eq(teams.id, id));
    return context.json({ team }, 201);
  });

  api.put("/teams/:id", async (context) => {
    const id = idParam(context);
    const scope = context.get("scope");
    const input = await parseBody(context, teamSchema);
    const stored = findTeam(db, id);
    if (stored === undefined) {
      throw new HttpError(404, "Équipe introuvable.");
    }
    if (!canEditTeam(scope, id)) {
      throw new HttpError(403, TEAM_REQUIRED);
    }
    if (!scope.manage) {
      // A coach edits the presentation and the training times of the team, nothing else.
      const changed = TEAM_IDENTITY_FIELDS.filter((field) => input[field] !== stored[field]);
      if (changed.length > 0 || input.coachIds !== undefined) {
        throw new HttpError(
          403,
          "Accès refusé : seul un responsable des contenus sport peut changer l'identité de " +
            "l'équipe (saison, nom, catégorie, page…) ou ses coachs.",
        );
      }
    }
    checkTeamInput(input);
    change(TEAM_CONFLICT, () => {
      const { slots: _slots, coachIds: _coaches, ...columns } = input;
      db.update(teams).set(columns).where(eq(teams.id, id)).run();
      writeTeamDetails(id, input, context.get("user").id);
      emit(db, "team.updated", { teamId: id });
    });
    const [team] = teamViews(db, scope, eq(teams.id, id));
    return context.json({ team });
  });

  api.delete("/teams/:id", (context) => {
    requireManage(context);
    const id = idParam(context);
    if (findTeam(db, id) === undefined) {
      throw new HttpError(404, "Équipe introuvable.");
    }
    const events = db
      .select({ total: count() })
      .from(calendarEvents)
      .where(eq(calendarEvents.teamId, id))
      .get();
    if ((events?.total ?? 0) > 0) {
      throw new HttpError(
        409,
        "Cette équipe a des événements au calendrier : supprimez-les d'abord.",
      );
    }
    change(TEAM_CONFLICT, () => {
      db.delete(teams).where(eq(teams.id, id)).run();
      emit(db, "team.updated", { teamId: id, deleted: true });
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.team_deleted",
        targetType: "team",
        targetId: String(id),
      });
    });
    return context.body(null, 204);
  });

  // Calendar ---------------------------------------------------------------------------------

  api.get("/events", (context) => {
    const season = optionalQueryId(context, "season");
    const team = optionalQueryId(context, "team");
    const filters: SQL[] = [];
    if (season !== undefined) {
      filters.push(eq(calendarEvents.seasonId, season));
    }
    if (team !== undefined) {
      filters.push(eq(calendarEvents.teamId, team));
    }
    return context.json({
      events: eventViews(
        db,
        context.get("scope"),
        filters.length === 0 ? undefined : and(...filters),
      ),
    });
  });

  function findEvent(scope: SportScope, id: number): CalendarEventAdminView {
    const [event] = eventViews(db, scope, eq(calendarEvents.id, id));
    if (event === undefined) {
      throw new HttpError(404, "Événement introuvable.");
    }
    return event;
  }

  api.get("/events/:id", (context) =>
    context.json({ event: findEvent(context.get("scope"), idParam(context)) }),
  );

  function eventColumns(input: CalendarEventInput) {
    return {
      seasonId: input.seasonId,
      teamId: input.teamId,
      kind: input.kind,
      title: input.kind === "match" ? "" : input.title,
      startsAt: new Date(input.startsAt),
      endsAt: input.endsAt === null ? null : new Date(input.endsAt),
      venueId: input.venueId,
      description: input.description,
    };
  }

  api.post("/events", async (context) => {
    const scope = context.get("scope");
    const input = await parseBody(context, calendarEventSchema);
    if (!canEditTeam(scope, input.teamId)) {
      throw new HttpError(403, TEAM_REQUIRED);
    }
    checkEventInput(db, input);
    const id = change("Cet événement existe déjà.", () => {
      const row = db
        .insert(calendarEvents)
        .values(eventColumns(input))
        .returning({ id: calendarEvents.id })
        .get();
      const event = { ...input, id: row.id };
      if (input.kind === "match" && input.match !== undefined) {
        const scored = input.match.scoreFor !== null;
        db.insert(matches)
          .values({
            eventId: row.id,
            ...input.match,
            resultPublishedAt: scored ? new Date() : null,
          })
          .run();
        emit(db, "match.scheduled", matchPayload(event));
        if (scored) {
          emit(db, "match.result_published", {
            ...matchPayload(event),
            scoreFor: input.match.scoreFor,
            scoreAgainst: input.match.scoreAgainst,
          });
        }
      } else {
        emit(db, "event.created", eventPayload(event));
      }
      return row.id;
    });
    return context.json({ event: findEvent(scope, id) }, 201);
  });

  api.put("/events/:id", async (context) => {
    const scope = context.get("scope");
    const id = idParam(context);
    const input = await parseBody(context, calendarEventSchema);
    const stored = findEvent(scope, id);
    if (!stored.canEdit || !canEditTeam(scope, input.teamId)) {
      throw new HttpError(403, TEAM_REQUIRED);
    }
    if (input.kind !== stored.kind) {
      throw invalidField(
        "kind",
        "Le type d'un événement ne change pas : supprimez-le et créez-en un autre.",
      );
    }
    checkEventInput(db, input);
    change("Cet événement existe déjà.", () => {
      db.update(calendarEvents).set(eventColumns(input)).where(eq(calendarEvents.id, id)).run();
      const event = { ...input, id };
      if (input.kind === "match" && input.match !== undefined) {
        const before = stored.match;
        const scored = input.match.scoreFor !== null;
        const scoreChanged =
          scored &&
          (before?.scoreFor !== input.match.scoreFor ||
            before?.scoreAgainst !== input.match.scoreAgainst);
        db.update(matches)
          .set({
            ...input.match,
            resultPublishedAt: !scored
              ? null
              : scoreChanged || before?.resultPublishedAt == null
                ? new Date()
                : new Date(before.resultPublishedAt),
          })
          .where(eq(matches.eventId, id))
          .run();
        emit(db, "match.updated", matchPayload(event));
        if (scoreChanged) {
          emit(db, "match.result_published", {
            ...matchPayload(event),
            scoreFor: input.match.scoreFor,
            scoreAgainst: input.match.scoreAgainst,
          });
        }
      } else {
        emit(db, "event.updated", eventPayload(event));
      }
    });
    return context.json({ event: findEvent(scope, id) });
  });

  api.delete("/events/:id", (context) => {
    const scope = context.get("scope");
    const id = idParam(context);
    const stored = findEvent(scope, id);
    if (!stored.canEdit) {
      throw new HttpError(403, TEAM_REQUIRED);
    }
    change("Cet événement existe déjà.", () => {
      db.delete(calendarEvents).where(eq(calendarEvents.id, id)).run();
      if (stored.kind === "match") {
        emit(db, "match.deleted", matchPayload(stored));
      } else {
        emit(db, "event.deleted", eventPayload(stored));
      }
      writeAudit(db, {
        actorId: context.get("user").id,
        action: "sport.event_deleted",
        targetType: "calendar_event",
        targetId: String(id),
        details: { kind: stored.kind, teamId: stored.teamId },
      });
    });
    return context.body(null, 204);
  });

  return (app) => {
    app.route("/api/sport", api);
  };
}
