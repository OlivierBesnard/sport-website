import {
  CALENDAR_EVENT_KINDS,
  type CalendarEventKind,
  TEAM_GENDERS,
  type TeamGender,
} from "@sport-cms/core";
import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
import { user } from "./auth.js";
import { createdAt, timestamp, updatedAt } from "./columns.js";

/*
 * Sports content (PLAN §3.3, §6.6). Days of the calendar (season bounds) are `YYYY-MM-DD` text,
 * a day rather than an instant; the dates of the calendar are instants (epoch milliseconds,
 * like every date); training times are `HH:MM` text, repeated each week.
 *
 * Deleting is restrictive where data would vanish silently: a season keeps its teams and its
 * calendar, a team its calendar (the API says what to delete first). A venue or a section can
 * go: what pointed at it loses the link only.
 */

/** Sections of an omnisports club (Football, Judo…); a single-sport club needs none. */
export const sections = sqliteTable("sections", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull().unique(),
  /** Sport practised, free text (`football`, `judo`…). */
  sport: text("sport").notNull().default(""),
  position: integer("position").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Seasons (`2026-2027`); everything yearly belongs to one. At most one is current. */
export const seasons = sqliteTable(
  "seasons",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull().unique(),
    startsOn: text("starts_on").notNull(),
    endsOn: text("ends_on").notNull(),
    /** The season the public site shows (teams, training times). */
    current: integer("current", { mode: "boolean" }).notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // One current season at most, enforced by the database itself.
    uniqueIndex("seasons_current_unique").on(table.current).where(sql`${table.current} = 1`),
  ],
);

/** Gyms, stadiums, swimming pools. */
export const venues = sqliteTable("venues", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  address: text("address").notNull().default(""),
  postalCode: text("postal_code").notNull().default(""),
  city: text("city").notNull().default(""),
  accessInfo: text("access_info").notNull().default(""),
  latitude: real("latitude"),
  longitude: real("longitude"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Teams and groups of a season. */
export const teams = sqliteTable(
  "teams",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "restrict" }),
    sectionId: integer("section_id").references(() => sections.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    category: text("category").notNull().default(""),
    level: text("level").notNull().default(""),
    gender: text("gender", { enum: TEAM_GENDERS }).notNull().default("mixed").$type<TeamGender>(),
    description: text("description").notNull().default(""),
    /** Path of the page of the site presenting the team (canonical form), linked by blocks. */
    pagePath: text("page_path"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("teams_season_id_name_unique").on(table.seasonId, table.name),
    index("teams_section_id_idx").on(table.sectionId),
  ],
);

/** Coaches of each team: the accounts whose `teams.own` permission reaches it. */
export const teamAssignments = sqliteTable(
  "team_assignments",
  {
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    createdAt: createdAt(),
  },
  (table) => [
    primaryKey({ columns: [table.teamId, table.userId] }),
    index("team_assignments_user_id_idx").on(table.userId),
  ],
);

/** Weekly training times of a team. */
export const trainingSlots = sqliteTable(
  "training_slots",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    teamId: integer("team_id")
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    /** ISO day of the week: 1 = Monday … 7 = Sunday. */
    weekday: integer("weekday").notNull(),
    startsAt: text("starts_at").notNull(),
    endsAt: text("ends_at").notNull(),
    venueId: integer("venue_id").references(() => venues.id, { onDelete: "set null" }),
  },
  (table) => [
    index("training_slots_team_id_idx").on(table.teamId),
    index("training_slots_venue_id_idx").on(table.venueId),
  ],
);

/** Entries of the calendar: matches, tournaments, training camps, meetings, parties. */
export const calendarEvents = sqliteTable(
  "calendar_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    seasonId: integer("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "restrict" }),
    /** Team concerned; `NULL` for an event of the whole club (a match always has a team). */
    teamId: integer("team_id").references(() => teams.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: CALENDAR_EVENT_KINDS }).notNull().$type<CalendarEventKind>(),
    /** Title of an event other than a match (a match is named after its opponent). */
    title: text("title").notNull().default(""),
    startsAt: timestamp("starts_at").notNull(),
    endsAt: timestamp("ends_at"),
    venueId: integer("venue_id").references(() => venues.id, { onDelete: "set null" }),
    description: text("description").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("calendar_events_starts_at_idx").on(table.startsAt),
    index("calendar_events_team_id_starts_at_idx").on(table.teamId, table.startsAt),
    index("calendar_events_season_id_idx").on(table.seasonId),
    index("calendar_events_venue_id_idx").on(table.venueId),
  ],
);

/** Details of the calendar entries of kind `match`. */
export const matches = sqliteTable("matches", {
  eventId: integer("event_id")
    .primaryKey()
    .references(() => calendarEvents.id, { onDelete: "cascade" }),
  home: integer("home", { mode: "boolean" }).notNull().default(true),
  opponent: text("opponent").notNull(),
  competition: text("competition").notNull().default(""),
  /** Both set once the result is published, both `NULL` before. */
  scoreFor: integer("score_for"),
  scoreAgainst: integer("score_against"),
  /** Match report, plain text. */
  report: text("report").notNull().default(""),
  resultPublishedAt: timestamp("result_published_at"),
});
