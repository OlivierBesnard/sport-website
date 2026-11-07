import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { JsonObject } from "@sport-cms/db";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupBody } from "../auth/testing.js";
import { type BootedInstance, bootInstance } from "../boot.js";

/*
 * The news, partners and media on a whole instance, as `main.ts` wires it: the admin API, the
 * public site and its pages of the news, the cache and the events that keep it right.
 */

const BASE_URL = "http://localhost:3000";
let dataDir: string;
let instance: BootedInstance | undefined;
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-content-"));
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

async function uploadPhoto(booted: BootedInstance, cookie: string, rights: string) {
  const form = new FormData();
  const bytes = await sharp({
    create: { width: 1200, height: 800, channels: 3, background: "#c0392b" },
  })
    .png()
    .toBuffer();
  form.set("file", new File([new Uint8Array(bytes)], "victoire.png", { type: "image/png" }));
  form.set("alt", "Les U13 soulèvent la coupe");
  form.set("rights", rights);
  const response = await booted.app.request("/api/media", {
    method: "POST",
    headers: { cookie, origin: BASE_URL },
    body: form,
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { media: { id: number; url: string } }).media;
}

function homeData(...blocks: { type: string; props: JsonObject }[]): JsonObject {
  return {
    root: { props: { title: "Accueil" } },
    content: [
      {
        type: "Hero",
        props: {
          id: "hero",
          title: "US Exemple",
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

async function publishHome(booted: BootedInstance, cookie: string, data: JsonObject) {
  await send(booted, cookie, "POST", "/api/pages", { path: "/", title: "Accueil" });
  await send(booted, cookie, "PUT", "/api/pages/page?path=%2F", { data });
  await send(booted, cookie, "POST", "/api/pages/publish?path=%2F");
}

async function get(booted: BootedInstance, path: string) {
  const response = await booted.app.request(path);
  return { status: response.status, html: await response.text() };
}

describe("news on the public site", () => {
  it("shows a published news item in the block and on its own page, until it is unpublished", async () => {
    const { booted, cookie } = await start();
    const image = await uploadPhoto(booted, cookie, "authorized");
    const created = (await send(booted, cookie, "POST", "/api/posts", {
      title: "Victoire des U13",
      excerpt: "Les U13 remportent le tournoi de Noël.",
      body: "Une belle journée.\n\nBravo à toute l'équipe !",
      imageId: image.id,
    })) as { post: { id: number; path: string } };
    await publishHome(
      booted,
      cookie,
      homeData({
        type: "NewsList",
        props: { title: "Actualités", count: 6, categoryId: 0, teamId: 0, featuredOnly: false },
      }),
    );
    await booted.runtime.tick();

    let home = await get(booted, "/");
    expect(home.html).toContain("Aucune actualité pour le moment.");
    // A draft has no page.
    expect((await get(booted, created.post.path)).status).toBe(404);

    await send(booted, cookie, "POST", `/api/posts/${created.post.id}/publish`);
    await booted.runtime.tick();
    home = await get(booted, "/");
    expect(home.html).toContain('<a href="/actualites/victoire-des-u13">Victoire des U13</a>');
    expect(home.html).toContain(`src="${image.url}"`);
    const page = await get(booted, created.post.path);
    expect(page.status).toBe(200);
    expect(page.html).toContain('<h1 class="cms-heading">Victoire des U13</h1>');
    expect(page.html).toContain("<title>Victoire des U13</title>");
    expect(page.html).toContain(
      '<meta name="description" content="Les U13 remportent le tournoi de Noël."/>',
    );
    expect(page.html).toContain('alt="Les U13 soulèvent la coupe"');
    expect(page.html).toContain("Une belle journée.\n\nBravo à toute l&#x27;équipe !");
    expect(booted.htmlCache.get(created.post.path)).toBeDefined();

    // The image rights withdrawn: the image leaves the site, the news stays.
    await send(booted, cookie, "PUT", `/api/media/${image.id}`, {
      alt: "Les U13 soulèvent la coupe",
      rights: "unverified",
    });
    await booted.runtime.tick();
    expect((await get(booted, "/")).html).not.toContain(image.url);
    expect((await get(booted, created.post.path)).html).not.toContain(image.url);
    expect((await get(booted, image.url)).status).toBe(404);

    await send(booted, cookie, "POST", `/api/posts/${created.post.id}/unpublish`);
    await booted.runtime.tick();
    expect((await get(booted, created.post.path)).status).toBe(404);
    expect((await get(booted, "/")).html).toContain("Aucune actualité pour le moment.");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("does not let a page of the site use the block of the news pages", async () => {
    const { booted, cookie } = await start();
    await send(booted, cookie, "POST", "/api/pages", { path: "/piege", title: "Piège" });
    const response = await booted.app.request("/api/pages/page?path=%2Fpiege", {
      method: "PUT",
      headers: { cookie, origin: BASE_URL, "content-type": "application/json" },
      body: JSON.stringify({
        data: {
          root: { props: {} },
          content: [{ type: "_PostArticle", props: { id: "x", slug: "a" } }],
          zones: {},
        },
      }),
    });
    expect(response.status).toBe(400);
  });
});

describe("partners on the public site", () => {
  it("shows the partners of the day only", async () => {
    const { booted, cookie } = await start();
    const day = (offset: number) => {
      const date = new Date(Date.now() + offset * 86_400_000);
      const pad = (value: number) => String(value).padStart(2, "0");
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    };
    await send(booted, cookie, "POST", "/api/partners", {
      name: "Boulangerie Martin",
      url: "https://boulangerie.example",
      level: "gold",
      startsOn: day(-10),
      endsOn: day(10),
    });
    await send(booted, cookie, "POST", "/api/partners", {
      name: "Ancien sponsor",
      endsOn: day(-1),
    });
    await send(booted, cookie, "POST", "/api/partners", {
      name: "Futur sponsor",
      startsOn: day(2),
    });
    await publishHome(
      booted,
      cookie,
      homeData({ type: "Partners", props: { title: "Nos partenaires", level: "all" } }),
    );
    const home = await get(booted, "/");
    expect(home.html).toContain("Boulangerie Martin");
    expect(home.html).not.toContain("Ancien sponsor");
    expect(home.html).not.toContain("Futur sponsor");
  });
});
