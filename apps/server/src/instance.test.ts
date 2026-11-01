import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RuntimeConfigError } from "@sport-cms/core/config";
import { openDatabase, pages } from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Instance, openInstance } from "./instance.js";

let tempDir: string;
const opened: Instance[] = [];

function open(env: Record<string, string>): Instance {
  const instance = openInstance(env);
  opened.push(instance);
  return instance;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sport-cms-server-"));
});

afterEach(() => {
  for (const { db } of opened.splice(0)) {
    if (db.$client.open) {
      db.$client.close();
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("openInstance", () => {
  it("reads the configuration and creates the migrated database in DATA_DIR", () => {
    const dataDir = join(tempDir, "Données du club");
    const { config, db } = open({ DATA_DIR: dataDir, PORT: "8080" });
    expect(config).toMatchObject({ dataDir, port: 8080, baseUrl: "http://localhost:8080" });
    expect(existsSync(join(dataDir, "database.sqlite"))).toBe(true);
    expect(db.select().from(pages).all()).toEqual([]);
  });

  it("reopens an existing database with its data", () => {
    const env = { DATA_DIR: join(tempDir, "data") };
    const first = open(env);
    first.db.insert(pages).values({ path: "/", title: "Accueil", draftData: {} }).run();
    first.db.$client.close();
    const second = open(env);
    expect(second.db.select({ path: pages.path }).from(pages).all()).toEqual([{ path: "/" }]);
  });

  it("closes the database and reports a failed migration", () => {
    const dataDir = join(tempDir, "data");
    // A table the migrations create already exists: applying them fails.
    const broken = openDatabase(join(dataDir, "database.sqlite"));
    broken.$client.exec("CREATE TABLE `audit_log` (`id` integer)");
    broken.$client.close();
    let error: unknown;
    try {
      openInstance({ DATA_DIR: dataDir });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    // The connection of the failed instance is closed: the database file is not kept locked and
    // can be removed right away (which afterEach does for the whole directory).
    expect(() => rmSync(join(dataDir, "database.sqlite"))).not.toThrow();
  });

  it("refuses an invalid configuration before touching the disk", () => {
    const dataDir = join(tempDir, "jamais-cree");
    expect(() => openInstance({ DATA_DIR: dataDir, PORT: "quatre-vingts" })).toThrow(
      RuntimeConfigError,
    );
    expect(existsSync(dataDir)).toBe(false);
  });
});
