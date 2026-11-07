import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupBody } from "../auth/testing.js";
import { type BootedInstance, bootInstance } from "../boot.js";

/*
 * The sports content on a whole instance, as `main.ts` wires it: the admin API, the public site,
 * its HTML cache and the scheduler that delivers the events to it.
 */

const BASE_URL = "http://localhost:3000";
let dataDir: string;
let instance: BootedInstance | undefined;
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-sport-"));
  logger.error.mockReset();
});

afterEach(() => {
  instance?.close();
  instance = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function start(): Promise<{ booted: BootedInstance; cookie: string }> {
  instance = await bootInstance(
    { DATA_DIR: dataDir, BASE_URL, SECRET_KEY: randomBytes(32).toString("base64") },
    { logger, adminDirectory: dataDir, officialModules: [] },
  );
  const response = await instance.app.request("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify(setupBody()),
  });
  expect(response.status).toBe(201);
  return {
    booted: instance,
    cookie: (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "",
  };
}

async function send(
  booted: BootedInstance,
  cookie: string,
  method: "POST" | "PUT",
  path: string,
  body?: unknown,
): Promise<Record<string, unknown>> {
  const response = await booted.app.request(path, {
    method,
    headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  expect(response.status, `${method} ${path} : ${text}`).toBeLessThan(300);
  return text === "" ? {} : JSON.parse(text);
}

function pageData(title: string, ...blocks: { type: string; props: JsonObject }[]): JsonObject {
  return {
    root: { props: { title } },
    content: [
      {
        type: "Hero",
        props: {
          id: "hero",
          title,
          subtitle: "",
          imageSrc: "",
          imageAlt: "",
          decorative: false,
          ctaLabel: "",
          ctaHref: "",
        },
      },
      {
        type: "Section",
        props: {
          id: "section",
          background: "default",
          content: blocks.map((block, index) => ({
            type: block.type,
            props: { id: `${block.type}-${index}`, ...block.props },
          })),
        },
      },
    ],
    zones: {},
  };
}

async function publishPage(
  booted: BootedInstance,
  cookie: string,
  path: string,
  data: JsonObject,
): Promise<void> {
  await send(booted, cookie, "POST", "/api/pages", { path, title: path });
  const query = `?path=${encodeURIComponent(path)}`;
  await send(booted, cookie, "PUT", `/api/pages/page${query}`, { data });
  await send(booted, cookie, "POST", `/api/pages/publish${query}`);
}

async function html(booted: BootedInstance, path: string): Promise<string> {
  const response = await booted.app.request(path);
  expect(response.status).toBe(200);
  return response.text();
}

describe("sports content on the public site", () => {
  it("shows a score entered in the back-office on the home page and the team page", async () => {
    const { booted, cookie } = await start();
    const season = (await send(booted, cookie, "POST", "/api/sport/seasons", {
      name: "2026-2027",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    })) as { season: { id: number } };
    const seasonId = season.season.id;
    const venue = (await send(booted, cookie, "POST", "/api/sport/venues", {
      name: "Stade municipal",
      city: "Lyon",
    })) as { venue: { id: number } };
    const team = (await send(booted, cookie, "POST", "/api/sport/teams", {
      seasonId,
      name: "Seniors A",
      category: "Seniors",
      pagePath: "/equipes/seniors",
      slots: [{ weekday: 2, startsAt: "19:30", endsAt: "21:00", venueId: venue.venue.id }],
    })) as { team: { id: number } };
    const teamId = team.team.id;
    // Played yesterday, result not entered yet.
    const match = (await send(booted, cookie, "POST", "/api/sport/events", {
      seasonId,
      teamId,
      kind: "match",
      startsAt: Date.now() - 86_400_000,
      venueId: venue.venue.id,
      match: { opponent: "FC Rival", home: true, competition: "Départemental 1" },
    })) as { event: { id: number } };
    // Next week.
    await send(booted, cookie, "POST", "/api/sport/events", {
      seasonId,
      teamId,
      kind: "match",
      startsAt: Date.now() + 7 * 86_400_000,
      match: { opponent: "AS Voisins", home: false },
    });

    await publishPage(
      booted,
      cookie,
      "/",
      pageData(
        "Accueil",
        { type: "UpcomingMatches", props: { title: "Prochains matchs", teamId: 0, count: 5 } },
        { type: "LatestResults", props: { title: "Derniers résultats", teamId: 0, count: 5 } },
      ),
    );
    await publishPage(
      booted,
      cookie,
      "/equipes/seniors",
      pageData("Seniors A", {
        type: "TeamProfile",
        props: { teamId, showSchedule: true, showMatches: true },
      }),
    );
    await publishPage(booted, cookie, "/club", pageData("Le club"));
    // The events of the setup so far are delivered: from now on, only the score is new.
    await booted.runtime.tick();

    let home = await html(booted, "/");
    expect(home).toContain("AS Voisins");
    expect(home).toContain("Aucun résultat pour le moment.");
    expect(home).not.toContain("FC Rival");
    let teamPage = await html(booted, "/equipes/seniors");
    expect(teamPage).toContain("Mardi");
    expect(teamPage).toContain("Stade municipal");
    expect(teamPage).not.toContain("FC Rival");
    await html(booted, "/club");
    expect(booted.htmlCache.size).toBe(3);

    await send(booted, cookie, "PUT", `/api/sport/events/${match.event.id}`, {
      seasonId,
      teamId,
      kind: "match",
      startsAt: Date.now() - 86_400_000,
      venueId: venue.venue.id,
      match: {
        opponent: "FC Rival",
        home: true,
        competition: "Départemental 1",
        scoreFor: 3,
        scoreAgainst: 1,
      },
    });
    // Delivered by the scheduler (`main.ts` runs it every second and on every emission).
    await booted.runtime.tick();

    home = await html(booted, "/");
    expect(home).toContain('<span class="cms-match__score"> 3 – 1 </span>');
    expect(home).toContain("Victoire");
    teamPage = await html(booted, "/equipes/seniors");
    expect(teamPage).toContain('<span class="cms-match__score"> 3 – 1 </span>');
    // The page without sports blocks stayed in the cache.
    expect(booted.htmlCache.get("/club")).toBeDefined();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("shows the venues with the OpenStreetMap frame the policy allows", async () => {
    const { booted, cookie } = await start();
    await send(booted, cookie, "POST", "/api/sport/venues", {
      name: "Gymnase Jean Moulin",
      address: "12 avenue des Sports",
      postalCode: "69003",
      city: "Lyon",
      latitude: 45.75,
      longitude: 4.85,
    });
    await publishPage(
      booted,
      cookie,
      "/infos",
      pageData("Infos pratiques", {
        type: "Venues",
        props: { title: "Nos installations", venueId: 0, showMap: true },
      }),
    );
    const response = await booted.app.request("/infos");
    const body = await response.text();
    expect(body).toContain("Gymnase Jean Moulin");
    expect(body).toContain('src="https://www.openstreetmap.org/export/embed.html?');
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-src https://www.openstreetmap.org",
    );
  });
});
