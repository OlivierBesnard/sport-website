import { createSecretKey, randomBytes } from "node:crypto";
import { coreBlocks } from "@sport-cms/blocks";
import { createTestDatabase, type Database, pages } from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { DEMO_PAGES, seedDemoContent } from "./demo-content.js";

let db: Database;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  db.$client.close();
});

/** Every block of a list, nested ones included. */
function collectBlocks(items: unknown): { type: string; props: Record<string, unknown> }[] {
  if (!Array.isArray(items)) {
    return [];
  }
  return items.flatMap((item: { type: string; props: Record<string, unknown> }) => [
    item,
    ...Object.values(item.props).flatMap((value) => collectBlocks(value)),
  ]);
}

describe("seedDemoContent", () => {
  it("adds the demonstration pages, published", () => {
    expect(seedDemoContent(db)).toBe(DEMO_PAGES.length);
    const stored = db.select().from(pages).all();
    expect(stored.map((page) => page.path).sort()).toEqual(["/", "/le-club"]);
    for (const page of stored) {
      expect(page.status).toBe("published");
      expect(page.publishedData).toEqual(page.draftData);
      expect(page.publishedAt).toBeInstanceOf(Date);
    }
  });

  it("adds nothing when run again, and never replaces an existing page", () => {
    db.insert(pages).values({ path: "/", title: "Ma page", draftData: {} }).run();
    expect(seedDemoContent(db)).toBe(DEMO_PAGES.length - 1);
    expect(seedDemoContent(db)).toBe(0);
    const home = db
      .select()
      .from(pages)
      .all()
      .find((page) => page.path === "/");
    expect(home).toMatchObject({ title: "Ma page", status: "draft" });
  });

  it("only uses core blocks, so every block is rendered", () => {
    const types = new Set(coreBlocks.map((block) => block.type));
    for (const page of DEMO_PAGES) {
      for (const block of collectBlocks(page.data.content)) {
        expect(types).toContain(block.type);
      }
    }
  });

  it("gives a home page served by the public site", async () => {
    seedDemoContent(db);
    const logger = { error: vi.fn() };
    const app = createApp({
      db,
      baseUrl: "http://localhost:3000",
      secretKey: createSecretKey(randomBytes(32)),
      logger,
    });

    const home = await app.request("/");
    expect(home.status).toBe(200);
    const html = await home.text();
    expect(html).toContain("<title>US Exemple – Club de rugby</title>");
    expect(html).toContain('<h1 class="cms-hero__title">US Exemple</h1>');
    expect(html).toContain('<div class="cms-columns cms-columns--thirds">');
    expect(html).toContain('<p class="cms-text-center">');
    expect(html.match(/<h1/g)).toHaveLength(1);

    const club = await app.request("/le-club");
    expect(club.status).toBe(200);
    expect((await club.text()).match(/<h1/g)).toHaveLength(1);
    expect(logger.error).not.toHaveBeenCalled();
  });
});
