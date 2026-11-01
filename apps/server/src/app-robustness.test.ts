// Tests added by the tester (E03): stored data the back-office could not have written, cache
// growth, redirects to other hosts and a few document details.
import {
  createTestDatabase,
  type Database,
  type JsonObject,
  type PageSeo,
  pages,
} from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AppDependencies, createApp, type Logger } from "./app.js";
import { HtmlCache } from "./html-cache.js";

const BASE_URL = "https://monclub.example";

let db: Database;
let logger: { error: Mock<Logger["error"]> };

beforeEach(() => {
  db = createTestDatabase();
  logger = { error: vi.fn<Logger["error"]>() };
});

afterEach(() => {
  if (db.$client.open) {
    db.$client.close();
  }
});

function app(overrides: Partial<AppDependencies> = {}) {
  return createApp({ db, baseUrl: BASE_URL, logger, ...overrides });
}

function heading(text: string, id = `Heading-${text}`): JsonObject {
  return { type: "Heading", props: { id, text, level: 2, align: "left" } };
}

function content(...blocks: unknown[]): JsonObject {
  return { root: { props: {} }, content: blocks, zones: {} } as JsonObject;
}

function publish(path: string, data: JsonObject, seo: PageSeo = {}, title = "Titre de la page") {
  db.insert(pages)
    .values({ path, title, seo, draftData: data, publishedData: data, status: "published" })
    .run();
}

/** Writes raw column values, as a hand edit or another program could. */
function publishRaw(path: string, seoText: string, publishedText: string, title = "Titre brut") {
  const now = Date.now();
  db.$client
    .prepare(
      `INSERT INTO pages (path, title, seo, draft_data, published_data, status, created_at, updated_at)
       VALUES (?, ?, ?, '{}', ?, 'published', ?, ?)`,
    )
    .run(path, title, seoText, publishedText, now, now);
}

/** The generic error page: nothing about the cause reaches the visitor. */
async function expectCleanServerError(response: Response) {
  expect(response.status).toBe(500);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const html = await response.text();
  expect(html).toContain("<h1>Une erreur est survenue</h1>");
  expect(html).not.toMatch(/SyntaxError|TypeError|JSON|position|at \w|node_modules|\.ts/);
}

function mainOf(html: string): string {
  return /<main id="contenu">([\s\S]*)<\/main>/.exec(html)?.[1] ?? "<no main>";
}

describe("stored data that is not well-formed (tester)", () => {
  it("answers a clean 500, not cached, when published_data is not JSON, and recovers once fixed", async () => {
    publishRaw("/corrompue", "{}", "{not json");
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });

    await expectCleanServerError(await server.request("/corrompue"));
    expect(logger.error).toHaveBeenCalledWith(
      "Erreur en servant GET /corrompue",
      expect.any(Error),
    );
    expect(htmlCache.size).toBe(0);

    db.$client
      .prepare("UPDATE pages SET published_data = ? WHERE path = '/corrompue'")
      .run(JSON.stringify(content(heading("Réparée"))));
    const fixed = await server.request("/corrompue");
    expect(fixed.status).toBe(200);
    expect(await fixed.text()).toContain("Réparée");
  });

  it.each([
    ['"une chaîne"'],
    ["[1, 2, 3]"],
    ["123"],
    ["true"],
    ['{"content": "pas une liste"}'],
    ['{"root": {}}'],
    ['{"content": {"0": {"type": "Heading", "props": {"id": "x", "text": "objet"}}}}'],
  ])("renders an empty page for published_data %s", async (publishedText) => {
    publishRaw("/forme", "{}", publishedText);
    const response = await app().request("/forme");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(mainOf(html)).toBe("");
    expect(html).toContain("<title>Titre brut</title>");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("answers 404 when published_data holds the JSON value null", async () => {
    publishRaw("/nulle", "{}", "null");
    expect((await app().request("/nulle")).status).toBe(404);
  });

  it("answers a clean 500 when the SEO column is not JSON", async () => {
    publishRaw("/seo-corrompu", "{bad", JSON.stringify(content(heading("x"))));
    await expectCleanServerError(await app().request("/seo-corrompu"));
  });

  it.each([['"abc"'], ["[]"], ["42"]])("ignores an SEO column holding %s", async (seoText) => {
    publishRaw("/seo-forme", seoText, JSON.stringify(content(heading("Contenu"))));
    const response = await app().request("/seo-forme");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Titre brut</title>");
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain("og:image");
  });

  it("ignores SEO values of the wrong type", async () => {
    publish("/seo-types", content(heading("x")), {
      title: 42,
      description: ["x"],
      image: { src: "https://cdn.example/a.png" },
    } as unknown as PageSeo);
    const html = await (await app().request("/seo-types")).text();
    expect(html).toContain("<title>Titre de la page</title>");
    expect(html).not.toContain('name="description"');
    expect(html).not.toContain("og:image");
  });

  it("skips items that are not blocks, including types named after Object.prototype members", async () => {
    publish(
      "/items",
      content(
        null,
        1,
        "x",
        [],
        { type: 1, props: { id: "a" } },
        { type: "Heading" },
        { type: "Heading", props: null },
        { type: "Heading", props: [] },
        { type: "constructor", props: { id: "c" } },
        { type: "__proto__", props: { id: "p" } },
        { type: "toString", props: { id: "t" } },
        { type: "hasOwnProperty", props: { id: "h" } },
        heading("Seul bloc valide"),
      ),
    );
    const response = await app().request("/items");
    expect(response.status).toBe(200);
    expect(mainOf(await response.text())).toBe('<h2 class="cms-heading">Seul bloc valide</h2>');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not let stored props pollute Object.prototype", async () => {
    const polluting = JSON.parse(
      '{"type":"Heading","props":{"id":"p","__proto__":{"text":"pollué","polluted":true},' +
        '"constructor":{"prototype":{"polluted":true}}}}',
    ) as JsonObject;
    publish("/pollution", content(polluting));
    const html = await (await app().request("/pollution")).text();
    expect(html).not.toContain("pollué");
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(({} as Record<string, unknown>).text).toBeUndefined();
  });

  it("replaces props of the wrong type, slots that are not lists and unknown options", async () => {
    publish(
      "/props",
      content(
        { type: "Heading", props: { id: "h", text: "Niveau 7", level: 7, align: "justify" } },
        {
          type: "Section",
          props: { id: "s", background: '" onmouseover="alert(1)', content: "pas une liste" },
        },
        { type: "Columns", props: { id: "c", layout: "toString", first: { a: 1 }, second: 3 } },
        { type: "Button", props: { id: "b", label: "Lien", href: "/x", variant: "evil" } },
        heading("Fin"),
      ),
    );
    const response = await app().request("/props");
    expect(response.status).toBe(200);
    const html = mainOf(await response.text());
    expect(html).toContain('<h2 class="cms-heading">Niveau 7</h2>');
    expect(html).toContain('<section class="cms-section"><div class="cms-container cms-stack">');
    expect(html).toContain('<div class="cms-columns cms-columns--halves">');
    expect(html).toContain('class="cms-button cms-button--primary"');
    expect(html).not.toMatch(/onmouseover|evil|toString/);
    expect(html).toContain("Fin");
  });

  it("serves a page whose blocks are nested far too deep, without the deepest ones", async () => {
    let node: JsonObject = heading("Feuille", "leaf");
    for (let level = 0; level < 1000; level++) {
      node = {
        type: "Section",
        props: { id: `s${level}`, background: "default", content: [node] },
      };
    }
    publish("/profonde", content(node, heading("Après")));
    const response = await app().request("/profonde");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toContain("Feuille");
    expect(html).toContain("Après");
  });

  it("serves a page whose JSON is nested very deep outside blocks", async () => {
    const deep = `${"[".repeat(100_000)}${"]".repeat(100_000)}`;
    publishRaw(
      "/json-profond",
      "{}",
      `{"content":[${deep},{"type":"Heading","props":{"id":"z","text":"Après"}}]}`,
    );
    const response = await app().request("/json-profond");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Après");
  });
});

describe("HTML cache stays bounded (tester)", () => {
  it("never grows on requests that do not serve a published page", async () => {
    publish("/club", content(heading("Club")));
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    const requests: [string, RequestInit?][] = [
      ...Array.from({ length: 200 }, (_, index): [string] => [`/aleatoire-${index}`]),
      ["/club/"],
      ["//club"],
      ["/club///"],
      ["/%E0%A4%A"],
      ["/%"],
      ["/health"],
      ["/assets/theme.0000000000000000.css"],
      ["/club", { method: "POST" }],
      ["/inconnue", { method: "HEAD" }],
    ];
    for (const [path, init] of requests) {
      await server.request(path, init);
    }
    expect(htmlCache.size).toBe(0);
  });

  it("keeps a single entry per page, whatever form of its path is requested", async () => {
    publish("/équipes", content(heading("Équipes")));
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    for (const path of ["/%C3%A9quipes", "/%c3%a9quipes", "/e%CC%81quipes", "/%C3%A9quipes/"]) {
      await server.request(path);
    }
    expect(htmlCache.size).toBe(1);
  });

  it("caches the full page when it is first requested with HEAD", async () => {
    publish("/club", content(heading("Contenu complet")));
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    const head = await server.request("/club", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    const get = await server.request("/club");
    expect(await get.text()).toContain("Contenu complet");
  });
});

describe("redirects never leave the site (tester)", () => {
  it.each([
    "//evil.example/",
    "///evil.example/",
    "/\\evil.example",
    "/\\\\evil.example/",
    "/%5C%5Cevil.example/",
    "//%5Cevil.example",
    "/%2F%5Cevil.example",
    "/%5C/evil.example/",
    "/%09/evil.example/",
    "/%0D%0ALocation:%20https://evil.example/",
    "/%2F%2F%2Fevil.example",
    "/%2e%2e%2F%2Fevil.example/",
    "/https:%2F%2Fevil.example/",
    "/%E2%80%AE/evil.example/",
  ])("keeps %s on the site", async (requested) => {
    const response = await app().request(requested);
    expect([301, 404]).toContain(response.status);
    const location = response.headers.get("Location");
    if (location !== null) {
      // A single leading slash, then neither a slash nor a backslash: a path on this host.
      expect(location).toMatch(/^\/(?![/\\])/);
      // Printable ASCII only (no space, control character or raw Unicode), and no backslash.
      expect(location).toMatch(/^[!-~]+$/);
      expect(location).not.toContain("\\");
      expect(new URL(location, BASE_URL).origin).toBe(BASE_URL);
    }
  });

  it("keeps the query string, percent-encoded, when it redirects", async () => {
    const response = await app().request("/club/?q=<script>&r=%0D%0A");
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe("/club?q=%3Cscript%3E&r=%0D%0A");
  });
});

describe("document details (tester)", () => {
  it("preloads only a safe hero image, the one shown", async () => {
    publish(
      "/hero-sur",
      content({ type: "Hero", props: { id: "h", title: "Club", imageSrc: "/media/hero.jpg" } }),
    );
    publish(
      "/hero-dangereux",
      content({
        type: "Hero",
        props: { id: "h", title: "Club", imageSrc: "javascript:alert(1)" },
      }),
    );
    const server = app();
    const safe = await (await server.request("/hero-sur")).text();
    const preloads = safe.match(/<link rel="preload"[^>]*>/g) ?? [];
    console.log("PRELOADS:", JSON.stringify(preloads), "\nHEAD:", safe.slice(0, 900));
    expect(preloads).toHaveLength(1);
    const preload = preloads[0];
    expect(preload).toBeDefined();
    expect(preload).toContain('as="image"');
    expect(preload).toContain('href="/media/hero.jpg"');
    expect(safe).toContain('src="/media/hero.jpg"');
    expect(safe).not.toContain("<script");

    const unsafe = await (await server.request("/hero-dangereux")).text();
    expect(unsafe).not.toContain("javascript:");
    expect(unsafe).not.toContain('rel="preload"');

    // The preload link is built outside React: an image path with a quote must stay escaped.
    publish(
      "/hero-guillemets",
      content({ type: "Hero", props: { id: "h", title: "Club", imageSrc: '/med"ia/a.jpg' } }),
    );
    const quoted = await (await server.request("/hero-guillemets")).text();
    expect(quoted.match(/<link rel="preload"[^>]*>/g)).toEqual([
      '<link rel="preload" as="image" href="/med&quot;ia/a.jpg"/>',
    ]);
    expect(quoted).not.toContain('href="/med"');
  });

  it("gives the not-found and error pages a single level 1 heading, in French", async () => {
    publishRaw("/erreur", "{}", "{not json");
    const server = app();
    for (const path of ["/introuvable", "/erreur"]) {
      const html = await (await server.request(path)).text();
      expect(html.startsWith('<!DOCTYPE html><html lang="fr">')).toBe(true);
      expect(html.match(/<h1/g)).toHaveLength(1);
      expect(html).not.toContain("<script");
    }
  });

  it("escapes a page title that tries to close the title element", async () => {
    publish("/titre", content(heading("x")), {}, "</title><style>body{display:none}</style>");
    const html = await (await app().request("/titre")).text();
    expect(html).not.toContain("<style");
    expect(html.match(/<title>/g)).toHaveLength(1);
    expect(html.match(/<\/title>/g)).toHaveLength(1);
  });
});
