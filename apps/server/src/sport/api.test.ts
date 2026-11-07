import { auditLog, type Database, outboxEvents, trainingSlots } from "@sport-cms/db";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "../api-testing.js";

let harness: ApiHarness;
let db: Database;
let app: ReturnType<ApiHarness["app"]>;
let ownerCookie: string;
let editorCookie: string;
let coachCookie: string;
let coachId: string;
let memberCookie: string;

const PASSWORD = "mot-de-passe-2026";

beforeEach(async () => {
  harness = createApiHarness();
  app = harness.app();
  db = harness.db;
  const owner = await harness.createUser("owner");
  const editor = await harness.createUser("editor");
  const coach = await harness.createUser("coach");
  const member = await harness.createUser("member");
  coachId = coach.id;
  ownerCookie = await harness.signIn(owner.email, PASSWORD);
  editorCookie = await harness.signIn(editor.email, PASSWORD);
  coachCookie = await harness.signIn(coach.email, PASSWORD);
  memberCookie = await harness.signIn(member.email, PASSWORD);
});

afterEach(() => {
  db.$client.close();
});

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text === "" ? {} : JSON.parse(text) };
}

function events(): { type: string; payload: unknown }[] {
  return db
    .select({ type: outboxEvents.type, payload: outboxEvents.payload })
    .from(outboxEvents)
    .orderBy(asc(outboxEvents.id))
    .all();
}

async function season(name = "2026-2027"): Promise<number> {
  const created = await call("POST", "/api/sport/seasons", ownerCookie, {
    name,
    startsOn: `${name.slice(0, 4)}-09-01`,
    endsOn: `${name.slice(5, 9)}-06-30`,
  });
  expect(created.status).toBe(201);
  return (created.body.season as { id: number }).id;
}

async function team(seasonId: number, name: string, extra: Record<string, unknown> = {}) {
  const created = await call("POST", "/api/sport/teams", ownerCookie, {
    seasonId,
    name,
    category: "U13",
    ...extra,
  });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  return created.body.team as Record<string, unknown> & { id: number };
}

function matchBody(seasonId: number, teamId: number, overrides: Record<string, unknown> = {}) {
  return {
    seasonId,
    teamId,
    kind: "match",
    startsAt: Date.UTC(2026, 10, 14, 14, 0),
    match: { opponent: "FC Rival", home: true, competition: "Départemental 1" },
    ...overrides,
  };
}

describe("access to /api/sport", () => {
  it("is refused without a session, or without a sports permission", async () => {
    expect((await app.request("/api/sport/teams")).status).toBe(401);
    const member = await call("GET", "/api/sport/teams", memberCookie);
    expect(member.status).toBe(403);
    expect(member.body.error).toBe(
      "Accès refusé : la gestion des équipes ou des contenus sport est requise.",
    );
  });

  it("lets an editor manage everything and a coach read everything", async () => {
    expect(
      (await call("POST", "/api/sport/venues", editorCookie, { name: "Gymnase" })).status,
    ).toBe(201);
    expect((await call("GET", "/api/sport/venues", coachCookie)).status).toBe(200);
    const refused = await call("POST", "/api/sport/venues", coachCookie, { name: "Autre" });
    expect(refused.status).toBe(403);
    expect(refused.body.error).toBe(
      "Accès refusé : seul un responsable des contenus sport peut faire cela.",
    );
  });
});

describe("seasons", () => {
  it("makes the first season current, then one current season at a time", async () => {
    const first = await season("2025-2026");
    const second = await season("2026-2027");
    let list = (await call("GET", "/api/sport/seasons", ownerCookie)).body.seasons as {
      id: number;
      current: boolean;
    }[];
    expect(list.map((row) => [row.id, row.current])).toEqual([
      [first, true],
      [second, false],
    ]);
    const switched = await call("POST", `/api/sport/seasons/${second}/current`, ownerCookie);
    expect(switched.status).toBe(200);
    list = switched.body.seasons as typeof list;
    expect(list.map((row) => [row.id, row.current])).toEqual([
      [first, false],
      [second, true],
    ]);
    expect(events().filter((event) => event.type === "season.updated")).toHaveLength(3);
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, "sport.season_current")).all(),
    ).toHaveLength(1);
  });

  it("checks the days, refuses a second season of the same name, and keeps a used season", async () => {
    const invalid = await call("POST", "/api/sport/seasons", ownerCookie, {
      name: "2026-2027",
      startsOn: "2026-02-30",
      endsOn: "2026-01-01",
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields).toEqual({
      startsOn: "La date de début doit être une date valide (AAAA-MM-JJ).",
    });
    const reversed = await call("POST", "/api/sport/seasons", ownerCookie, {
      name: "2026-2027",
      startsOn: "2027-06-30",
      endsOn: "2026-09-01",
    });
    expect(reversed.body.fields).toEqual({ endsOn: "La saison doit finir après son début." });
    const id = await season("2026-2027");
    const duplicate = await call("POST", "/api/sport/seasons", ownerCookie, {
      name: "2026-2027",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    });
    expect(duplicate).toEqual({ status: 409, body: { error: "Une saison porte déjà ce nom." } });
    await team(id, "U13 A");
    const kept = await call("DELETE", `/api/sport/seasons/${id}`, ownerCookie);
    expect(kept.status).toBe(409);
    expect(kept.body.error).toBe(
      "Cette saison a des équipes ou des événements : supprimez-les d'abord.",
    );
  });
});

describe("venues", () => {
  it("needs both coordinates or none, within their ranges", async () => {
    const one = await call("POST", "/api/sport/venues", ownerCookie, {
      name: "Stade",
      latitude: 45.7,
    });
    expect(one.body.fields).toEqual({
      longitude: "Renseignez la latitude et la longitude, ou aucune des deux.",
    });
    const out = await call("POST", "/api/sport/venues", ownerCookie, {
      name: "Stade",
      latitude: 95,
      longitude: "4.8",
    });
    expect(out.body.fields).toEqual({
      latitude: "La latitude est comprise entre -90 et 90.",
      longitude: "Ce champ est invalide.",
    });
  });

  it("unlinks the training times and events of a deleted venue", async () => {
    const venue = await call("POST", "/api/sport/venues", ownerCookie, { name: "Gymnase" });
    const venueId = (venue.body.venue as { id: number }).id;
    const seasonId = await season();
    const created = await team(seasonId, "U13 A", {
      slots: [{ weekday: 3, startsAt: "17:30", endsAt: "19:00", venueId }],
    });
    expect((await call("DELETE", `/api/sport/venues/${venueId}`, ownerCookie)).status).toBe(204);
    expect(
      db.select().from(trainingSlots).where(eq(trainingSlots.teamId, created.id)).get(),
    ).toMatchObject({ venueId: null });
    expect(events().at(-1)).toEqual({
      type: "venue.updated",
      payload: { venueId, deleted: true },
    });
  });
});

describe("teams", () => {
  it("creates a team with its training times and coaches, and lists them", async () => {
    const seasonId = await season();
    const created = await team(seasonId, "U13 A", {
      gender: "female",
      pagePath: "/equipes/u13/",
      slots: [
        { weekday: 3, startsAt: "17:30", endsAt: "19:00" },
        { weekday: 1, startsAt: "18:00", endsAt: "19:30" },
      ],
      coachIds: [coachId],
    });
    expect(created).toMatchObject({
      name: "U13 A",
      gender: "female",
      pagePath: "/equipes/u13",
      canEdit: true,
      coaches: [{ id: coachId }],
    });
    expect((created.slots as { weekday: number }[]).map((slot) => slot.weekday)).toEqual([1, 3]);
    const listed = await call("GET", `/api/sport/teams?season=${seasonId}`, coachCookie);
    expect(listed.body.teams).toMatchObject([{ id: created.id, canEdit: true }]);
    expect(events().at(-1)).toEqual({ type: "team.updated", payload: { teamId: created.id } });
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, "sport.team_coaches_updated")).get(),
    ).toMatchObject({ targetId: String(created.id), details: { coaches: [coachId] } });
  });

  it("validates the training times and the references", async () => {
    const seasonId = await season();
    const invalid = await call("POST", "/api/sport/teams", ownerCookie, {
      seasonId,
      name: "U15",
      slots: [
        { weekday: 8, startsAt: "17:30", endsAt: "19:00" },
        { weekday: 2, startsAt: "19:00", endsAt: "18:00" },
        { weekday: 2, startsAt: "9:00", endsAt: "10:00" },
      ],
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields).toEqual({
      "slots.0.weekday": "Choisissez un jour.",
      "slots.1.endsAt": "L'entraînement doit finir après son début.",
      "slots.2.startsAt": "L'heure de début doit être de la forme 18:30.",
    });
    const unknown = await call("POST", "/api/sport/teams", ownerCookie, {
      seasonId,
      name: "U15",
      sectionId: 99,
    });
    expect(unknown.body.fields).toEqual({ sectionId: "Cette section n'existe pas." });
    const coaches = await call("POST", "/api/sport/teams", ownerCookie, {
      seasonId,
      name: "U15",
      coachIds: ["inconnu"],
    });
    expect(coaches.body.fields).toEqual({ "coachIds.0": "Ce compte n'existe pas." });
    await team(seasonId, "U15");
    const duplicate = await call("POST", "/api/sport/teams", ownerCookie, {
      seasonId,
      name: "U15",
    });
    expect(duplicate).toEqual({
      status: 409,
      body: { error: "Une équipe de cette saison porte déjà ce nom." },
    });
  });

  it("lets a coach edit the presentation and training times of their team only", async () => {
    const seasonId = await season();
    const mine = await team(seasonId, "U13 A", { coachIds: [coachId] });
    const other = await team(seasonId, "U13 B");
    const update = {
      seasonId,
      name: "U13 A",
      category: "U13",
      description: "Entraînés par Camille.",
      slots: [{ weekday: 2, startsAt: "17:00", endsAt: "18:30" }],
    };
    const saved = await call("PUT", `/api/sport/teams/${mine.id}`, coachCookie, update);
    expect(saved.status).toBe(200);
    expect(saved.body.team).toMatchObject({ description: "Entraînés par Camille." });

    const otherTeam = await call("PUT", `/api/sport/teams/${other.id}`, coachCookie, {
      ...update,
      name: "U13 B",
    });
    expect(otherTeam).toEqual({
      status: 403,
      body: {
        error: "Accès refusé : vous ne pouvez modifier que les équipes qui vous sont confiées.",
      },
    });
    const renamed = await call("PUT", `/api/sport/teams/${mine.id}`, coachCookie, {
      ...update,
      name: "Les meilleurs",
    });
    expect(renamed.status).toBe(403);
    const coaches = await call("PUT", `/api/sport/teams/${mine.id}`, coachCookie, {
      ...update,
      coachIds: [],
    });
    expect(coaches.status).toBe(403);
    expect(
      (await call("POST", "/api/sport/teams", coachCookie, { seasonId, name: "X" })).status,
    ).toBe(403);
    expect((await call("DELETE", `/api/sport/teams/${mine.id}`, coachCookie)).status).toBe(403);
    const listed = await call("GET", "/api/sport/teams", coachCookie);
    expect(
      (listed.body.teams as { id: number; canEdit: boolean }[]).map((row) => [row.id, row.canEdit]),
    ).toEqual([
      [mine.id, true],
      [other.id, false],
    ]);
  });

  it("keeps a team with events in the calendar", async () => {
    const seasonId = await season();
    const created = await team(seasonId, "U13 A");
    await call("POST", "/api/sport/events", ownerCookie, matchBody(seasonId, created.id));
    const refused = await call("DELETE", `/api/sport/teams/${created.id}`, ownerCookie);
    expect(refused.status).toBe(409);
  });
});

describe("calendar", () => {
  it("schedules a match, publishes its result and emits the events", async () => {
    const seasonId = await season();
    const created = await team(seasonId, "Seniors");
    const scheduled = await call(
      "POST",
      "/api/sport/events",
      ownerCookie,
      matchBody(seasonId, created.id),
    );
    expect(scheduled.status).toBe(201);
    const event = scheduled.body.event as { id: number; match: Record<string, unknown> };
    expect(event.match).toMatchObject({
      opponent: "FC Rival",
      scoreFor: null,
      resultPublishedAt: null,
    });
    const startsAt = Date.UTC(2026, 10, 14, 14, 0);
    const payload = { matchId: event.id, teamId: created.id, seasonId, startsAt };
    expect(events().at(-1)).toEqual({ type: "match.scheduled", payload });

    const scored = await call(
      "PUT",
      `/api/sport/events/${event.id}`,
      ownerCookie,
      matchBody(seasonId, created.id, {
        match: { opponent: "FC Rival", home: true, scoreFor: 3, scoreAgainst: 1 },
      }),
    );
    expect(scored.status).toBe(200);
    expect(
      (scored.body.event as { match: { resultPublishedAt: unknown } }).match.resultPublishedAt,
    ).toEqual(expect.any(Number));
    expect(events().slice(-2)).toEqual([
      { type: "match.updated", payload },
      { type: "match.result_published", payload: { ...payload, scoreFor: 3, scoreAgainst: 1 } },
    ]);

    // Saved again with the same score: an update, not a new result.
    await call(
      "PUT",
      `/api/sport/events/${event.id}`,
      ownerCookie,
      matchBody(seasonId, created.id, {
        match: {
          opponent: "FC Rival",
          home: true,
          scoreFor: 3,
          scoreAgainst: 1,
          report: "Beau match.",
        },
      }),
    );
    expect(events().at(-1)?.type).toBe("match.updated");

    expect((await call("DELETE", `/api/sport/events/${event.id}`, ownerCookie)).status).toBe(204);
    expect(events().at(-1)).toEqual({ type: "match.deleted", payload });
  });

  it("validates matches and other events", async () => {
    const seasonId = await season();
    const created = await team(seasonId, "Seniors");
    const other = await season("2027-2028");
    const invalid = await call("POST", "/api/sport/events", ownerCookie, {
      seasonId,
      kind: "match",
      startsAt: 1,
      endsAt: 0,
    });
    expect(invalid.body.fields).toEqual({
      endsAt: "L'événement doit finir après son début.",
      teamId: "Choisissez l'équipe qui joue le match.",
      match: "Les informations du match sont requises.",
    });
    const half = await call(
      "POST",
      "/api/sport/events",
      ownerCookie,
      matchBody(seasonId, created.id, { match: { opponent: "FC", scoreFor: 2 } }),
    );
    expect(half.body.fields).toEqual({
      "match.scoreAgainst": "Saisissez les deux scores, ou aucun.",
    });
    const wrongSeason = await call(
      "POST",
      "/api/sport/events",
      ownerCookie,
      matchBody(other, created.id),
    );
    expect(wrongSeason.body.fields).toEqual({
      teamId: "Cette équipe n'appartient pas à la saison choisie.",
    });
    const untitled = await call("POST", "/api/sport/events", ownerCookie, {
      seasonId,
      kind: "social",
      startsAt: 1,
    });
    expect(untitled.body.fields).toEqual({ title: "Le titre est requis." });
    const party = await call("POST", "/api/sport/events", ownerCookie, {
      seasonId,
      kind: "social",
      title: "Soirée du club",
      startsAt: 1,
    });
    expect(party.status).toBe(201);
    expect(events().at(-1)?.type).toBe("event.created");
    const id = (party.body.event as { id: number }).id;
    const kind = await call("PUT", `/api/sport/events/${id}`, ownerCookie, {
      ...matchBody(seasonId, created.id),
    });
    expect(kind.body.fields).toEqual({
      kind: "Le type d'un événement ne change pas : supprimez-le et créez-en un autre.",
    });
  });

  it("lets a coach enter the results of their team only", async () => {
    const seasonId = await season();
    const mine = await team(seasonId, "U13 A", { coachIds: [coachId] });
    const other = await team(seasonId, "U13 B");
    const own = await call("POST", "/api/sport/events", coachCookie, matchBody(seasonId, mine.id));
    expect(own.status).toBe(201);
    const ownId = (own.body.event as { id: number }).id;
    const result = await call(
      "PUT",
      `/api/sport/events/${ownId}`,
      coachCookie,
      matchBody(seasonId, mine.id, {
        match: { opponent: "FC Rival", scoreFor: 1, scoreAgainst: 1 },
      }),
    );
    expect(result.status).toBe(200);

    const theirs = await call(
      "POST",
      "/api/sport/events",
      ownerCookie,
      matchBody(seasonId, other.id),
    );
    const theirsId = (theirs.body.event as { id: number }).id;
    const score = matchBody(seasonId, other.id, {
      match: { opponent: "FC Rival", scoreFor: 9, scoreAgainst: 0 },
    });
    expect((await call("PUT", `/api/sport/events/${theirsId}`, coachCookie, score)).status).toBe(
      403,
    );
    expect((await call("DELETE", `/api/sport/events/${theirsId}`, coachCookie)).status).toBe(403);
    // Moving their own match to the other team is refused too.
    const moved = await call(
      "PUT",
      `/api/sport/events/${ownId}`,
      coachCookie,
      matchBody(seasonId, other.id),
    );
    expect(moved.status).toBe(403);
    // And so is a club event, which belongs to no team.
    const club = await call("POST", "/api/sport/events", coachCookie, {
      seasonId,
      kind: "meeting",
      title: "Assemblée générale",
      startsAt: 1,
    });
    expect(club.status).toBe(403);
    const listed = await call("GET", "/api/sport/events", coachCookie);
    expect(
      (listed.body.events as { id: number; canEdit: boolean }[]).map((row) => [
        row.id,
        row.canEdit,
      ]),
    ).toEqual([
      [ownId, true],
      [theirsId, false],
    ]);
  });
});

describe("/api/block-data", () => {
  it("gives the editor the choices of the reference fields and the data of the blocks", async () => {
    const past = await season("2025-2026");
    const current = await season("2026-2027");
    await call("POST", `/api/sport/seasons/${current}/current`, ownerCookie);
    await team(past, "U13 A");
    const seniors = await team(current, "Seniors");
    const references = await call("GET", "/api/block-data/references", editorCookie);
    expect(references.status).toBe(200);
    expect(references.body.teams).toEqual([
      { value: seniors.id, label: "Seniors" },
      { value: expect.any(Number), label: "U13 A (2025-2026)" },
    ]);
    const read = await call(
      "GET",
      `/api/block-data/read?method=teams&query=${encodeURIComponent("{}")}`,
      editorCookie,
    );
    expect((read.body.result as { name: string }[]).map((row) => row.name)).toEqual(["Seniors"]);
    expect(
      (await call("GET", "/api/block-data/read?method=delete&query={}", editorCookie)).status,
    ).toBe(400);
    expect(
      (await call("GET", "/api/block-data/read?method=matches&query={}", editorCookie)).status,
    ).toBe(400);
    expect((await call("GET", "/api/block-data/references", coachCookie)).status).toBe(403);
  });
});
