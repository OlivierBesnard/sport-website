import { createSecretKey, randomBytes } from "node:crypto";
import { coreBlocks, createBlockRegistry, defineBlock } from "@sport-cms/blocks";
import {
  createTestDatabase,
  type Database,
  type JsonObject,
  type PageSeo,
  pages,
} from "@sport-cms/db";
import { defaultTheme } from "@sport-cms/themes";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { type AppDependencies, createApp, type Logger } from "./app.js";
import { HtmlCache } from "./html-cache.js";
import {
  CONTENT_SECURITY_POLICY,
  SECURITY_HEADERS,
  STRICT_TRANSPORT_SECURITY,
} from "./security-headers.js";

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
  return createApp({
    db,
    baseUrl: BASE_URL,
    secretKey: createSecretKey(randomBytes(32)),
    logger,
    ...overrides,
  });
}

function heading(text: string, id = `Heading-${text}`): JsonObject {
  return { type: "Heading", props: { id, text, level: 2, align: "left" } };
}

function content(...blocks: JsonObject[]): JsonObject {
  return withRoot({}, ...blocks);
}

/** Page data whose root props (title, description, image of the version) are `rootProps`. */
function withRoot(rootProps: JsonObject, ...blocks: JsonObject[]): JsonObject {
  return { root: { props: rootProps }, content: blocks, zones: {} };
}

interface PageValues {
  path: string;
  title?: string;
  seo?: PageSeo;
  data?: JsonObject;
}

/** Inserts a published page whose draft and published content are the same. */
function publish({ path, title = "Page", seo = {}, data = content(heading(title)) }: PageValues) {
  return db
    .insert(pages)
    .values({
      path,
      title,
      seo,
      draftData: data,
      publishedData: data,
      status: "published",
      publishedAt: new Date(),
    })
    .returning()
    .get();
}

function expectSecurityHeaders(response: Response) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect(response.headers.get(name), name).toBe(value);
  }
}

describe("GET /health", () => {
  it("answers ok once the database responds", async () => {
    const response = await app().request("/health");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ok" });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expectSecurityHeaders(response);
  });

  it("answers 503 when the database does not respond", async () => {
    const server = app();
    db.$client.close();
    const response = await server.request("/health");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "unavailable" });
    expect(logger.error).toHaveBeenCalledOnce();
  });
});

describe("published pages", () => {
  it("serves a published page on its path, as a complete French HTML document", async () => {
    publish({
      path: "/le-club",
      title: "Le club",
      seo: { description: "Histoire et projet du club" },
      data: content(heading("Notre histoire")),
    });
    const response = await app().request("/le-club");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    const html = await response.text();
    expect(html.startsWith('<!DOCTYPE html><html lang="fr"><head><meta charSet="utf-8"/>')).toBe(
      true,
    );
    expect(html).toContain('<meta name="viewport" content="width=device-width, initial-scale=1"/>');
    expect(html).toContain("<title>Le club</title>");
    expect(html).toContain('<meta name="description" content="Histoire et projet du club"/>');
    expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/le-club"/>`);
    expect(html).toContain('<meta property="og:type" content="website"/>');
    expect(html).toContain('<meta property="og:locale" content="fr_FR"/>');
    expect(html).toContain(`<meta property="og:url" content="${BASE_URL}/le-club"/>`);
    expect(html).toContain('<meta property="og:title" content="Le club"/>');
    expect(html).toContain(
      '<meta property="og:description" content="Histoire et projet du club"/>',
    );
    expect(html).toMatch(/<link rel="stylesheet" href="\/assets\/theme\.[0-9a-f]{16}\.css"\/>/);
    expect(html).toContain(
      '<body><main id="contenu"><h2 class="cms-heading">Notre histoire</h2></main></body></html>',
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain('name="robots"');
  });

  it("serves the home page on /", async () => {
    publish({ path: "/", title: "Accueil", data: content(heading("Bienvenue")) });
    const response = await app().request("/");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Bienvenue");
    expect(html).toContain(`<link rel="canonical" href="${BASE_URL}/"/>`);
  });

  it("takes the title, description and sharing image from the published version", async () => {
    publish({
      path: "/club",
      title: "Nom dans le back-office",
      seo: { title: "Ancien titre", description: "Ancienne description", image: "/media/a.jpg" },
      data: withRoot(
        { title: "Le club", description: "Histoire du club", image: "/media/club.jpg" },
        heading("Contenu"),
      ),
    });
    const html = await (await app().request("/club")).text();
    expect(html).toContain("<title>Le club</title>");
    expect(html).toContain('<meta name="description" content="Histoire du club"/>');
    expect(html).toContain(`<meta property="og:image" content="${BASE_URL}/media/club.jpg"/>`);
    expect(html).not.toMatch(/Ancien|Nom dans le back-office|media\/a\.jpg/);
  });

  it("keeps serving the published title while the page is edited without being published", async () => {
    const page = publish({
      path: "/club",
      title: "Le club",
      data: withRoot({ title: "Le club", description: "Version publiée" }, heading("Publié")),
    });
    db.update(pages)
      .set({
        title: "Nouveau nom",
        seo: { title: "Nouveau titre SEO", description: "Nouvelle description" },
        draftData: withRoot({ title: "Titre du brouillon", description: "Brouillon" }),
      })
      .where(eq(pages.id, page.id))
      .run();
    // A fresh application: nothing comes from the HTML cache.
    const html = await (await app().request("/club")).text();
    expect(html).toContain("<title>Le club</title>");
    expect(html).toContain('<meta name="description" content="Version publiée"/>');
    expect(html).not.toMatch(/Nouveau|Brouillon|brouillon/);
  });

  it("falls back on the SEO column, then the page name, for missing or invalid root values", async () => {
    publish({
      path: "/a",
      title: "Nom",
      seo: { title: "Titre SEO", description: "Description SEO", image: "/media/seo.jpg" },
      data: withRoot({ title: "  ", description: 42, image: ["/media/x.jpg"] }),
    });
    publish({ path: "/b", title: "Nom de la page", data: withRoot({ title: null }) });
    publish({
      path: "/c",
      title: "Nom",
      data: { root: "pas un objet", content: [heading("Contenu")] },
    });
    const server = app();
    const first = await (await server.request("/a")).text();
    expect(first).toContain("<title>Titre SEO</title>");
    expect(first).toContain('<meta name="description" content="Description SEO"/>');
    expect(first).toContain(`<meta property="og:image" content="${BASE_URL}/media/seo.jpg"/>`);
    expect(await (await server.request("/b")).text()).toContain("<title>Nom de la page</title>");
    const third = await (await server.request("/c")).text();
    expect(third).toContain("<title>Nom</title>");
    expect(third).toContain("Contenu");
  });

  it("uses the SEO title when set, and leaves out an empty description", async () => {
    publish({ path: "/a", title: "Titre", seo: { title: "Titre SEO", description: "  " } });
    publish({ path: "/b", title: "Titre de la page", seo: { title: " " } });
    const first = await (await app().request("/a")).text();
    expect(first).toContain("<title>Titre SEO</title>");
    expect(first).toContain('<meta property="og:title" content="Titre SEO"/>');
    expect(first).not.toContain('name="description"');
    expect(first).not.toContain("og:description");
    expect(await (await app().request("/b")).text()).toContain("<title>Titre de la page</title>");
  });

  it("gives the sharing image as an absolute URL, and only a safe one", async () => {
    publish({ path: "/relative", seo: { image: "/media/partage.jpg" } });
    publish({ path: "/absolute", seo: { image: "https://cdn.example/partage.jpg" } });
    publish({ path: "/unsafe", seo: { image: "javascript:alert(1)" } });
    const server = app();
    expect(await (await server.request("/relative")).text()).toContain(
      `<meta property="og:image" content="${BASE_URL}/media/partage.jpg"/>`,
    );
    expect(await (await server.request("/absolute")).text()).toContain(
      '<meta property="og:image" content="https://cdn.example/partage.jpg"/>',
    );
    expect(await (await server.request("/unsafe")).text()).not.toContain("og:image");
  });

  it("serves a page whose SEO column holds the JSON value null, without metadata", async () => {
    const data = JSON.stringify(content(heading("Contenu")));
    db.$client
      .prepare(
        `INSERT INTO pages (path, title, seo, draft_data, published_data, status, created_at, updated_at)
         VALUES ('/seo-null', 'Titre', 'null', ?, ?, 'published', 0, 0)`,
      )
      .run(data, data);
    const response = await app().request("/seo-null");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("<title>Titre</title>");
    expect(html).toContain("Contenu");
    expect(html).not.toContain('name="description"');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("serves the published content, not the draft", async () => {
    const page = publish({ path: "/club", data: content(heading("Version publiée")) });
    db.update(pages)
      .set({ draftData: content(heading("Brouillon en cours")) })
      .where(eq(pages.id, page.id))
      .run();
    const html = await (await app().request("/club")).text();
    expect(html).toContain("Version publiée");
    expect(html).not.toContain("Brouillon en cours");
  });

  it("answers 404 for a page that was never published", async () => {
    db.insert(pages)
      .values({ path: "/brouillon", title: "Brouillon", draftData: content(heading("Secret")) })
      .run();
    const response = await app().request("/brouillon");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Secret");
  });

  it("answers 404 for an unpublished page, even if its published copy is still stored", async () => {
    const page = publish({ path: "/ancienne", data: content(heading("Ancienne version")) });
    db.update(pages).set({ status: "draft" }).where(eq(pages.id, page.id)).run();
    const response = await app().request("/ancienne");
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("Ancienne version");
  });

  it("answers 404 for a page marked published without published content", async () => {
    db.insert(pages)
      .values({ path: "/incomplete", title: "x", draftData: content(), status: "published" })
      .run();
    expect((await app().request("/incomplete")).status).toBe(404);
  });

  it("answers a clean 404 page for an unknown path", async () => {
    const response = await app().request("/inconnue");
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expectSecurityHeaders(response);
    const html = await response.text();
    expect(html.startsWith('<!DOCTYPE html><html lang="fr">')).toBe(true);
    expect(html).toContain("<title>Page introuvable</title>");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).toContain("<h1>Page introuvable</h1>");
    expect(html).toContain('<a href="/">Revenir à l&#x27;accueil</a>');
    expect(html).toMatch(/<link rel="stylesheet" href="\/assets\/theme\.[0-9a-f]{16}\.css"\/>/);
    expect(html).not.toContain("og:");
  });

  it("answers 404 to other methods", async () => {
    publish({ path: "/club" });
    const response = await app().request("/club", { method: "POST" });
    expect(response.status).toBe(404);
  });

  it("answers HEAD like GET, without a body", async () => {
    publish({ path: "/club" });
    const response = await app().request("/club", { method: "HEAD" });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/html; charset=UTF-8");
    expectSecurityHeaders(response);
    expect(await response.text()).toBe("");
  });

  it("serves paths with accents and keeps paths case-sensitive", async () => {
    publish({ path: "/équipes/sénior", title: "Sénior", data: content(heading("Équipe sénior")) });
    publish({ path: "/Club", data: content(heading("Majuscule")) });
    const server = app();
    const accented = await server.request("/%C3%A9quipes/s%C3%A9nior");
    expect(accented.status).toBe(200);
    expect(await accented.text()).toContain(
      `<link rel="canonical" href="${BASE_URL}/%C3%A9quipes/s%C3%A9nior"/>`,
    );
    expect((await server.request("/Club")).status).toBe(200);
    expect((await server.request("/club")).status).toBe(404);
  });

  it("renders the known blocks of a page and leaves out the unknown ones", async () => {
    publish({
      path: "/club",
      data: content(
        heading("Avant"),
        { type: "helloasso.membership-button", props: { id: "m", label: "J'adhère" } },
        heading("Après"),
      ),
    });
    const response = await app().request("/club");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain("Avant");
    expect(html).toContain("Après");
    expect(html).not.toContain("adhère");
  });

  it("logs a block that fails, serves the rest of the page, and does not cache it", async () => {
    const broken = defineBlock<Record<string, never>>({
      type: "Broken",
      label: "Cassé",
      fields: {},
      defaultProps: {},
      render: () => {
        throw new Error("boom");
      },
    });
    publish({
      path: "/club",
      data: content(heading("Visible"), { type: "Broken", props: { id: "b" } }),
    });
    const registry = createBlockRegistry([...coreBlocks, broken]);
    const htmlCache = new HtmlCache();
    const server = app({ blocks: () => registry, htmlCache });
    const response = await server.request("/club");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Visible");
    expect(logger.error).toHaveBeenCalledWith(
      "Bloc « Broken » (b) non affiché sur la page /club",
      new Error("boom"),
    );
    expect(htmlCache.size).toBe(0);
    await server.request("/club");
    expect(logger.error).toHaveBeenCalledTimes(2);
  });

  it("neutralizes scripts injected through blocks and metadata (XSS)", async () => {
    publish({
      path: "/piege",
      title: '</title><script>alert("titre")</script>',
      seo: { description: '"><script>alert("description")</script>' },
      data: content(
        heading('<img src=x onerror=alert("titre de bloc")>'),
        {
          type: "RichText",
          props: {
            id: "t",
            body:
              '<p>Texte<script>alert("riche")</script></p><img src=x onerror=alert(1)>' +
              '<a href="javascript:alert(2)">lien</a><p onclick="alert(3)">clic</p>' +
              '<iframe src="https://evil.example"></iframe>',
          },
        },
        { type: "Button", props: { id: "b", label: "Bouton", href: "javascript:alert(4)" } },
        { type: "Image", props: { id: "i", src: "javascript:alert(5)", alt: "x" } },
        {
          type: "Hero",
          props: { id: "h", title: "Héro", ctaLabel: "Go", ctaHref: "data:text/html,x" },
        },
      ),
    });
    const response = await app().request("/piege");
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).not.toMatch(/<script|<iframe|<img|javascript:|data:text/i);
    // No event handler attribute in any real tag (escaped text has no "<").
    expect(html).not.toMatch(/<[^>]*\son\w+=/i);
    expect(html).toContain(
      "<title>&lt;/title&gt;&lt;script&gt;alert(&quot;titre&quot;)&lt;/script&gt;</title>",
    );
    expect(html).toContain(
      'content="&quot;&gt;&lt;script&gt;alert(&quot;description&quot;)&lt;/script&gt;"',
    );
    expect(html).toContain("&lt;img src=x onerror=alert(&quot;titre de bloc&quot;)&gt;");
    expect(html).toContain(
      '<div class="cms-rich-text"><div><p>Texte</p><a>lien</a><p>clic</p></div></div>',
    );
  });
});

describe("canonical paths", () => {
  it.each([
    ["/club/", "/club"],
    ["/club///", "/club"],
    ["//club", "/club"],
    ["/equipes//u13", "/equipes/u13"],
    ["/club/?saison=2026&tri=nom", "/club?saison=2026&tri=nom"],
    ["/e%CC%81quipes", "/%C3%A9quipes"],
    ["/%C3%A9quipes/", "/%C3%A9quipes"],
  ])("redirects %s to %s (301)", async (requested, location) => {
    const response = await app().request(requested);
    expect(response.status).toBe(301);
    expect(response.headers.get("Location")).toBe(location);
    expectSecurityHeaders(response);
  });

  it("never redirects to another host", async () => {
    const server = app();
    for (const requested of ["//evil.example/", "/%2F%2Fevil.example", "/%2F/evil.example/"]) {
      const response = await server.request(requested);
      expect(response.status).toBe(301);
      expect(response.headers.get("Location")).toBe("/evil.example");
    }
    const backslash = await server.request("/%5Cevil.example/");
    expect(backslash.status).toBe(301);
    expect(backslash.headers.get("Location")).toBe("/%5Cevil.example");
  });

  it("serves the canonical form after the redirect, without a loop", async () => {
    publish({ path: "/équipes" });
    const server = app();
    const first = await server.request("/e%CC%81quipes/");
    const location = first.headers.get("Location");
    expect(location).toBe("/%C3%A9quipes");
    const second = await server.request(location ?? "");
    expect(second.status).toBe(200);
  });

  it("does not redirect canonical paths, whatever their percent-encoding", async () => {
    publish({ path: "/équipes" });
    const server = app();
    expect((await server.request("/")).status).toBe(404);
    expect((await server.request("/%c3%a9quipes")).status).toBe(200);
    expect((await server.request("/%C3%A9quipes")).status).toBe(200);
  });

  it("resolves dot segments hidden by percent-encoding", async () => {
    const server = app();
    const up = await server.request("/a/%2E%2E%2F");
    expect(up.status).toBe(301);
    expect(up.headers.get("Location")).toBe("/");
    const sibling = await server.request("/club/%2E%2E%2Fequipes");
    expect(sibling.status).toBe(301);
    expect(sibling.headers.get("Location")).toBe("/equipes");
  });

  it("answers 404 to a malformed percent-encoding", async () => {
    const response = await app().request("/%E0%A4%A");
    expect(response.status).toBe(404);
  });
});

describe("stylesheet", () => {
  async function stylesheetHref(server: ReturnType<typeof app>): Promise<string> {
    const html = await (await server.request("/nimporte")).text();
    const href = /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1];
    expect(href).toBeDefined();
    return href ?? "";
  }

  it("serves the theme stylesheet, cached for good", async () => {
    const server = app();
    const response = await server.request(await stylesheetHref(server));
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/css; charset=utf-8");
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expectSecurityHeaders(response);
    const css = await response.text();
    expect(css).toContain("--cms-color-primary: #0b5cad;");
    expect(css).toContain(".cms-hero");
  });

  it("changes address with the theme", async () => {
    const custom = { ...defaultTheme, colors: { ...defaultTheme.colors, primary: "#7a1f1f" } };
    const themed = app({ theme: () => custom });
    const href = await stylesheetHref(themed);
    expect(href).not.toBe(await stylesheetHref(app()));
    expect(await (await themed.request(href)).text()).toContain("--cms-color-primary: #7a1f1f;");
  });

  it("answers 404 for another stylesheet name", async () => {
    expect((await app().request("/assets/theme.0000000000000000.css")).status).toBe(404);
  });
});

describe("security headers", () => {
  it("forbids scripts, inline styles, framing and foreign form targets", () => {
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'none'; style-src 'self'; img-src 'self' https:; font-src 'self'; " +
        "base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
    );
    expect(CONTENT_SECURITY_POLICY).not.toContain("unsafe");
    expect(CONTENT_SECURITY_POLICY).not.toContain("script-src");
  });

  it("are set on pages", async () => {
    publish({ path: "/club" });
    expectSecurityHeaders(await app().request("/club"));
  });

  it("are set on the API paths too, even when nothing answers there", async () => {
    const response = await app().request("/api/inconnue");
    expect(response.status).toBe(404);
    expectSecurityHeaders(response);
  });

  it("add Strict-Transport-Security only when the site is served over HTTPS", async () => {
    publish({ path: "/club" });
    const secure = await app().request("/club");
    expect(secure.headers.get("Strict-Transport-Security")).toBe(STRICT_TRANSPORT_SECURITY);
    expect(STRICT_TRANSPORT_SECURITY).toBe("max-age=31536000");
    const plain = await app({ baseUrl: "http://localhost:3000" }).request("/club");
    expect(plain.status).toBe(200);
    expect(plain.headers.get("Strict-Transport-Security")).toBeNull();
    expectSecurityHeaders(plain);
  });

  it("leave a header that a route set itself", async () => {
    const server = app({
      routes: (routes) => {
        routes.get("/admin", (context) =>
          context.html("<p>admin</p>", 200, { "Content-Security-Policy": "default-src 'self'" }),
        );
      },
    });
    const response = await server.request("/admin");
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("are set on the error page, which hides the error", async () => {
    publish({ path: "/club" });
    const server = app();
    db.$client.close();
    const response = await server.request("/club");
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expectSecurityHeaders(response);
    const html = await response.text();
    expect(html).toContain("<h1>Une erreur est survenue</h1>");
    expect(html).toContain('<meta name="robots" content="noindex"/>');
    expect(html).not.toContain("database");
    expect(logger.error).toHaveBeenCalledWith("Erreur en servant GET /club", expect.any(Error));
  });
});

describe("routes added by composition", () => {
  it("answer before the public site, with its headers, not-found page and error handler", async () => {
    publish({ path: "/club", data: content(heading("Page du club")) });
    publish({ path: "/api/club", data: content(heading("Page masquée")) });
    const server = app({
      routes: (routes) => {
        const api = new Hono();
        api.get("/club", (context) => context.json({ club: "US Exemple" }));
        api.get("/panne", () => {
          throw new Error("panne");
        });
        routes.route("/api", api);
        routes.get("/hooks/:module/:name", (context) => context.text(context.req.param("name")));
      },
    });

    const api = await server.request("/api/club");
    expect(api.status).toBe(200);
    expect(await api.json()).toEqual({ club: "US Exemple" });
    expectSecurityHeaders(api);

    const hook = await server.request("/hooks/helloasso/notifications");
    expect(await hook.text()).toBe("notifications");

    const failing = await server.request("/api/panne");
    expect(failing.status).toBe(500);
    expect(await failing.text()).toContain("<h1>Une erreur est survenue</h1>");
    expect(logger.error).toHaveBeenCalledWith(
      "Erreur en servant GET /api/panne",
      new Error("panne"),
    );

    const missing = await server.request("/api/inconnue");
    expect(missing.status).toBe(404);
    expect(await missing.text()).toContain("<h1>Page introuvable</h1>");

    expect(await (await server.request("/club")).text()).toContain("Page du club");
    expect((await server.request("/health")).status).toBe(200);
  });
});

describe("theme and blocks read on every request", () => {
  it("re-renders cached pages with the new theme and its stylesheet", async () => {
    publish({ path: "/club" });
    const custom = { ...defaultTheme, colors: { ...defaultTheme.colors, primary: "#7a1f1f" } };
    let theme = defaultTheme;
    const htmlCache = new HtmlCache();
    const server = app({ theme: () => theme, htmlCache });
    const stylesheetOf = async () =>
      /<link rel="stylesheet" href="([^"]+)"/.exec(
        await (await server.request("/club")).text(),
      )?.[1];

    const before = await stylesheetOf();
    expect(htmlCache.size).toBe(1);
    theme = custom;
    const after = await stylesheetOf();
    expect(after).not.toBe(before);
    expect(await (await server.request(after ?? "")).text()).toContain("#7a1f1f");
    expect((await server.request(before ?? "")).status).toBe(404);
  });

  it("re-renders cached pages with the new blocks", async () => {
    publish({
      path: "/club",
      data: content({ type: "Badge", props: { id: "b", text: "Nouveau" } }),
    });
    const badge = defineBlock<{ text: string }>({
      type: "Badge",
      label: "Badge",
      fields: { text: { type: "text" } },
      defaultProps: { text: "" },
      render: ({ text }) => text,
    });
    let registry = createBlockRegistry(coreBlocks);
    const server = app({ blocks: () => registry });
    expect(await (await server.request("/club")).text()).not.toContain("Nouveau");
    registry = createBlockRegistry([...coreBlocks, badge]);
    expect(await (await server.request("/club")).text()).toContain("Nouveau");
  });

  it("keeps the cache while the same theme and blocks are returned", async () => {
    publish({ path: "/club", data: content(heading("Version 1")) });
    const registry = createBlockRegistry(coreBlocks);
    const server = app({ theme: () => defaultTheme, blocks: () => registry });
    await server.request("/club");
    db.update(pages)
      .set({ publishedData: content(heading("Version 2")) })
      .where(eq(pages.path, "/club"))
      .run();
    expect(await (await server.request("/club")).text()).toContain("Version 1");
  });

  it("still answers a bare error page when the theme cannot be used", async () => {
    publish({ path: "/club" });
    const broken = { ...defaultTheme, radius: "1px; } body { display: none" };
    const response = await app({ theme: () => broken }).request("/club");
    expect(response.status).toBe(500);
    expectSecurityHeaders(response);
    const html = await response.text();
    expect(html).toContain("<h1>Une erreur est survenue</h1>");
    expect(html).not.toContain("stylesheet");
    expect(html).not.toContain("display: none");
  });
});

describe("HTML cache", () => {
  function setPublished(path: string, data: JsonObject) {
    db.update(pages).set({ publishedData: data }).where(eq(pages.path, path)).run();
  }

  it("serves a page from the cache until it is invalidated", async () => {
    publish({ path: "/club", data: content(heading("Version 1")) });
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });

    expect(await (await server.request("/club")).text()).toContain("Version 1");
    expect(htmlCache.size).toBe(1);

    setPublished("/club", content(heading("Version 2")));
    expect(await (await server.request("/club")).text()).toContain("Version 1");

    expect(htmlCache.invalidate("/club")).toBe(true);
    expect(await (await server.request("/club")).text()).toContain("Version 2");
  });

  it("invalidates one page by path, in any of its forms, and leaves the others", async () => {
    publish({ path: "/équipes", data: content(heading("A1")) });
    publish({ path: "/club", data: content(heading("B1")) });
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    await server.request("/%C3%A9quipes");
    await server.request("/club");
    setPublished("/équipes", content(heading("A2")));
    setPublished("/club", content(heading("B2")));

    expect(htmlCache.invalidate("équipes/")).toBe(true);
    expect(await (await server.request("/%C3%A9quipes")).text()).toContain("A2");
    expect(await (await server.request("/club")).text()).toContain("B1");
  });

  it("invalidates every page at once", async () => {
    publish({ path: "/", data: content(heading("Accueil 1")) });
    publish({ path: "/club", data: content(heading("Club 1")) });
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    await server.request("/");
    await server.request("/club");
    setPublished("/", content(heading("Accueil 2")));
    setPublished("/club", content(heading("Club 2")));

    htmlCache.clear();
    expect(htmlCache.size).toBe(0);
    expect(await (await server.request("/")).text()).toContain("Accueil 2");
    expect(await (await server.request("/club")).text()).toContain("Club 2");
  });

  it("stops serving an unpublished page once invalidated", async () => {
    publish({ path: "/club" });
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    expect((await server.request("/club")).status).toBe(200);
    db.update(pages).set({ status: "draft" }).where(eq(pages.path, "/club")).run();
    htmlCache.invalidate("/club");
    expect((await server.request("/club")).status).toBe(404);
  });

  it("never caches a missing page, so a page published later shows up at once", async () => {
    const htmlCache = new HtmlCache();
    const server = app({ htmlCache });
    expect((await server.request("/nouvelle")).status).toBe(404);
    expect((await server.request("/nouvelle/")).status).toBe(301);
    expect(htmlCache.size).toBe(0);
    publish({ path: "/nouvelle" });
    expect((await server.request("/nouvelle")).status).toBe(200);
  });
});
