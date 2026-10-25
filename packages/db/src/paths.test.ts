import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Database, migrate, openDatabase, pages, settings } from "./index.js";

let tempDir: string;
const openedDatabases: Database[] = [];

function open(path: string): Database {
  const db = openDatabase(path);
  openedDatabases.push(db);
  return db;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sport-cms-paths-"));
});

afterEach(() => {
  for (const db of openedDatabases.splice(0)) {
    if (db.$client.open) {
      db.$client.close();
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("openDatabase on paths a club may use", () => {
  it.each([
    ["spaces and accents", ["Mon Club Sportif", "Données été 2026", "club.sqlite"]],
    ["an emoji and an apostrophe", ["Club 🏉 de l'Étoile", "club.sqlite"]],
    ["#, %, & and ; characters", ["a#b%20c&d;e", "base #1.sqlite"]],
    ["accents in the file name", ["base de données.sqlite"]],
  ])("creates, migrates and reopens a database under a path with %s", (_label, segments) => {
    const path = join(tempDir, ...segments);
    const first = open(path);
    migrate(first);
    first.insert(pages).values({ path: "/", title: "Accueil", draftData: {} }).run();
    first.insert(settings).values({ key: "club.name", value: "US Élan" }).run();
    first.$client.close();
    expect(existsSync(path)).toBe(true);

    const second = open(path);
    migrate(second);
    expect(second.$client.pragma("journal_mode", { simple: true })).toBe("wal");
    expect(second.select({ path: pages.path }).from(pages).all()).toEqual([{ path: "/" }]);
    expect(second.select({ value: settings.value }).from(settings).all()).toEqual([
      { value: "US Élan" },
    ]);
  });

  it("removes the WAL files once the last connection is closed", () => {
    const path = join(tempDir, "club.sqlite");
    const db = open(path);
    migrate(db);
    expect(existsSync(`${path}-wal`)).toBe(true);
    db.$client.close();
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  it("fails on a file that is not a SQLite database, and releases it", () => {
    const path = join(tempDir, "pas-une-base.sqlite");
    writeFileSync(path, "ceci n'est pas une base SQLite, mais un simple fichier texte".repeat(20));
    expect(() => open(path)).toThrow(expect.objectContaining({ code: "SQLITE_NOTADB" }));
    // On Windows, a file still held open by SQLite could not be deleted.
    expect(() => rmSync(path)).not.toThrow();
  });
});
