/**
 * Sports content of the core (PLAN §3.3): the shapes the server, the back-office and the blocks
 * share. Free of Node.js built-ins (root entry, usable in the browser).
 *
 * Days of the calendar (season bounds) are `YYYY-MM-DD` strings: a day, not an instant. Dates of
 * the calendar (a match, a tournament) are instants, in epoch milliseconds, shown in the time
 * zone of whoever reads them (the server's for the public site: `TZ` of the Docker image).
 * Training times are `HH:MM` wall-clock times, repeated every week.
 */

/** Days of the week, ISO numbering (1 = Monday … 7 = Sunday), with their French names. */
export const WEEKDAYS = [
  { value: 1, label: "Lundi" },
  { value: 2, label: "Mardi" },
  { value: 3, label: "Mercredi" },
  { value: 4, label: "Jeudi" },
  { value: 5, label: "Vendredi" },
  { value: 6, label: "Samedi" },
  { value: 7, label: "Dimanche" },
] as const;

export type Weekday = (typeof WEEKDAYS)[number]["value"];

/** French name of a day of the week (ISO number). */
export function weekdayLabel(weekday: number): string {
  return WEEKDAYS.find((day) => day.value === weekday)?.label ?? "";
}

export const TEAM_GENDERS = ["male", "female", "mixed"] as const;
export type TeamGender = (typeof TEAM_GENDERS)[number];
export const TEAM_GENDER_LABELS: Readonly<Record<TeamGender, string>> = {
  male: "Masculin",
  female: "Féminin",
  mixed: "Mixte",
};

/** Kinds of the entries of the calendar; a `match` has its own details (opponent, score…). */
export const CALENDAR_EVENT_KINDS = [
  "match",
  "tournament",
  "training_camp",
  "meeting",
  "social",
  "other",
] as const;
export type CalendarEventKind = (typeof CALENDAR_EVENT_KINDS)[number];
export const CALENDAR_EVENT_KIND_LABELS: Readonly<Record<CalendarEventKind, string>> = {
  match: "Match",
  tournament: "Tournoi",
  training_camp: "Stage",
  meeting: "Réunion, assemblée générale",
  social: "Soirée, fête du club",
  other: "Autre",
};

/** A `YYYY-MM-DD` day that exists in the calendar. */
export const DAY_PATTERN = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isDay(value: string): boolean {
  if (!DAY_PATTERN.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(value);
}

/** An `HH:MM` time of day, 00:00 to 23:59. */
export const TIME_OF_DAY_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/** A reference to a row of another kind, as the views carry it. */
export interface NamedRef {
  readonly id: number;
  readonly name: string;
}

export interface VenueView {
  readonly id: number;
  readonly name: string;
  readonly address: string;
  readonly postalCode: string;
  readonly city: string;
  /** How to get there, parking, entrance… */
  readonly accessInfo: string;
  /** WGS 84 coordinates, for the map; both or neither. */
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface TeamSummaryView {
  readonly id: number;
  readonly name: string;
  /** Category (`U13`, `Seniors`, `Loisirs`…). */
  readonly category: string;
  /** Level (`Départemental 1`, `Régional`…). */
  readonly level: string;
  readonly gender: TeamGender;
  readonly section: NamedRef | null;
  /** Page of the site presenting the team, linked from the blocks. */
  readonly pagePath: string | null;
}

export interface TrainingSlotView {
  readonly id: number;
  readonly team: NamedRef;
  readonly weekday: Weekday;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venue: NamedRef | null;
}

export interface TeamView extends TeamSummaryView {
  readonly description: string;
  readonly slots: readonly TrainingSlotView[];
}

export interface MatchView {
  readonly id: number;
  readonly team: (NamedRef & { readonly pagePath: string | null }) | null;
  /** Kick-off, epoch milliseconds. */
  readonly startsAt: number;
  /** At home (`true`) or away. */
  readonly home: boolean;
  readonly opponent: string;
  readonly competition: string;
  readonly venue: (NamedRef & { readonly city: string }) | null;
  /** Score of the club's team and of the opponent: both set once the result is published. */
  readonly scoreFor: number | null;
  readonly scoreAgainst: number | null;
}

export interface MatchQuery {
  /** Matches of one team; all teams when absent. */
  readonly teamId?: number;
  /**
   * `upcoming`: not played yet (kick-off to come, no result), soonest first; `results`: with a
   * published result, latest first.
   */
  readonly when: "upcoming" | "results";
  readonly limit: number;
}

/**
 * Read access to the sports content, for the blocks bound to it: the server reads its database,
 * the editor calls the API. Only public data: what any visitor of the site may see. The teams
 * and training times are those of the current season.
 */
export interface SportReader {
  matches(query: MatchQuery): Promise<readonly MatchView[]>;
  teams(query: { readonly sectionId?: number }): Promise<readonly TeamSummaryView[]>;
  /** A team of any season; `null` when it does not exist. */
  team(id: number): Promise<TeamView | null>;
  trainingSlots(query: {
    readonly teamId?: number;
    readonly sectionId?: number;
  }): Promise<readonly TrainingSlotView[]>;
  /** The venues, all of them or those of `ids`, by name. */
  venues(query: { readonly ids?: readonly number[] }): Promise<readonly VenueView[]>;
}

/** Most matches a block can ask for at once. */
export const MAX_MATCHES_PER_QUERY = 50;
