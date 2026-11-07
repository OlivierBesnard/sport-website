import {
  MAX_MATCHES_PER_QUERY,
  type MatchQuery,
  type MatchView,
  type SportReader,
  type TeamSummaryView,
  type TeamView,
  type TrainingSlotView,
  type VenueView,
  type Weekday,
} from "@sport-cms/core";
import {
  calendarEvents,
  type Database,
  matches,
  seasons,
  sections,
  teams,
  trainingSlots,
  venues,
} from "@sport-cms/db";
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, type SQL } from "drizzle-orm";

/*
 * Public reads of the sports content: what the blocks show on the site (and, through the API,
 * in the editor preview). Only public data: no coach, no account.
 */

/** The current season, if one is marked so. */
export function currentSeasonId(db: Database): number | undefined {
  return db.select({ id: seasons.id }).from(seasons).where(eq(seasons.current, true)).get()?.id;
}

const teamSummaryColumns = {
  id: teams.id,
  name: teams.name,
  category: teams.category,
  level: teams.level,
  gender: teams.gender,
  pagePath: teams.pagePath,
  sectionId: sections.id,
  sectionName: sections.name,
};

type TeamSummaryRow = {
  id: number;
  name: string;
  category: string;
  level: string;
  gender: TeamSummaryView["gender"];
  pagePath: string | null;
  sectionId: number | null;
  sectionName: string | null;
};

function teamSummary(row: TeamSummaryRow): TeamSummaryView {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    level: row.level,
    gender: row.gender,
    pagePath: row.pagePath,
    section:
      row.sectionId === null || row.sectionName === null
        ? null
        : { id: row.sectionId, name: row.sectionName },
  };
}

export function readMatches(db: Database, query: MatchQuery, now: Date): MatchView[] {
  const limit = Math.min(Math.max(Math.trunc(query.limit), 1), MAX_MATCHES_PER_QUERY);
  const filters: SQL[] = [eq(calendarEvents.kind, "match")];
  if (query.teamId !== undefined) {
    filters.push(eq(calendarEvents.teamId, query.teamId));
  }
  if (query.when === "upcoming") {
    filters.push(gt(calendarEvents.startsAt, now), isNull(matches.scoreFor));
  } else {
    filters.push(isNotNull(matches.scoreFor), isNotNull(matches.scoreAgainst));
  }
  const rows = db
    .select({
      id: calendarEvents.id,
      startsAt: calendarEvents.startsAt,
      home: matches.home,
      opponent: matches.opponent,
      competition: matches.competition,
      scoreFor: matches.scoreFor,
      scoreAgainst: matches.scoreAgainst,
      teamId: teams.id,
      teamName: teams.name,
      teamPagePath: teams.pagePath,
      venueId: venues.id,
      venueName: venues.name,
      venueCity: venues.city,
    })
    .from(calendarEvents)
    .innerJoin(matches, eq(matches.eventId, calendarEvents.id))
    .leftJoin(teams, eq(teams.id, calendarEvents.teamId))
    .leftJoin(venues, eq(venues.id, calendarEvents.venueId))
    .where(and(...filters))
    .orderBy(
      query.when === "upcoming" ? asc(calendarEvents.startsAt) : desc(calendarEvents.startsAt),
      asc(calendarEvents.id),
    )
    .limit(limit)
    .all();
  return rows.map((row) => ({
    id: row.id,
    startsAt: row.startsAt.getTime(),
    home: row.home,
    opponent: row.opponent,
    competition: row.competition,
    scoreFor: row.scoreFor,
    scoreAgainst: row.scoreAgainst,
    team:
      row.teamId === null || row.teamName === null
        ? null
        : { id: row.teamId, name: row.teamName, pagePath: row.teamPagePath },
    venue:
      row.venueId === null || row.venueName === null
        ? null
        : { id: row.venueId, name: row.venueName, city: row.venueCity ?? "" },
  }));
}

export function readTeams(db: Database, query: { sectionId?: number }): TeamSummaryView[] {
  const season = currentSeasonId(db);
  if (season === undefined) {
    return [];
  }
  const filters: SQL[] = [eq(teams.seasonId, season)];
  if (query.sectionId !== undefined) {
    filters.push(eq(teams.sectionId, query.sectionId));
  }
  return db
    .select(teamSummaryColumns)
    .from(teams)
    .leftJoin(sections, eq(sections.id, teams.sectionId))
    .where(and(...filters))
    .orderBy(asc(teams.position), asc(teams.name), asc(teams.id))
    .all()
    .map(teamSummary);
}

export function readTrainingSlots(
  db: Database,
  query: { teamId?: number; sectionId?: number; seasonId?: number },
): TrainingSlotView[] {
  const filters: SQL[] = [];
  if (query.teamId !== undefined) {
    filters.push(eq(teams.id, query.teamId));
  } else {
    const season = query.seasonId ?? currentSeasonId(db);
    if (season === undefined) {
      return [];
    }
    filters.push(eq(teams.seasonId, season));
  }
  if (query.sectionId !== undefined) {
    filters.push(eq(teams.sectionId, query.sectionId));
  }
  return db
    .select({
      id: trainingSlots.id,
      weekday: trainingSlots.weekday,
      startsAt: trainingSlots.startsAt,
      endsAt: trainingSlots.endsAt,
      teamId: teams.id,
      teamName: teams.name,
      venueId: venues.id,
      venueName: venues.name,
    })
    .from(trainingSlots)
    .innerJoin(teams, eq(teams.id, trainingSlots.teamId))
    .leftJoin(venues, eq(venues.id, trainingSlots.venueId))
    .where(and(...filters))
    .orderBy(asc(trainingSlots.weekday), asc(trainingSlots.startsAt), asc(trainingSlots.id))
    .all()
    .map((row) => ({
      id: row.id,
      weekday: row.weekday as Weekday,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      team: { id: row.teamId, name: row.teamName },
      venue:
        row.venueId === null || row.venueName === null
          ? null
          : { id: row.venueId, name: row.venueName },
    }));
}

export function readTeam(db: Database, id: number): TeamView | null {
  const row = db
    .select({ ...teamSummaryColumns, description: teams.description })
    .from(teams)
    .leftJoin(sections, eq(sections.id, teams.sectionId))
    .where(eq(teams.id, id))
    .get();
  if (row === undefined) {
    return null;
  }
  return {
    ...teamSummary(row),
    description: row.description,
    slots: readTrainingSlots(db, { teamId: id }),
  };
}

export function readVenues(db: Database, query: { ids?: readonly number[] }): VenueView[] {
  const select = db
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
    .from(venues);
  if (query.ids !== undefined && query.ids.length === 0) {
    return [];
  }
  return (query.ids === undefined ? select : select.where(inArray(venues.id, [...query.ids])))
    .orderBy(asc(venues.name), asc(venues.id))
    .all();
}

/** The {@link SportReader} of the blocks, reading the database of the instance. */
export function createSportReader(db: Database, now: () => Date = () => new Date()): SportReader {
  return {
    matches: async (query) => readMatches(db, query, now()),
    teams: async (query) => readTeams(db, query),
    team: async (id) => readTeam(db, id),
    trainingSlots: async (query) => readTrainingSlots(db, query),
    venues: async (query) => readVenues(db, query),
  };
}
