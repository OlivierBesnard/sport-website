import { existsSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { auditLog, type Database, media, outboxEvents } from "@sport-cms/db";
import { asc, eq } from "drizzle-orm";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "../api-testing.js";
import { MEDIA_DIRECTORY, NOT_AN_IMAGE } from "./media-store.js";

let harness: ApiHarness;
let db: Database;
let app: ReturnType<ApiHarness["app"]>;
let editorCookie: string;
let coachCookie: string;

beforeEach(async () => {
  harness = createApiHarness();
  app = harness.app();
  db = harness.db;
  const editor = await harness.createUser("editor");
  const coach = await harness.createUser("coach");
  editorCookie = await harness.signIn(editor.email, "mot-de-passe-2026");
  coachCookie = await harness.signIn(coach.email, "mot-de-passe-2026");
});

afterEach(() => {
  db.$client.close();
  rmSync(harness.dataDir, { recursive: true, force: true });
});

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  cookie: string | undefined,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method,
    headers: {
      ...(cookie === undefined ? {} : { cookie }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text.startsWith("{") ? JSON.parse(text) : {} };
}

/** A real photo: 2000 × 1000 pixels, JPEG, with an EXIF orientation and a description. */
async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 2000, height: 1000, channels: 3, background: "#0b5cad" } })
    .jpeg()
    .withMetadata({ orientation: 6, exif: { IFD0: { ImageDescription: "secret" } } })
    .toBuffer();
}

async function upload(
  bytes: Uint8Array,
  name: string,
  type: string,
  fields: Record<string, string> = { rights: "none", alt: "Le stade" },
  cookie = editorCookie,
) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array(bytes)], name, { type }));
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  const response = await app.request("/api/media", {
    method: "POST",
    headers: { cookie },
    body: form,
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function events(): string[] {
  return db
    .select({ type: outboxEvents.type })
    .from(outboxEvents)
    .orderBy(asc(outboxEvents.id))
    .all()
    .map((row) => row.type);
}

describe("media", () => {
  it("stores an upright, metadata-free WebP in a few sizes, and serves it", async () => {
    const uploaded = await upload(await photo(), "IMG_0042.JPG", "image/jpeg");
    expect(uploaded.status).toBe(201);
    const stored = uploaded.body.media as { id: number; url: string; thumbnailUrl: string };
    // Turned upright: the EXIF orientation 6 makes it a portrait.
    expect(uploaded.body.media).toMatchObject({
      originalName: "IMG_0042.JPG",
      mimeType: "image/jpeg",
      width: 1000,
      height: 2000,
      alt: "Le stade",
      rights: "none",
    });
    const files = readdirSync(join(harness.dataDir, MEDIA_DIRECTORY));
    expect(files.map((file) => file.replace(/^[0-9a-f]{32}/, "x")).sort()).toEqual([
      "x-1000.webp",
      "x-400.webp",
      "x-800.webp",
    ]);
    const response = await app.request(stored.url);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    const served = Buffer.from(await response.arrayBuffer());
    const metadata = await sharp(served).metadata();
    expect(metadata).toMatchObject({ format: "webp", width: 1000, height: 2000 });
    expect(metadata.exif).toBeUndefined();
    expect(served.includes("secret")).toBe(false);
    expect(events()).toEqual(["media.uploaded"]);
  });

  it("refuses a file that is not an image, whatever its name and declared type", async () => {
    const disguised = new TextEncoder().encode("<?php system($_GET['c']); ?> pas une image");
    const refused = await upload(disguised, "photo.jpg", "image/jpeg");
    expect(refused).toEqual({
      status: 400,
      body: { error: "Requête invalide.", fields: { file: NOT_AN_IMAGE } },
    });
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    );
    expect((await upload(svg, "logo.png", "image/png")).body.fields).toEqual({
      file: NOT_AN_IMAGE,
    });
    // A JPEG signature on something else is not enough either.
    const fake = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new TextEncoder().encode("rien")]);
    expect((await upload(fake, "x.jpg", "image/jpeg")).status).toBe(400);
    expect(db.select().from(media).all()).toEqual([]);
    expect(existsSync(join(harness.dataDir, MEDIA_DIRECTORY))).toBe(false);
  });

  it("asks for the image rights, and keeps an unverified image off the public site", async () => {
    const missing = await upload(await photo(), "a.jpg", "image/jpeg", { alt: "" });
    expect(missing.body.fields).toEqual({
      rights: "Précisez si des personnes sont reconnaissables.",
    });
    const uploaded = await upload(await photo(), "a.jpg", "image/jpeg", { rights: "unverified" });
    const { id, url } = uploaded.body.media as { id: number; url: string };
    expect((await app.request(url)).status).toBe(404);
    const signedIn = await app.request(url, { headers: { cookie: coachCookie } });
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.get("cache-control")).toBe("private, no-store");

    const updated = await call("PUT", `/api/media/${id}`, editorCookie, {
      alt: "Les U13",
      rights: "authorized",
    });
    expect(updated.status).toBe(200);
    expect((await app.request(url)).status).toBe(200);
    expect(events()).toEqual(["media.uploaded", "media.updated"]);

    expect((await call("DELETE", `/api/media/${id}`, editorCookie)).status).toBe(204);
    expect((await app.request(url)).status).toBe(404);
    expect(readdirSync(join(harness.dataDir, MEDIA_DIRECTORY))).toEqual([]);
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, "media.deleted")).all(),
    ).toHaveLength(1);
  });

  it("is reserved to the accounts that edit the pages, and only answers its own paths", async () => {
    expect(
      (await upload(await photo(), "a.jpg", "image/jpeg", { rights: "none" }, coachCookie)).status,
    ).toBe(403);
    expect((await call("GET", "/api/media", coachCookie)).status).toBe(403);
    // The check of this API does not reach the rest of `/api`.
    expect((await call("GET", "/api/setup", undefined)).status).toBe(200);
    expect((await app.request("/media/../database.sqlite")).status).toBe(404);
    expect((await app.request(`/media/${"0".repeat(32)}-400.webp`)).status).toBe(404);
  });
});

describe("posts", () => {
  it("creates a draft with a slug from its title, publishes it once, and refuses a taken slug", async () => {
    const created = await call("POST", "/api/posts", editorCookie, {
      title: "Victoire des U13 à Lyon !",
      excerpt: "Un beau match.",
    });
    expect(created.status).toBe(201);
    const post = created.body.post as { id: number; slug: string; status: string; path: string };
    expect(post).toMatchObject({
      slug: "victoire-des-u13-a-lyon",
      path: "/actualites/victoire-des-u13-a-lyon",
      status: "draft",
      publishedAt: null,
    });
    expect(events()).toEqual([]);
    const published = await call("POST", `/api/posts/${post.id}/publish`, editorCookie);
    expect(published.body.post).toMatchObject({
      status: "published",
      publishedAt: expect.any(Number),
    });
    expect(events()).toEqual(["post.published"]);
    await call("PUT", `/api/posts/${post.id}`, editorCookie, {
      title: "Victoire des U13",
      slug: post.slug,
    });
    expect(events()).toEqual(["post.published", "post.updated"]);

    const taken = await call("POST", "/api/posts", editorCookie, {
      title: "Autre",
      slug: "victoire-des-u13-a-lyon",
    });
    expect(taken.status).toBe(409);
    const invalid = await call("POST", "/api/posts", editorCookie, {
      title: "Autre",
      slug: "Pas Bon",
    });
    expect(invalid.body.fields).toEqual({
      slug: "L'adresse ne contient que des lettres minuscules, des chiffres et des tirets.",
    });
    const references = await call("POST", "/api/posts", editorCookie, {
      title: "Autre",
      imageId: 9,
      categoryId: 9,
    });
    expect(references.body.fields).toEqual({ categoryId: "Cette catégorie n'existe pas." });
  });
});

describe("partners", () => {
  it("checks the site address and the period", async () => {
    const unsafe = await call("POST", "/api/partners", editorCookie, {
      name: "Garage",
      url: "javascript:alert(1)",
    });
    expect(unsafe.body.fields).toEqual({
      url: "L'adresse du site est invalide : utilisez une adresse de la forme https://exemple.fr.",
    });
    const reversed = await call("POST", "/api/partners", editorCookie, {
      name: "Garage",
      startsOn: "2027-01-01",
      endsOn: "2026-01-01",
    });
    expect(reversed.body.fields).toEqual({ endsOn: "La période doit finir après son début." });
    const created = await call("POST", "/api/partners", editorCookie, {
      name: "Garage du Stade",
      url: "https://garage.example",
      level: "gold",
      startsOn: "",
    });
    expect(created.status).toBe(201);
    expect(created.body.partner).toMatchObject({ level: "gold", startsOn: null, endsOn: null });
    expect(events()).toEqual(["partner.updated"]);
  });
});
