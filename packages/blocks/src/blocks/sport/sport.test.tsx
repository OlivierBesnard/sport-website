import type { MatchView, SportReader, TeamView, VenueView } from "@sport-cms/core";
import { BLOCKS_CSS } from "@sport-cms/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createBlockRegistry } from "../../registry.js";
import { loadPageBlocks } from "../../server/load.js";
import { renderPageContent } from "../../server/render.js";
import { coreBlocks } from "../index.js";
import { osmEmbedUrl } from "./venues.js";

const registry = createBlockRegistry(coreBlocks);

// Local time, as the blocks show it.
const kickOff = new Date(2026, 10, 14, 15, 0).getTime();

const upcoming: MatchView = {
  id: 1,
  team: { id: 7, name: "Seniors A", pagePath: "/equipes/seniors" },
  startsAt: kickOff,
  home: true,
  opponent: "FC Rival",
  competition: "Départemental 1",
  venue: { id: 3, name: "Stade municipal", city: "Lyon" },
  scoreFor: null,
  scoreAgainst: null,
};

const result: MatchView = {
  ...upcoming,
  id: 2,
  home: false,
  opponent: "AS Voisins",
  scoreFor: 2,
  scoreAgainst: 1,
  venue: null,
};

const venue: VenueView = {
  id: 3,
  name: "Stade municipal",
  address: "1 rue du Stade",
  postalCode: "69001",
  city: "Lyon",
  accessInfo: "Parking derrière la tribune.\nEntrée par le portail bleu.",
  latitude: 45.764,
  longitude: 4.8357,
};

const team: TeamView = {
  id: 7,
  name: "Seniors A",
  category: "Seniors",
  level: "Départemental 1",
  gender: "male",
  section: null,
  pagePath: "/equipes/seniors",
  description: "L'équipe fanion du club.",
  slots: [
    {
      id: 11,
      team: { id: 7, name: "Seniors A" },
      weekday: 4,
      startsAt: "19:30",
      endsAt: "21:00",
      venue: { id: 3, name: "Stade municipal" },
    },
    {
      id: 10,
      team: { id: 7, name: "Seniors A" },
      weekday: 2,
      startsAt: "19:30",
      endsAt: "21:00",
      venue: null,
    },
  ],
};

function reader(): SportReader {
  return {
    matches: vi.fn(async ({ when }) => (when === "upcoming" ? [upcoming] : [result])),
    teams: vi.fn(async () => [team]),
    team: vi.fn(async (id) => (id === team.id ? team : null)),
    trainingSlots: vi.fn(async () => team.slots),
    venues: vi.fn(async () => [venue]),
  };
}

async function render(
  type: string,
  props: Record<string, unknown> = {},
  sport: SportReader = reader(),
  expiresAt: (date: Date) => void = () => {},
): Promise<string> {
  const data = { root: { props: {} }, content: [{ type, props: { id: `${type}-1`, ...props } }] };
  const onBlockError = vi.fn();
  const loaded = await loadPageBlocks(data, {
    registry,
    context: { sport, now: new Date(kickOff - 86_400_000), expiresAt },
    onBlockError,
  });
  const html = renderToStaticMarkup(renderPageContent(data, { registry, loaded, onBlockError }));
  expect(onBlockError).not.toHaveBeenCalled();
  return html;
}

describe("UpcomingMatches", () => {
  it("lists the next matches, the home side first, until the first kick-off", async () => {
    const sport = reader();
    const expiresAt = vi.fn();
    const html = await render("UpcomingMatches", { teamId: 7, count: 3 }, sport, expiresAt);
    expect(sport.matches).toHaveBeenCalledWith({ when: "upcoming", limit: 3, teamId: 7 });
    expect(expiresAt).toHaveBeenCalledWith(new Date(kickOff));
    expect(html).toContain('<h2 class="cms-heading">Prochains matchs</h2>');
    expect(html).toContain("Samedi 14 novembre");
    expect(html).toContain("15:00");
    expect(html).toContain(
      '<p class="cms-match__teams"><a href="/equipes/seniors">Seniors A</a><span class="cms-match__versus"> – </span><span>FC Rival</span></p>',
    );
    expect(html).toContain("Départemental 1 · À domicile · Stade municipal, Lyon");
  });

  it("asks for every team with 0, and says when nothing is planned", async () => {
    const sport = reader();
    vi.mocked(sport.matches).mockResolvedValue([]);
    const html = await render("UpcomingMatches", { teamId: 0 }, sport);
    expect(sport.matches).toHaveBeenCalledWith({ when: "upcoming", limit: 5 });
    expect(html).toContain("Aucun match à venir pour le moment.");
  });
});

describe("LatestResults", () => {
  it("shows the score from the home side, and the outcome in words", async () => {
    const html = await render("LatestResults");
    // Away: the opponent first, its score first.
    expect(html).toContain(
      '<span>AS Voisins</span><span class="cms-match__score"> 1 – 2 </span><a href="/equipes/seniors">Seniors A</a>',
    );
    expect(html).toContain("Victoire");
    expect(html).toContain("À l&#x27;extérieur");
  });
});

describe("TeamGrid", () => {
  it("shows the teams of the season linked to their pages", async () => {
    const html = await render("TeamGrid");
    expect(html).toContain('<a href="/equipes/seniors">Seniors A</a>');
    expect(html).toContain("Seniors · Départemental 1 · Masculin");
  });
});

describe("TeamProfile", () => {
  it("presents the team, its training times by day and its matches", async () => {
    const html = await render("TeamProfile", { teamId: 7 });
    expect(html).toContain('<h2 class="cms-heading">Seniors A</h2>');
    expect(html).toContain("L&#x27;équipe fanion du club.");
    expect(html.indexOf("Mardi")).toBeLessThan(html.indexOf("Jeudi"));
    expect(html).toContain("19 h 30 – 21 h 00");
    expect(html).toContain("FC Rival");
    expect(html).toContain("AS Voisins");
  });

  it("shows nothing for a team not chosen or deleted", async () => {
    expect(await render("TeamProfile", { teamId: 0 })).toBe("");
    expect(await render("TeamProfile", { teamId: 99 })).toBe("");
  });
});

describe("TrainingSchedule", () => {
  it("is a table with the team column only when all teams are shown", async () => {
    const all = await render("TrainingSchedule");
    expect(all).toContain('<th scope="col">Équipe</th>');
    const one = await render("TrainingSchedule", { teamId: 7 });
    expect(one).not.toContain('<th scope="col">Équipe</th>');
  });
});

describe("Venues", () => {
  it("shows the address, the access, and a sandboxed OpenStreetMap map", async () => {
    const html = await render("Venues");
    expect(html).toContain('<span class="cms-venue__line">1 rue du Stade</span>');
    expect(html).toContain('<span class="cms-venue__line">69001 Lyon</span>');
    expect(html).toContain(
      '<p class="cms-plain-text">Parking derrière la tribune.\nEntrée par le portail bleu.</p>',
    );
    expect(html).toContain('sandbox="allow-scripts"');
    expect(html).toContain('referrerPolicy="no-referrer"');
    expect(html).toContain('loading="lazy"');
    expect(html).toContain(`src="${osmEmbedUrl(45.764, 4.8357).replaceAll("&", "&amp;")}"`);
    expect(html).toContain("https://www.openstreetmap.org/?mlat=45.764000&amp;mlon=4.835700");
    const noMap = await render("Venues", { showMap: false });
    expect(noMap).not.toContain("<iframe");
    expect(noMap).toContain("Voir « Stade municipal » sur OpenStreetMap");
  });

  it("shows no map without coordinates", async () => {
    const sport = reader();
    vi.mocked(sport.venues).mockResolvedValue([{ ...venue, latitude: null, longitude: null }]);
    const html = await render("Venues", {}, sport);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("openstreetmap");
  });
});

describe("sports blocks", () => {
  it("depend on the events that change what they show", () => {
    for (const type of ["UpcomingMatches", "LatestResults", "TeamProfile"]) {
      expect(registry.get(type)?.dependsOn).toEqual(
        expect.arrayContaining(["match.result_published", "match.updated", "match.scheduled"]),
      );
    }
    expect(registry.get("TeamGrid")?.dependsOn).toContain("team.updated");
    expect(registry.get("Venues")?.dependsOn).toEqual(["venue.updated"]);
  });

  it("only use classes styled by the theme", async () => {
    const pages = [
      await render("UpcomingMatches"),
      await render("LatestResults"),
      await render("TeamGrid"),
      await render("TeamProfile", { teamId: 7 }),
      await render("TrainingSchedule"),
      await render("Venues"),
    ];
    const classes = new Set<string>();
    for (const html of pages) {
      for (const attribute of html.matchAll(/class="([^"]*)"/g)) {
        for (const className of (attribute[1] ?? "").split(" ")) {
          if (className.startsWith("cms-")) {
            classes.add(className);
          }
        }
      }
    }
    expect(classes.size).toBeGreaterThan(15);
    for (const className of classes) {
      expect(BLOCKS_CSS, `.${className} is rendered but has no rule in BLOCKS_CSS`).toContain(
        `.${className}`,
      );
    }
  });
});
