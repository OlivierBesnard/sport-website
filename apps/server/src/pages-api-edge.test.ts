import { type Database, type JsonObject, pages } from "@sport-cms/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, sampleData } from "./api-testing.js";

/**
 * Edge cases of the admin API of the pages and of the navigation, written by the tester of E06:
 * the URLs are built the way the back-office client builds them (`apps/admin/src/api/pages.ts`:
 * `/api/pages/<action>?path=<encoded page path>`), the home page `/` included, and the menu is
 * checked on every cached page after a change of the pages it points at.
 */

let harness: ApiHarness;
let db: Database;
let ownerCookie: string;
/**
 * One application per test, as in production: `createApp` empties the shared HTML cache the
 * first time each new application serves a page, so a fresh `harness.app()` per request would
 * hide every stale cache entry.
 */
let app: ReturnType<ApiHarness["app"]>;

beforeEach(async () => {
  harness = createApiHarness();
  app = harness.app();
  db = harness.db;
  const owner = await harness.createUser("owner");
  ownerCookie = await harness.signIn(owner.email, "mot-de-passe-2026");
});

afterEach(() => {
  if (db.$client.open) {
    db.$client.close();
  }
});

/** URL of an action of the pages API on the page at `path`, as the back-office client builds it. */
function pageUrl(action: string, path: string): string {
  return `/api/pages/${action}?path=${encodeURIComponent(path)}`;
}

function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  cookie: string | null = ownerCookie,
  body?: unknown,
): Promise<Response> {
  return Promise.resolve(
    app.request(url, {
      method,
      headers: {
        ...(cookie === null ? {} : { cookie }),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

async function createPage(path: string, title: string, data?: JsonObject): Promise<number> {
  const created = await call("POST", "/api/pages", ownerCookie, { path, title });
  expect(created.status, path).toBe(201);
  if (data !== undefined) {
    const saved = await call("PUT", pageUrl("page", path), ownerCookie, { data });
    expect(saved.status, path).toBe(200);
  }
  const row = db.select({ id: pages.id }).from(pages).where(eq(pages.path, path)).get();
  if (row === undefined) {
    throw new Error(`Page ${path} absente.`);
  }
  return row.id;
}

function publish(path: string): Promise<Response> {
  return call("POST", pageUrl("publish", path));
}

async function publicHtml(path: string): Promise<string> {
  const response = await app.request(path);
  expect(response.status, path).toBe(200);
  return response.text();
}

describe("home page `/` through the URLs of the back-office client", () => {
  it("reads the draft of the home page", async () => {
    await createPage("/", "Accueil", sampleData());
    const response = await call("GET", pageUrl("page", "/"));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { path?: string }).path).toBe("/");
  });

  it("saves the draft of the home page", async () => {
    await createPage("/", "Accueil");
    const response = await call("PUT", pageUrl("page", "/"), ownerCookie, {
      data: sampleData(),
    });
    expect(response.status).toBe(200);
  });

  it("publishes the home page, which the public site then serves", async () => {
    await createPage("/", "Accueil", sampleData());
    const response = await publish("/");
    expect(response.status).toBe(200);
    expect((await app.request("/")).status).toBe(200);
  });

  it("lists the versions of the home page", async () => {
    await createPage("/", "Accueil", sampleData());
    await publish("/");
    const response = await call("GET", pageUrl("versions", "/"));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { versions?: unknown[] }).versions).toHaveLength(1);
  });

  it("deletes the home page", async () => {
    await createPage("/", "Accueil");
    const response = await call("DELETE", pageUrl("page", "/"));
    expect(response.status).toBe(204);
  });
});

describe("pages whose path ends like an action of the API", () => {
  it("reads a page whose last segment is `versions`", async () => {
    await createPage("/equipe/versions", "Versions de l'équipe", sampleData());
    const response = await call("GET", pageUrl("page", "/equipe/versions"));
    expect(response.status).toBe(200);
    expect(((await response.json()) as { path?: string }).path).toBe("/equipe/versions");
  });

  it("publishes a page whose last segment is `publish`", async () => {
    await createPage("/publish", "Publier", sampleData());
    expect((await publish("/publish")).status).toBe(200);
    expect((await app.request("/publish")).status).toBe(200);
  });
});

describe("the menu on the cached public pages follows the pages it points at", () => {
  it("renaming a page in the menu updates the link on the other cached pages", async () => {
    const clubId = await createPage("/le-club", "Le club", sampleData());
    await createPage("/contact", "Contact", sampleData());
    await publish("/le-club");
    await publish("/contact");
    const menu = await call("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Le club", pageId: clubId }],
    });
    expect(menu.status).toBe(200);
    // `/contact` is rendered and cached with the link to `/le-club`.
    expect(await publicHtml("/contact")).toContain('href="/le-club"');

    const renamed = await call("POST", "/api/pages/rename?path=/le-club", ownerCookie, {
      path: "/histoire",
    });
    expect(renamed.status).toBe(200);

    const html = await publicHtml("/contact");
    expect(html).toContain('href="/histoire"');
    expect(html).not.toContain('href="/le-club"');
  });

  it("deleting a page in the menu removes its link from the other cached pages", async () => {
    const clubId = await createPage("/le-club", "Le club", sampleData());
    await createPage("/contact", "Contact", sampleData());
    await publish("/le-club");
    await publish("/contact");
    await call("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Le club", pageId: clubId }],
    });
    expect(await publicHtml("/contact")).toContain('href="/le-club"');

    expect((await call("DELETE", "/api/pages/page?path=/le-club")).status).toBe(204);

    expect(await publicHtml("/contact")).not.toContain('href="/le-club"');
  });
});

describe("rights on every route of the pages API", () => {
  it("refuses each route 401 without a session and 403 for a coach or a treasurer", async () => {
    await createPage("/le-club", "Le club", sampleData());
    const coach = await harness.createUser("coach");
    const treasurer = await harness.createUser("treasurer");
    const cookies = [
      await harness.signIn(coach.email, "mot-de-passe-2026"),
      await harness.signIn(treasurer.email, "mot-de-passe-2026"),
    ];
    const routes: Array<["GET" | "POST" | "PUT" | "DELETE", string, unknown?]> = [
      ["GET", "/api/pages"],
      ["POST", "/api/pages", { path: "/x", title: "X" }],
      ["GET", "/api/pages/page?path=/le-club"],
      ["PUT", "/api/pages/page?path=/le-club", { data: sampleData() }],
      ["POST", "/api/pages/publish?path=/le-club"],
      ["POST", "/api/pages/unpublish?path=/le-club"],
      ["GET", "/api/pages/versions?path=/le-club"],
      ["POST", "/api/pages/restore?path=/le-club", { version: 1 }],
      ["POST", "/api/pages/rename?path=/le-club", { path: "/y" }],
      ["DELETE", "/api/pages/page?path=/le-club"],
      ["GET", "/api/navigation"],
      ["PUT", "/api/navigation", { menu: "main", items: [] }],
    ];
    for (const [method, url, body] of routes) {
      expect((await call(method, url, null, body)).status, `${method} ${url}`).toBe(401);
      for (const cookie of cookies) {
        expect((await call(method, url, cookie, body)).status, `${method} ${url}`).toBe(403);
      }
    }
    // Nothing changed.
    const row = db.select().from(pages).where(eq(pages.path, "/le-club")).get();
    expect(row?.status).toBe("draft");
  });
});

describe("validation edge cases", () => {
  it("refuses the reserved prefixes whatever the variant of the path", async () => {
    for (const path of [
      "/API/../api",
      "api",
      "/admin/",
      "//hooks/x",
      "/media/./photo",
      "/health",
    ]) {
      const response = await call("POST", "/api/pages", ownerCookie, { path, title: "X" });
      expect(response.status, path).toBe(400);
    }
    // A prefix is a whole segment: `/apiculture` is an ordinary page.
    expect(
      (await call("POST", "/api/pages", ownerCookie, { path: "/apiculture", title: "X" })).status,
    ).toBe(201);
  });

  it("stores the canonical path: NFC, no trailing slash, no repeated slash", async () => {
    const decomposed = "/équipe//seniors/";
    const response = await call("POST", "/api/pages", ownerCookie, {
      path: decomposed,
      title: "Seniors",
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { path: string }).path).toBe("/équipe/seniors");
    // The same page through another variant is a conflict.
    const again = await call("POST", "/api/pages", ownerCookie, {
      path: "/équipe/seniors/",
      title: "Seniors",
    });
    expect(again.status).toBe(409);
  });

  it("refuses an informative image nested in columns inside a section without alt", async () => {
    await createPage("/le-club", "Le club");
    const data: JsonObject = {
      root: { props: { title: "Le club" } },
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            background: "default",
            content: [
              {
                type: "Image",
                props: {
                  id: "img-1",
                  src: "https://exemple.org/a.jpg",
                  alt: "  ",
                  decorative: false,
                },
              },
            ],
          },
        },
      ],
      zones: {},
    };
    const response = await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string; fields: Record<string, string> };
    expect(body.fields["content.0.content.0.alt"]).toContain("texte alternatif");
  });

  it("refuses a Hero image without alt unless decorative", async () => {
    await createPage("/le-club", "Le club");
    const hero = (decorative: boolean): JsonObject => ({
      root: { props: {} },
      content: [
        {
          type: "Hero",
          props: {
            id: "h1",
            title: "Titre",
            imageSrc: "/media/photo.jpg",
            imageAlt: "",
            decorative,
          },
        },
      ],
      zones: {},
    });
    const refused = await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: hero(false),
    });
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { fields: Record<string, string> }).fields).toHaveProperty(
      "content.0.imageAlt",
    );
    const accepted = await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: hero(true),
    });
    expect(accepted.status).toBe(200);
  });

  it("refuses a restore payload that is not a positive integer version", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    for (const version of [0, -1, 1.5, "1"]) {
      const response = await call("POST", "/api/pages/restore?path=/le-club", ownerCookie, {
        version,
      });
      expect(response.status, String(version)).toBe(400);
    }
  });

  it("answers 404 to an unknown action suffix", async () => {
    await createPage("/le-club", "Le club", sampleData());
    expect((await call("POST", "/api/pages/archive?path=%2Fle-club")).status).toBe(404);
  });
});

describe("draft edits never reach the public site", () => {
  it("keeps serving the published bytes (same ETag) after draft, title and SEO edits", async () => {
    await createPage("/le-club", "Le club", sampleData("Première version"));
    await publish("/le-club");
    const before = await app.request("/le-club");
    const beforeHtml = await before.text();
    const etag = before.headers.get("ETag");
    expect(etag).not.toBeNull();

    const saved = await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Brouillon non publié"),
      title: "Nouveau nom",
      seo: { description: "Nouvelle description", image: "https://exemple.org/i.jpg" },
    });
    expect(saved.status).toBe(200);
    // Even with an empty cache, the public page is rebuilt from the snapshot only.
    harness.htmlCache.clear();
    const after = await app.request("/le-club");
    const afterHtml = await after.text();
    expect(afterHtml).toBe(beforeHtml);
    expect(after.headers.get("ETag")).toBe(etag);
    expect(afterHtml).not.toContain("Brouillon non publié");
    expect(afterHtml).not.toContain("Nouvelle description");

    const revalidated = await app.request("/le-club", { headers: { "If-None-Match": etag ?? "" } });
    expect(revalidated.status).toBe(304);
  });
});

describe("cache invalidation with one long-lived application", () => {
  it("a publication replaces the cached page at once", async () => {
    await createPage("/le-club", "Le club", sampleData("Avant"));
    await publish("/le-club");
    expect(await publicHtml("/le-club")).toContain("Avant");
    expect(harness.htmlCache.get("/le-club")).toBeDefined();

    await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data: sampleData("Après") });
    // A draft save keeps the cached published page.
    expect(harness.htmlCache.get("/le-club")).toBeDefined();
    expect(await publicHtml("/le-club")).toContain("Avant");

    expect((await publish("/le-club")).status).toBe(200);
    const html = await publicHtml("/le-club");
    expect(html).toContain("Après");
    expect(html).not.toContain("Avant");
  });

  it("an unpublication takes the cached page off at once", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    await publicHtml("/le-club");
    expect((await call("POST", "/api/pages/unpublish?path=/le-club")).status).toBe(200);
    expect((await app.request("/le-club")).status).toBe(404);
  });

  it("a restore changes the draft only, the cached page stays", async () => {
    await createPage("/le-club", "Le club", sampleData("Version 1"));
    await publish("/le-club");
    await call("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Version 2"),
    });
    await publish("/le-club");
    expect(await publicHtml("/le-club")).toContain("Version 2");
    const restored = await call("POST", "/api/pages/restore?path=/le-club", ownerCookie, {
      version: 1,
    });
    expect(restored.status).toBe(200);
    expect(await publicHtml("/le-club")).toContain("Version 2");
    expect((await publish("/le-club")).status).toBe(200);
    expect(await publicHtml("/le-club")).toContain("Version 1");
    const versions = (await (await call("GET", "/api/pages/versions?path=/le-club")).json()) as {
      versions: Array<{ version: number }>;
    };
    expect(versions.versions.map((v) => v.version)).toEqual([3, 2, 1]);
  });
});
