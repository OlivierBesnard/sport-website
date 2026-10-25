import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BUSY_TIMEOUT_MS,
  createTestDatabase,
  type Database,
  IN_MEMORY,
  migrate,
  modules,
  openDatabase,
  pages,
} from "./index.js";

let tempDir: string;
const openedDatabases: Database[] = [];

function open(path: string): Database {
  const db = openDatabase(path);
  openedDatabases.push(db);
  return db;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sport-cms-db-"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const db of openedDatabases.splice(0)) {
    if (db.$client.open) {
      db.$client.close();
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("openDatabase", () => {
  it("creates the database file and its missing parent directories", () => {
    const path = join(tempDir, "data", "nested", "club.sqlite");
    const db = open(path);
    expect(existsSync(path)).toBe(true);
    expect(db.$client.name).toBe(path);
  });

  it("enables WAL, foreign keys and the busy timeout on a file", () => {
    const db = open(join(tempDir, "club.sqlite"));
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.$client.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
  });

  it("keeps WAL for every later connection to the same file", () => {
    const path = join(tempDir, "club.sqlite");
    open(path).$client.close();
    const reopened = open(path);
    expect(reopened.$client.pragma("journal_mode", { simple: true })).toBe("wal");
  });

  it("enables foreign keys and the busy timeout in memory", () => {
    const db = open(IN_MEMORY);
    expect(db.$client.memory).toBe(true);
    expect(db.$client.pragma("journal_mode", { simple: true })).toBe("memory");
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(db.$client.pragma("busy_timeout", { simple: true })).toBe(BUSY_TIMEOUT_MS);
  });

  it("does not migrate the schema", () => {
    const db = open(IN_MEMORY);
    const tables = db.$client
      .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
      .pluck()
      .all();
    expect(tables).toEqual([]);
  });

  it("lets a second connection read while the first one is writing", () => {
    const path = join(tempDir, "club.sqlite");
    const writer = open(path);
    migrate(writer);
    const reader = open(path);
    writer.insert(pages).values({ path: "/", title: "Accueil", draftData: {} }).run();

    writer.$client.exec("BEGIN IMMEDIATE");
    writer.update(pages).set({ title: "Accueil modifié" }).where(eq(pages.path, "/")).run();
    // WAL: the reader is not blocked and still sees the last committed state.
    expect(reader.select({ title: pages.title }).from(pages).all()).toEqual([{ title: "Accueil" }]);
    writer.$client.exec("COMMIT");
    expect(reader.select({ title: pages.title }).from(pages).all()).toEqual([
      { title: "Accueil modifié" },
    ]);
  });

  it("gives Drizzle typed access to every table", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    db.insert(modules).values({ id: "exemple", version: "1.0.0" }).run();
    const module = db.query.modules.findFirst({ where: eq(modules.id, "exemple") }).sync();
    expect(module).toMatchObject({ id: "exemple", version: "1.0.0", enabled: false, settings: {} });
  });
});

describe("storage formats", () => {
  it("stores dates as integer epoch milliseconds, set to the current time on insert", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    const now = new Date("2026-10-25T14:03:27.481Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);

    const page = db
      .insert(pages)
      .values({ path: "/", title: "Accueil", draftData: {} })
      .returning()
      .get();

    expect(page.createdAt).toEqual(now);
    expect(page.updatedAt).toEqual(now);
    const raw = db.$client
      .prepare("SELECT typeof(created_at) AS type, created_at AS value FROM pages")
      .get();
    expect(raw).toEqual({ type: "integer", value: now.getTime() });
  });

  it("leaves automatic dates to Drizzle: a raw SQL insert must provide them", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    const insert = (sql: string) => () => db.$client.prepare(sql).run();
    expect(insert(`INSERT INTO settings (key, value) VALUES ('a', '1')`)).toThrow(
      /NOT NULL constraint failed: settings.updated_at/,
    );
    expect(
      insert(`INSERT INTO settings (key, value, updated_at) VALUES ('a', '1', 0)`),
    ).not.toThrow();
  });

  it("writes a given date as its epoch milliseconds", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    const publishedAt = new Date("2026-09-01T18:30:15.123Z");
    db.insert(pages).values({ path: "/", title: "Accueil", draftData: {}, publishedAt }).run();
    expect(db.$client.prepare("SELECT published_at FROM pages").pluck().get()).toBe(
      publishedAt.getTime(),
    );
    expect(db.select().from(pages).get()?.publishedAt).toEqual(publishedAt);
  });

  it("stores JSON as text that SQLite JSON functions can read", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    db.insert(pages)
      .values({
        path: "/",
        title: "Accueil",
        seo: { description: "Le site du club" },
        draftData: { root: { props: { title: "Accueil" } }, content: [] },
      })
      .run();
    const raw = db.$client
      .prepare(
        "SELECT typeof(draft_data) AS type, json_valid(draft_data) AS valid, json_extract(seo, '$.description') AS description FROM pages",
      )
      .get();
    expect(raw).toEqual({ type: "text", valid: 1, description: "Le site du club" });
  });

  it("stores booleans as 0 and 1", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    db.insert(modules).values({ id: "exemple", version: "1.0.0", enabled: true }).run();
    expect(db.$client.prepare("SELECT enabled FROM modules").pluck().get()).toBe(1);
  });
});
