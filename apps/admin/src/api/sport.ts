import type { CalendarEventKind, TeamGender } from "@sport-cms/core";
import { requestJson } from "./client";

/** Typed client of the admin API of the sports content (`/api/sport`). */

export interface Section {
  readonly id: number;
  readonly name: string;
  readonly sport: string;
  readonly position: number;
}

export interface Season {
  readonly id: number;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly current: boolean;
}

export interface Venue {
  readonly id: number;
  readonly name: string;
  readonly address: string;
  readonly postalCode: string;
  readonly city: string;
  readonly accessInfo: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
}

export interface TrainingSlot {
  readonly weekday: number;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venueId: number | null;
}

export interface Account {
  readonly id: string;
  readonly name: string;
  readonly email: string;
}

export interface Team {
  readonly id: number;
  readonly seasonId: number;
  readonly sectionId: number | null;
  readonly name: string;
  readonly category: string;
  readonly level: string;
  readonly gender: TeamGender;
  readonly description: string;
  readonly pagePath: string | null;
  readonly position: number;
  readonly coaches: readonly Account[];
  readonly slots: readonly (TrainingSlot & { readonly id: number })[];
  /** Whether the signed-in account may edit it (a coach: only the teams assigned). */
  readonly canEdit: boolean;
}

export interface TeamInput {
  readonly seasonId: number;
  readonly sectionId: number | null;
  readonly name: string;
  readonly category: string;
  readonly level: string;
  readonly gender: TeamGender;
  readonly description: string;
  readonly pagePath: string;
  readonly position: number;
  readonly slots: readonly TrainingSlot[];
  /** Sent by whoever manages the sports content only. */
  readonly coachIds?: readonly string[];
}

export interface MatchDetails {
  readonly home: boolean;
  readonly opponent: string;
  readonly competition: string;
  readonly scoreFor: number | null;
  readonly scoreAgainst: number | null;
  readonly report: string;
}

export interface CalendarEvent {
  readonly id: number;
  readonly seasonId: number;
  readonly teamId: number | null;
  readonly kind: CalendarEventKind;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly venueId: number | null;
  readonly description: string;
  readonly match: (MatchDetails & { readonly resultPublishedAt: number | null }) | null;
  readonly canEdit: boolean;
}

export interface CalendarEventInput {
  readonly seasonId: number;
  readonly teamId: number | null;
  readonly kind: CalendarEventKind;
  readonly title: string;
  readonly startsAt: number;
  readonly endsAt: number | null;
  readonly venueId: number | null;
  readonly description: string;
  readonly match?: MatchDetails;
}

export type SectionInput = Omit<Section, "id">;
export type SeasonInput = Omit<Season, "id" | "current">;
export type VenueInput = Omit<Venue, "id">;

const LOAD = "Impossible de charger les contenus sport. Réessayez.";
const SAVE = "L'enregistrement a échoué. Réessayez.";
const DELETE = "La suppression a échoué. Réessayez.";

export async function listSections(): Promise<Section[]> {
  return (await requestJson<{ sections: Section[] }>("/api/sport/sections", { fallback: LOAD }))
    .sections;
}

export async function saveSection(id: number | undefined, input: SectionInput): Promise<Section> {
  const body = await requestJson<{ section: Section }>(
    id === undefined ? "/api/sport/sections" : `/api/sport/sections/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
  );
  return body.section;
}

export async function deleteSection(id: number): Promise<void> {
  await requestJson<unknown>(`/api/sport/sections/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listSeasons(): Promise<Season[]> {
  return (await requestJson<{ seasons: Season[] }>("/api/sport/seasons", { fallback: LOAD }))
    .seasons;
}

export async function saveSeason(id: number | undefined, input: SeasonInput): Promise<Season> {
  const body = await requestJson<{ season: Season }>(
    id === undefined ? "/api/sport/seasons" : `/api/sport/seasons/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
  );
  return body.season;
}

export async function makeSeasonCurrent(id: number): Promise<Season[]> {
  const body = await requestJson<{ seasons: Season[] }>(`/api/sport/seasons/${id}/current`, {
    method: "POST",
    body: {},
    fallback: SAVE,
  });
  return body.seasons;
}

export async function deleteSeason(id: number): Promise<void> {
  await requestJson<unknown>(`/api/sport/seasons/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listVenues(): Promise<Venue[]> {
  return (await requestJson<{ venues: Venue[] }>("/api/sport/venues", { fallback: LOAD })).venues;
}

export async function saveVenue(id: number | undefined, input: VenueInput): Promise<Venue> {
  const body = await requestJson<{ venue: Venue }>(
    id === undefined ? "/api/sport/venues" : `/api/sport/venues/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
  );
  return body.venue;
}

export async function deleteVenue(id: number): Promise<void> {
  await requestJson<unknown>(`/api/sport/venues/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listTeams(seasonId?: number): Promise<Team[]> {
  const query = seasonId === undefined ? "" : `?season=${seasonId}`;
  return (await requestJson<{ teams: Team[] }>(`/api/sport/teams${query}`, { fallback: LOAD }))
    .teams;
}

export async function listCoaches(): Promise<Account[]> {
  return (await requestJson<{ coaches: Account[] }>("/api/sport/coaches", { fallback: LOAD }))
    .coaches;
}

export async function saveTeam(id: number | undefined, input: TeamInput): Promise<Team> {
  const body = await requestJson<{ team: Team }>(
    id === undefined ? "/api/sport/teams" : `/api/sport/teams/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
  );
  return body.team;
}

export async function deleteTeam(id: number): Promise<void> {
  await requestJson<unknown>(`/api/sport/teams/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listEvents(seasonId?: number): Promise<CalendarEvent[]> {
  const query = seasonId === undefined ? "" : `?season=${seasonId}`;
  return (
    await requestJson<{ events: CalendarEvent[] }>(`/api/sport/events${query}`, { fallback: LOAD })
  ).events;
}

export async function saveEvent(
  id: number | undefined,
  input: CalendarEventInput,
): Promise<CalendarEvent> {
  const body = await requestJson<{ event: CalendarEvent }>(
    id === undefined ? "/api/sport/events" : `/api/sport/events/${id}`,
    { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
  );
  return body.event;
}

export async function deleteEvent(id: number): Promise<void> {
  await requestJson<unknown>(`/api/sport/events/${id}`, { method: "DELETE", fallback: DELETE });
}
