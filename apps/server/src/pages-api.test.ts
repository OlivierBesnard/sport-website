import {
  auditLog,
  type Database,
  type JsonObject,
  outboxEvents,
  pages,
  pageVersions,
} from "@sport-cms/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness, sampleData } from "./api-testing.js";
import { MAX_API_BODY_BYTES } from "./app.js";

let harness: ApiHarness;
let db: Database;
let ownerCookie: string;
let editorCookie: string;
let memberCookie: string;
/**
 * One application per test, as in production (one per process): `createApp` empties the shared
 * HTML cache the first time a new application serves a page, so an application per request
 * would hide any stale cache entry and the cache assertions would prove nothing.
 */
let app: ReturnType<ApiHarness["app"]>;

beforeEach(async () => {
  harness = createApiHarness();
  app = harness.app();
  db = harness.db;
  const owner = await harness.createUser("owner");
  const editor = await harness.createUser("editor");
  const member = await harness.createUser("member");
  ownerCookie = await harness.signIn(owner.email, "mot-de-passe-2026");
  editorCookie = await harness.signIn(editor.email, "mot-de-passe-2026");
  memberCookie = await harness.signIn(member.email, "mot-de-passe-2026");
});

afterEach(() => {
  if (db.$client.open) {
    db.$client.close();
  }
});

async function get(path: string, cookie?: string): Promise<Response> {
  return app.request(path, {
    headers: cookie === undefined ? {} : { cookie },
  });
}

async function send(
  method: "POST" | "PUT" | "DELETE",
  path: string,
  cookie: string,
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Creates a page through the API, then writes `data` as its draft when given. */
async function createPage(path: string, title = "Ma page", data?: JsonObject): Promise<void> {
  const created = await send("POST", "/api/pages", ownerCookie, { path, title });
  expect(created.status, path).toBe(201);
  if (data !== undefined) {
    const saved = await send(
      "PUT",
      `/api/pages/page?path=${encodeURIComponent(path)}`,
      ownerCookie,
      { data },
    );
    expect(saved.status, path).toBe(200);
  }
}

/** Publishes the page at `path` and returns the response. */
function publish(path: string): Promise<Response> {
  return send("POST", `/api/pages/publish?path=${encodeURIComponent(path)}`, ownerCookie);
}

/** Last action of the audit log, to check what the API wrote. */
function lastAuditAction(): string | undefined {
  const rows = db.select({ action: auditLog.action }).from(auditLog).all();
  return rows.at(-1)?.action;
}

describe("rights of the pages API", () => {
  it("refuses 401 without a session", async () => {
    const response = await get("/api/pages");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentification requise." });
  });

  it("refuses 403 without the pages.edit permission", async () => {
    const response = await get("/api/pages", memberCookie);
    expect(response.status).toBe(403);
    const created = await send("POST", "/api/pages", memberCookie, {
      path: "/essai",
      title: "Essai",
    });
    expect(created.status).toBe(403);
  });

  it("lets the owner and an editor in", async () => {
    for (const cookie of [ownerCookie, editorCookie]) {
      const response = await get("/api/pages", cookie);
      expect(response.status).toBe(200);
    }
  });
});

describe("GET /api/pages", () => {
  it("answers an empty list on a fresh instance", async () => {
    const response = await get("/api/pages", ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ pages: [] });
  });

  it("lists every page with its path, title, status and dates in milliseconds", async () => {
    await createPage("/contact");
    await createPage("/");
    const response = await get("/api/pages", ownerCookie);
    const body = (await response.json()) as {
      pages: Array<{ path: string; title: string; status: string; updatedAt: number }>;
    };
    expect(body.pages.map((page) => page.path)).toEqual(["/", "/contact"]);
    expect(body.pages[1]).toMatchObject({ title: "Ma page", status: "draft" });
    expect(Number.isInteger(body.pages[1]?.updatedAt)).toBe(true);
  });
});

describe("POST /api/pages", () => {
  it("creates a draft page with an empty content and answers it", async () => {
    const response = await send("POST", "/api/pages", ownerCookie, {
      path: "/le-club",
      title: "Le club",
    });
    expect(response.status).toBe(201);
    const body = (await response.json()) as {
      path: string;
      title: string;
      status: string;
      published: boolean;
      draftData: JsonObject;
    };
    expect(body.path).toBe("/le-club");
    expect(body.title).toBe("Le club");
    expect(body.status).toBe("draft");
    expect(body.published).toBe(false);
    expect(body.draftData).toEqual({ root: { props: {} }, content: [], zones: {} });
  });

  it("normalizes the path at creation", async () => {
    const response = await send("POST", "/api/pages", ownerCookie, {
      path: "equipes//U13/",
      title: "U13",
    });
    expect(response.status).toBe(201);
    expect(((await response.json()) as { path: string }).path).toBe("/equipes/U13");
  });

  it("refuses the reserved prefixes, 400 with a French message", async () => {
    for (const path of ["/health", "/assets/x.png", "/admin", "/api", "/hooks/x", "/media"]) {
      const response = await send("POST", "/api/pages", ownerCookie, { path, title: "x" });
      expect(response.status, path).toBe(400);
      const body = (await response.json()) as { fields?: Record<string, string> };
      expect(body.fields?.path).toContain("réservé");
    }
  });

  it("refuses a path that is already taken with 409", async () => {
    await createPage("/le-club");
    const response = await send("POST", "/api/pages", ownerCookie, {
      path: "/le-club",
      title: "Encore",
    });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("déjà");
  });

  it("refuses an empty title or a body that is not an object", async () => {
    const empty = await send("POST", "/api/pages", ownerCookie, { path: "/x", title: "  " });
    expect(empty.status).toBe(400);
    const body = (await empty.json()) as { fields?: Record<string, string> };
    expect(body.fields?.title).toContain("requis");
    const broken = await send("POST", "/api/pages", ownerCookie, "pas un objet");
    expect(broken.status).toBe(400);
  });
});

describe("GET /api/pages/page?path=", () => {
  it("answers the draft and the metadata of the page", async () => {
    await createPage("/le-club", "Le club", sampleData());
    const response = await get("/api/pages/page?path=/le-club", ownerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      path: string;
      title: string;
      draftData: JsonObject;
      seo: unknown;
      published: boolean;
    };
    expect(body.title).toBe("Le club");
    expect(body.seo).toEqual({});
    expect(body.published).toBe(false);
    expect(body.draftData).toEqual(sampleData());
  });

  it("reads a nested path and refuses an unknown one", async () => {
    await createPage("/equipes/u13");
    expect((await get("/api/pages/page?path=/equipes/u13", ownerCookie)).status).toBe(200);
    expect((await get("/api/pages/page?path=/inconnue", ownerCookie)).status).toBe(404);
  });

  it("reads a page through a variant of its path", async () => {
    await createPage("/le-club");
    expect((await get("/api/pages/page?path=/le-club/", ownerCookie)).status).toBe(200);
  });
});

describe("PUT /api/pages/page?path=", () => {
  it("saves the draft without touching the public site nor the cache", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const before = await app.request("/le-club");
    expect(before.status).toBe(200);
    const cachedHtml = await before.text();

    const changed = sampleData("Texte modifié");
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: changed,
      title: "Nouveau nom",
      seo: { description: "Nouvelle description" },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { title: string; draftData: JsonObject };
    expect(body.title).toBe("Nouveau nom");
    expect(body.draftData).toEqual(changed);

    // The public page is still the published one, byte for byte.
    const after = await app.request("/le-club");
    expect(after.status).toBe(200);
    expect(await after.text()).toBe(cachedHtml);
    expect(lastAuditAction()).not.toBe("pages.saved");
  });

  it("requires the data: a payload with only the columns is refused", async () => {
    await createPage("/le-club", "Le club");
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      title: "Nouveau nom",
    });
    expect(response.status).toBe(400);
  });

  it("refuses an informative image without alternative text, in French, with the block path", async () => {
    await createPage("/le-club");
    const data = sampleData();
    (data.content as JsonObject[]).push({
      type: "Image",
      props: { id: "img-1", src: "/media/photo.jpg", alt: "", decorative: false, caption: "" },
    });
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["content.2.alt"]).toContain("texte alternatif");
  });

  it("accepts an image without alternative text when it is marked decorative", async () => {
    await createPage("/le-club");
    const data = sampleData();
    ((data.content as JsonObject[])[1]?.props as JsonObject).content = [
      {
        type: "Image",
        props: { id: "img-1", src: "/media/photo.jpg", alt: "", decorative: true, caption: "" },
      },
    ];
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data });
    expect(response.status).toBe(200);
  });

  it("refuses a block that is neither a Hero nor a Section at the root", async () => {
    await createPage("/le-club");
    const data = sampleData();
    (data.content as JsonObject[]).push({
      type: "Button",
      props: { id: "btn-1", label: "x", href: "/", variant: "primary", align: "left" },
    });
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["content.2"]).toContain("racine");
  });

  it("refuses data that is not page data", async () => {
    await createPage("/le-club");
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: { root: "pas un objet", content: [] },
    });
    expect(response.status).toBe(400);
  });

  it("refuses an unknown page", async () => {
    const response = await send("PUT", "/api/pages/page?path=/x", ownerCookie, {
      data: sampleData(),
    });
    expect(response.status).toBe(404);
  });
});

describe("POST /api/pages/publish?path=", () => {
  it("copies the draft to the published version and creates a new version row", async () => {
    await createPage("/le-club", "Le club", sampleData());
    const response = await publish("/le-club");
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      published: boolean;
      version: number;
    };
    expect(body).toMatchObject({ status: "published", published: true, version: 1 });
    const versions = db.select({ version: pageVersions.version }).from(pageVersions).all();
    expect(versions).toHaveLength(1);
  });

  it("emits page.published in the outbox, once per publication", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    await publish("/le-club");
    const page = db.select({ id: pages.id }).from(pages).get();
    expect(
      db
        .select({
          type: outboxEvents.type,
          source: outboxEvents.source,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .all(),
    ).toEqual([
      {
        type: "page.published",
        source: "core",
        payload: { pageId: page?.id, path: "/le-club", version: 1 },
      },
      {
        type: "page.published",
        source: "core",
        payload: { pageId: page?.id, path: "/le-club", version: 2 },
      },
    ]);
    // A refused publication emits nothing.
    await createPage("/vide", "Vide");
    await publish("/vide");
    expect(db.select().from(outboxEvents).all()).toHaveLength(2);
  });

  it("refuses a page without exactly one level 1 heading, in French", async () => {
    await createPage("/le-club", "Le club");
    const none = await publish("/le-club");
    expect(none.status).toBe(400);
    expect(((await none.json()) as { error: string }).error).toContain(
      "exactement un titre de niveau 1",
    );

    const two = sampleData();
    (two.content as JsonObject[]).push({
      type: "Section",
      props: {
        id: "section-2",
        background: "default",
        content: [{ type: "Heading", props: { id: "h2", text: "Deux", level: 1, align: "left" } }],
      },
    });
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data: two });
    const refused = await publish("/le-club");
    expect(refused.status).toBe(400);
    expect(((await refused.json()) as { error: string }).error).toContain("2 titres de niveau 1");
  });

  it("counts a level 1 heading nested in a section, and a Hero as the heading", async () => {
    await createPage("/le-club");
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: {
        root: { props: {} },
        content: [
          {
            type: "Section",
            props: {
              id: "s",
              background: "default",
              content: [
                { type: "Heading", props: { id: "h", text: "Titre", level: 1, align: "left" } },
              ],
            },
          },
        ],
        zones: {},
      },
    });
    expect((await publish("/le-club")).status).toBe(200);
    await createPage("/accueil", "Accueil", {
      root: { props: {} },
      content: [
        {
          type: "Hero",
          props: {
            id: "h",
            title: "US Exemple",
            subtitle: "",
            imageSrc: "",
            imageAlt: "",
            decorative: false,
            ctaLabel: "",
            ctaHref: "",
          },
        },
      ],
      zones: {},
    });
    expect((await publish("/accueil")).status).toBe(200);
  });

  it("resolves title, description and image into the snapshot: the draft no longer reaches the site", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const row = db.select().from(pages).where(eq(pages.path, "/le-club")).get();
    if (row === undefined || row.publishedData === null) {
      throw new Error("La page n'a pas été publiée.");
    }
    const snapshot = row.publishedData as JsonObject;
    expect((snapshot.root as JsonObject).props).toEqual({
      title: "Page d'exemple",
      description: "Une page de test.",
    });

    // Editing the draft and the columns changes nothing on the public site.
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Autre contenu"),
      title: "Autre nom",
      seo: { description: "Autre description", image: "/media/autre.jpg" },
    });
    const html = await (await app.request("/le-club")).text();
    expect(html).toContain("<title>Page d&#x27;exemple</title>");
    expect(html).toContain('meta name="description" content="Une page de test."');
    expect(html).not.toContain("Autre description");
    expect(html).not.toContain("Autre contenu");
  });

  it("falls back to the page name and the SEO columns when the root fields are missing", async () => {
    await createPage("/le-club", "Le club");
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: {
        root: { props: {} },
        content: [
          {
            type: "Hero",
            props: {
              id: "h",
              title: "Titre",
              subtitle: "",
              imageSrc: "",
              imageAlt: "",
              decorative: false,
              ctaLabel: "",
              ctaHref: "",
            },
          },
        ],
        zones: {},
      },
      seo: { description: "Depuis les colonnes" },
    });
    await publish("/le-club");
    const row = db.select().from(pages).where(eq(pages.path, "/le-club")).get();
    if (row === undefined || row.publishedData === null) {
      throw new Error("La page n'a pas été publiée.");
    }
    const props = ((row.publishedData as JsonObject).root as JsonObject).props as JsonObject;
    expect(props).toEqual({ title: "Le club", description: "Depuis les colonnes" });
  });

  it("invalidates the cache of the page: the new content is served at once", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    expect(await (await app.request("/le-club")).text()).toContain("Bienvenue");
    expect(harness.htmlCache.size).toBe(1);

    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Contenu neuf"),
    });
    await publish("/le-club");
    expect(await (await app.request("/le-club")).text()).toContain("Contenu neuf");
  });

  it("refuses an informative image without alternative text at publication too", async () => {
    await createPage("/le-club", "Le club");
    // The content is written straight into the database: an older editor could have done it.
    db.update(pages)
      .set({
        draftData: {
          root: { props: {} },
          content: [
            {
              type: "Hero",
              props: {
                id: "h",
                title: "T",
                subtitle: "",
                imageSrc: "",
                imageAlt: "",
                decorative: false,
                ctaLabel: "",
                ctaHref: "",
              },
            },
            {
              type: "Image",
              props: { id: "i", src: "/media/a.jpg", alt: "", decorative: false, caption: "" },
            },
          ],
          zones: {},
        },
      })
      .where(eq(pages.path, "/le-club"))
      .run();
    const response = await publish("/le-club");
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["content.1.alt"]).toContain("texte alternatif");
  });

  it("writes an audit entry with the actor, the page and the version", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const entry = db
      .select({
        action: auditLog.action,
        targetId: auditLog.targetId,
        details: auditLog.details,
      })
      .from(auditLog)
      .where(eq(auditLog.action, "pages.published"))
      .get();
    expect(entry).toBeDefined();
    expect(entry?.targetId).toBe("/le-club");
    expect(entry?.details).toMatchObject({ version: 1 });
  });

  it("refuses an unknown page", async () => {
    expect((await publish("/inconnue")).status).toBe(404);
  });
});

describe("GET /api/pages/versions and POST /api/pages/restore", () => {
  it("lists the versions newest first and restores one as the draft", async () => {
    await createPage("/le-club", "Le club", sampleData("Première"));
    await publish("/le-club");
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Deuxième"),
    });
    await publish("/le-club");
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("Brouillon courant"),
    });

    const list = await get("/api/pages/versions?path=/le-club", ownerCookie);
    expect(list.status).toBe(200);
    const body = (await list.json()) as {
      versions: Array<{ version: number; title: string; createdAt: number }>;
    };
    expect(body.versions.map((version) => version.version)).toEqual([2, 1]);
    expect(Number.isInteger(body.versions[0]?.createdAt)).toBe(true);

    const restore = await send("POST", "/api/pages/restore?path=/le-club", ownerCookie, {
      version: 1,
    });
    expect(restore.status).toBe(200);
    const restored = (await restore.json()) as { draftData: JsonObject };
    expect(JSON.stringify(restored.draftData)).toContain("Première");
    expect(lastAuditAction()).toBe("pages.restored");

    // The public site still serves version 2 until the restored draft is published again.
    const html = await (await app.request("/le-club")).text();
    expect(html).toContain("Deuxième");
  });

  it("refuses an unknown version", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const response = await send("POST", "/api/pages/restore?path=/le-club", ownerCookie, {
      version: 9,
    });
    expect(response.status).toBe(404);
  });

  it("refuses an unknown page and a bad payload", async () => {
    expect((await get("/api/pages/versions?path=/x", ownerCookie)).status).toBe(404);
    const bad = await send("POST", "/api/pages/restore?path=/x", ownerCookie, { version: "un" });
    expect(bad.status).toBe(404);
  });
});

describe("POST /api/pages/unpublish?path=", () => {
  it("takes the page off the public site and keeps the content", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    expect((await app.request("/le-club")).status).toBe(200);

    const response = await send("POST", "/api/pages/unpublish?path=/le-club", ownerCookie);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string; published: boolean };
    expect(body).toMatchObject({ status: "draft", published: false });
    expect((await app.request("/le-club")).status).toBe(404);
    expect(lastAuditAction()).toBe("pages.unpublished");
  });

  it("refuses to unpublish a page that is not published", async () => {
    await createPage("/le-club", "Le club");
    const response = await send("POST", "/api/pages/unpublish?path=/le-club", ownerCookie);
    expect(response.status).toBe(409);
  });
});

describe("POST /api/pages/rename?path=", () => {
  it("moves a published page, invalidating the old and the new path", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    expect((await app.request("/le-club")).status).toBe(200);

    const response = await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, {
      path: "/le-club-histoire",
    });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { path: string }).path).toBe("/le-club-histoire");
    expect((await app.request("/le-club")).status).toBe(404);
    expect((await app.request("/le-club-histoire")).status).toBe(200);
    expect(lastAuditAction()).toBe("pages.renamed");
  });

  it("refuses a reserved path, the same path and a taken path", async () => {
    await createPage("/le-club", "Le club");
    await createPage("/autre");
    expect(
      (await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, { path: "/api" })).status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, { path: "/le-club" }))
        .status,
    ).toBe(400);
    expect(
      (await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, { path: "/autre" }))
        .status,
    ).toBe(409);
  });
});

describe("DELETE /api/pages/page?path=", () => {
  it("removes the page, its versions and its cache entry, and audits it", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    expect((await app.request("/le-club")).status).toBe(200);

    const response = await send("DELETE", "/api/pages/page?path=/le-club", ownerCookie);
    expect(response.status).toBe(204);
    expect(await response.text()).toBe("");
    expect((await app.request("/le-club")).status).toBe(404);
    expect(harness.htmlCache.size).toBe(0);
    expect(db.select().from(pageVersions).all()).toHaveLength(0);
    expect(lastAuditAction()).toBe("pages.deleted");
  });

  it("refuses an unknown page", async () => {
    expect((await send("DELETE", "/api/pages/page?path=/x", ownerCookie)).status).toBe(404);
  });
});

/** A helper to read the `ETag` header of a response, failing the test when it is absent. */
async function etagOfPage(path = "/le-club"): Promise<string> {
  const etag = (await app.request(path)).headers.get("ETag");
  if (etag === null) {
    throw new Error("La page publiée n'a pas d'ETag.");
  }
  return etag;
}

describe("ETag of the published pages", () => {
  it("answers 304 to If-None-Match and keeps the no-cache policy", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const first = await app.request("/le-club");
    const etag = await etagOfPage();
    expect(first.headers.get("ETag")).toBe(etag);
    expect(first.headers.get("Cache-Control")).toBe("no-cache");

    const again = await app.request("/le-club", { headers: { "If-None-Match": etag } });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    expect(again.headers.get("ETag")).toBe(etag);
    expect(again.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("answers 200 again once the content changed (new publication)", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const etag = await etagOfPage();
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data: sampleData("Changé") });
    await publish("/le-club");
    const second = await app.request("/le-club", { headers: { "If-None-Match": etag } });
    expect(second.status).toBe(200);
    expect(second.headers.get("ETag")).not.toBe(etag);
  });

  it("ignores an unknown entity tag and accepts the exact one inside a list", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const etag = await etagOfPage();
    const other = await harness
      .app()
      .request("/le-club", { headers: { "If-None-Match": '"autre"' } });
    expect(other.status).toBe(200);
    const list = await harness
      .app()
      .request("/le-club", { headers: { "If-None-Match": `"autre", ${etag}` } });
    expect(list.status).toBe(304);
  });
});

describe("navigation in the public pages", () => {
  it("renders the menu above the content of every page", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [
        { label: "Le club", pageId: 1 },
        { label: "Fédération", url: "https://ffr.example" },
      ],
    });
    const html = await (await app.request("/le-club")).text();
    expect(html).toContain('<nav class="cms-nav" aria-label="Menu principal">');
    expect(html).toContain('href="/le-club">Le club</a>');
    expect(html).toContain('href="https://ffr.example">Fédération</a>');
  });

  it("is part of the cached HTML: changing the menu clears the whole cache", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    expect((await app.request("/le-club")).status).toBe(200);
    expect(harness.htmlCache.size).toBe(1);
    await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Accueil", pageId: 1 }],
    });
    expect(harness.htmlCache.size).toBe(0);
    const html = await (await app.request("/le-club")).text();
    expect(html).toContain("Accueil");
    expect(harness.htmlCache.size).toBe(1);
  });

  it("renders nothing when the menu is empty", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const html = await (await app.request("/le-club")).text();
    expect(html).not.toContain("cms-nav");
  });
});

describe("audit trail", () => {
  it("logs publish, unpublish, restore, rename and delete, not draft saves", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    await send("POST", "/api/pages/restore?path=/le-club", ownerCookie, { version: 1 });
    await send("POST", "/api/pages/unpublish?path=/le-club", ownerCookie);
    await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, { path: "/histoire" });
    await send("DELETE", "/api/pages/page?path=/histoire", ownerCookie);
    const actions = db
      .select({ action: auditLog.action })
      .from(auditLog)
      .all()
      .map((row) => row.action);
    expect(actions).toContain("pages.published");
    expect(actions).toContain("pages.restored");
    expect(actions).toContain("pages.unpublished");
    expect(actions).toContain("pages.renamed");
    expect(actions).toContain("pages.deleted");
  });
});

describe("navigation API", () => {
  it("refuses 401 without a session and 403 without pages.edit", async () => {
    expect((await get("/api/navigation")).status).toBe(401);
    expect((await get("/api/navigation", memberCookie)).status).toBe(403);
  });

  it("answers an empty list on a fresh instance", async () => {
    const response = await get("/api/navigation", ownerCookie);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ menu: "main", items: [] });
  });

  it("replaces the menu, in the order sent, with ids and resolved paths", async () => {
    await createPage("/le-club", "Le club");
    const page = db.select({ id: pages.id }).from(pages).where(eq(pages.path, "/le-club")).get();
    const response = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [
        { label: "Le club", pageId: page?.id },
        { label: "Fédération", url: "https://ffr.example" },
      ],
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      items: Array<{
        id: number;
        label: string;
        pageId: number | null;
        path: string | null;
        url: string | null;
      }>;
    };
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).toMatchObject({ label: "Le club", pageId: page?.id, path: "/le-club" });
    expect(body.items[1]).toMatchObject({ label: "Fédération", url: "https://ffr.example" });
    expect(lastAuditAction()).toBe("navigation.updated");
  });

  it("refuses an unsafe link, an unknown page, an empty label and an item without target", async () => {
    const unsafe = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Piège", url: "javascript:alert(1)" }],
    });
    expect(unsafe.status).toBe(400);
    const body = (await unsafe.json()) as { fields?: Record<string, string> };
    expect(body.fields?.["items.0.url"]).toContain("invalide");

    const unknownPage = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Nulle part", pageId: 9999 }],
    });
    expect(unknownPage.status).toBe(400);

    const noLabel = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: " ", url: "/contact" }],
    });
    expect(noLabel.status).toBe(400);

    const noTarget = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Seul" }],
    });
    expect(noTarget.status).toBe(400);
  });

  it("empties the menu", async () => {
    await createPage("/le-club", "Le club");
    await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Le club", pageId: 1 }],
    });
    const response = await send("PUT", "/api/navigation", ownerCookie, { menu: "main", items: [] });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(0);
  });

  it("deleting a page unlinks the entries, which keep rendering as long as they have a URL", async () => {
    await createPage("/le-club", "Le club");
    await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Le club", pageId: 1 }],
    });
    await send("DELETE", "/api/pages/page?path=/le-club", ownerCookie);
    const body = (await (await get("/api/navigation", ownerCookie)).json()) as {
      items: Array<{ path: string | null }>;
    };
    expect(body.items[0]?.path).toBe(null);
  });
});

describe("page path in the query parameter", () => {
  it("refuses a request without `path` with a French 400", async () => {
    for (const url of ["/api/pages/page", "/api/pages/versions"]) {
      const response = await get(url, ownerCookie);
      expect(response.status, url).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain("paramètre « path »");
    }
    const publishWithout = await send("POST", "/api/pages/publish", ownerCookie);
    expect(publishWithout.status).toBe(400);
  });

  it("reads a page whose path needs percent-encoding, and an encoded home page", async () => {
    await createPage("/équipe & co", "Équipe");
    await createPage("/", "Accueil");
    const encoded = await get(
      `/api/pages/page?path=${encodeURIComponent("/équipe & co")}`,
      ownerCookie,
    );
    expect(encoded.status).toBe(200);
    expect(((await encoded.json()) as { path: string }).path).toBe("/équipe & co");
    const home = await get("/api/pages/page?path=%2F", ownerCookie);
    expect(((await home.json()) as { path: string }).path).toBe("/");
  });

  it("keeps an action-like page apart from the page above it", async () => {
    await createPage("/equipe", "Équipe", sampleData("Équipe"));
    await createPage("/equipe/versions", "Versions", sampleData("Versions"));
    expect((await publish("/equipe/versions")).status).toBe(200);
    const response = await get("/api/pages/versions?path=/equipe", ownerCookie);
    const versions = (await response.json()) as { versions: unknown[] };
    // Only `/equipe/versions` was published.
    expect(versions.versions).toHaveLength(0);
  });
});

describe("SEO title column", () => {
  it("serves as the title between the root field and the page name", async () => {
    await createPage("/le-club", "Nom interne");
    const data = sampleData();
    (data.root as JsonObject).props = {};
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data,
      seo: { title: "Titre de référencement" },
    });
    await publish("/le-club");
    const html = await (await app.request("/le-club")).text();
    expect(html).toContain("<title>Titre de référencement</title>");

    // The root field still wins.
    await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData(),
      seo: { title: "Titre de référencement" },
    });
    await publish("/le-club");
    expect(await (await app.request("/le-club")).text()).toContain(
      "<title>Page d&#x27;exemple</title>",
    );
  });
});

describe("menu entries and the state of their page", () => {
  /** Publishes `/le-club` and `/contact`, with a menu entry towards `/le-club`. */
  async function linkedPages(): Promise<void> {
    await createPage("/le-club", "Le club", sampleData());
    await createPage("/contact", "Contact", sampleData());
    await publish("/le-club");
    await publish("/contact");
    const club = db.select({ id: pages.id }).from(pages).where(eq(pages.path, "/le-club")).get();
    const saved = await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [
        { label: "Le club", pageId: club?.id },
        { label: "Fédération", url: "https://ffr.example" },
      ],
    });
    expect(saved.status).toBe(200);
  }

  it("leaves out an entry towards an unpublished page, also from the cached pages", async () => {
    await linkedPages();
    expect(await (await app.request("/contact")).text()).toContain('href="/le-club"');
    expect(harness.htmlCache.get("/contact")).toBeDefined();

    const unpublished = await send("POST", "/api/pages/unpublish?path=/le-club", ownerCookie);
    expect(unpublished.status).toBe(200);
    const html = await (await app.request("/contact")).text();
    expect(html).not.toContain('href="/le-club"');
    expect(html).toContain('href="https://ffr.example"');
  });

  it("brings the entry back on every page when the page is published again", async () => {
    await linkedPages();
    await send("POST", "/api/pages/unpublish?path=/le-club", ownerCookie);
    expect(await (await app.request("/contact")).text()).not.toContain('href="/le-club"');
    expect((await publish("/le-club")).status).toBe(200);
    expect(await (await app.request("/contact")).text()).toContain('href="/le-club"');
  });

  it("never renders an entry towards a page that was never published", async () => {
    await createPage("/brouillon", "Brouillon", sampleData());
    await createPage("/contact", "Contact", sampleData());
    await publish("/contact");
    const draft = db.select({ id: pages.id }).from(pages).where(eq(pages.path, "/brouillon")).get();
    await send("PUT", "/api/navigation", ownerCookie, {
      menu: "main",
      items: [{ label: "Brouillon", pageId: draft?.id }],
    });
    const html = await (await app.request("/contact")).text();
    expect(html).not.toContain("/brouillon");
    // No entry left: no menu at all.
    expect(html).not.toContain("cms-nav");
  });

  it("keeps the other cached pages when a page outside any menu changes", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await createPage("/contact", "Contact", sampleData());
    await publish("/le-club");
    await publish("/contact");
    await app.request("/le-club");
    await app.request("/contact");
    expect(harness.htmlCache.size).toBe(2);
    await send("POST", "/api/pages/rename?path=/le-club", ownerCookie, { path: "/histoire" });
    expect(harness.htmlCache.get("/contact")).toBeDefined();
    expect(harness.htmlCache.get("/le-club")).toBeUndefined();
  });
});

describe("origin of the writes to the admin API", () => {
  const writes: Array<["POST" | "PUT" | "DELETE", string, unknown]> = [
    ["POST", "/api/pages", { path: "/nouvelle", title: "Nouvelle" }],
    ["PUT", "/api/pages/page?path=/le-club", { data: sampleData("Piégé") }],
    ["POST", "/api/pages/publish?path=/le-club", undefined],
    ["POST", "/api/pages/rename?path=/le-club", { path: "/vole" }],
    ["DELETE", "/api/pages/page?path=/le-club", undefined],
    ["PUT", "/api/navigation", { menu: "main", items: [] }],
    ["POST", "/api/setup", {}],
  ];

  function write(
    method: "POST" | "PUT" | "DELETE",
    url: string,
    body: unknown,
    origin: string | undefined,
  ): Promise<Response> {
    return Promise.resolve(
      app.request(url, {
        method,
        headers: {
          cookie: ownerCookie,
          ...(origin === undefined ? {} : { origin }),
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
    );
  }

  it("refuses a foreign or null Origin with a French 403, and changes nothing", async () => {
    await createPage("/le-club", "Le club", sampleData());
    for (const origin of ["https://pirate.example", "null", "http://localhost:3001"]) {
      for (const [method, url, body] of writes) {
        const response = await write(method, url, body, origin);
        expect(response.status, `${origin} ${method} ${url}`).toBe(403);
        expect(((await response.json()) as { error: string }).error).toContain(
          "ne provient pas du site",
        );
      }
    }
    const row = db.select().from(pages).where(eq(pages.path, "/le-club")).get();
    expect(row?.status).toBe("draft");
    expect(db.select().from(pages).all()).toHaveLength(1);
  });

  it("lets the origin of the site through, and a client without Origin", async () => {
    await createPage("/le-club", "Le club", sampleData());
    const sameOrigin = await write(
      "PUT",
      "/api/pages/page?path=/le-club",
      { data: sampleData() },
      "http://localhost:3000",
    );
    expect(sameOrigin.status).toBe(200);
    const bare = await write("POST", "/api/pages/publish?path=/le-club", undefined, undefined);
    expect(bare.status).toBe(200);
  });

  it("does not check the reads", async () => {
    const response = await app.request("/api/pages", {
      headers: { cookie: ownerCookie, origin: "https://pirate.example" },
    });
    expect(response.status).toBe(200);
  });
});

describe("rules of the slots on the server", () => {
  it("refuses Columns inside Columns at save, with the path of the block", async () => {
    await createPage("/le-club", "Le club");
    const columns = (first: JsonObject[]): JsonObject => ({
      type: "Columns",
      props: {
        id: `c-${first.length}`,
        layout: "halves",
        first,
        second: [],
        third: [],
        fourth: [],
      },
    });
    const data = sampleData();
    ((data.content as JsonObject[])[1]?.props as JsonObject).content = [columns([columns([])])];
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, { data });
    expect(response.status).toBe(400);
    const body = (await response.json()) as { fields: Record<string, string> };
    expect(body.fields["content.1.content.0.first.0"]).toContain("« Colonnes »");
  });
});

describe("If-None-Match, weak comparison", () => {
  it("answers 304 to the weak form of the entity tag", async () => {
    await createPage("/le-club", "Le club", sampleData());
    await publish("/le-club");
    const etag = (await app.request("/le-club")).headers.get("ETag") ?? "";
    const weak = await app.request("/le-club", { headers: { "If-None-Match": `W/${etag}` } });
    expect(weak.status).toBe(304);
    const other = await app.request("/le-club", { headers: { "If-None-Match": 'W/"autre"' } });
    expect(other.status).toBe(200);
  });
});

describe("size of the API bodies", () => {
  it("refuses a body over the limit with a French 413, before any handler", async () => {
    await createPage("/le-club", "Le club", sampleData());
    const huge = sampleData("x".repeat(MAX_API_BODY_BYTES));
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: huge,
    });
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toContain("trop volumineuse");
    const row = db.select().from(pages).where(eq(pages.path, "/le-club")).get();
    expect(JSON.stringify(row?.draftData)).not.toContain("xxxx");
  });

  it("accepts a page of ordinary size", async () => {
    await createPage("/le-club", "Le club");
    const response = await send("PUT", "/api/pages/page?path=/le-club", ownerCookie, {
      data: sampleData("y".repeat(100_000)),
    });
    expect(response.status).toBe(200);
  });
});
