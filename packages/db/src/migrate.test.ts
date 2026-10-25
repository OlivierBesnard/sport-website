import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { sql } from "drizzle-orm";
import { migrate as applyDrizzleMigrations } from "drizzle-orm/better-sqlite3/migrator";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type Database,
  IN_MEMORY,
  MIGRATIONS_FOLDER,
  MIGRATIONS_TABLE,
  migrate,
  openDatabase,
  pages,
  settings,
} from "./index.js";
import * as schema from "./schema/index.js";
import { writeMigrations } from "./test-migrations.js";

const EXPECTED_TABLES = [
  "audit_log",
  "event_deliveries",
  "inbound_webhooks",
  "jobs",
  "module_credentials",
  "module_kv",
  "modules",
  "navigation",
  "outbox_events",
  "page_versions",
  "pages",
  "settings",
];

type JournalEntry = { idx: number; tag: string; when: number };

function readJournal(folder = MIGRATIONS_FOLDER): { entries: JournalEntry[] } {
  return JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8"));
}

/** Every object of the database schema with its SQL, to compare two states. */
function schemaDump(db: Database): unknown[] {
  return db.$client
    .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name")
    .all();
}

function appliedMigrations(db: Database): unknown[] {
  return db.$client.prepare(`SELECT hash, created_at FROM ${MIGRATIONS_TABLE}`).all();
}

function userTables(db: Database): string[] {
  return db.$client
    .prepare(
      "SELECT name FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name <> ? ORDER BY name",
    )
    .pluck()
    .all(MIGRATIONS_TABLE) as string[];
}

let tempDir: string;
const openedDatabases: Database[] = [];

function open(path: string): Database {
  const db = openDatabase(path);
  openedDatabases.push(db);
  return db;
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "sport-cms-migrate-"));
});

afterEach(() => {
  for (const db of openedDatabases.splice(0)) {
    if (db.$client.open) {
      db.$client.close();
    }
  }
  rmSync(tempDir, { recursive: true, force: true });
});

describe("migrations folder", () => {
  it("is the migrations directory at the root of the package", () => {
    expect(MIGRATIONS_FOLDER).toBe(fileURLToPath(new URL("../migrations", import.meta.url)));
    expect(existsSync(join(MIGRATIONS_FOLDER, "meta", "_journal.json"))).toBe(true);
  });

  it("holds the SQL file and the snapshot of every journal entry", () => {
    const { entries } = readJournal();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(existsSync(join(MIGRATIONS_FOLDER, `${entry.tag}.sql`))).toBe(true);
      const snapshot = `${String(entry.idx).padStart(4, "0")}_snapshot.json`;
      expect(existsSync(join(MIGRATIONS_FOLDER, "meta", snapshot))).toBe(true);
    }
  });

  it("numbers its entries in order, with strictly increasing timestamps", () => {
    // A migration is applied only if its `when` is later than the last applied one: generated
    // with a clock running late, it would be skipped silently on existing instances.
    const { entries } = readJournal();
    entries.forEach((entry, position) => {
      expect(entry.idx).toBe(position);
      if (position > 0) {
        expect(entry.when).toBeGreaterThan((entries[position - 1] as JournalEntry).when);
      }
    });
  });

  it("matches the Drizzle schema: no migration is left to generate", async () => {
    const { entries } = readJournal();
    const last = entries.at(-1) as JournalEntry;
    const snapshotFile = `${String(last.idx).padStart(4, "0")}_snapshot.json`;
    const snapshot = JSON.parse(
      readFileSync(join(MIGRATIONS_FOLDER, "meta", snapshotFile), "utf8"),
    );
    const current = await generateSQLiteDrizzleJson(schema);
    expect(await generateSQLiteMigration(snapshot, current)).toEqual([]);
  });
});

describe("migrate", () => {
  it("creates every table in a new database", () => {
    const db = open(join(tempDir, "club.sqlite"));
    expect(userTables(db)).toEqual([]);
    expect(migrate(db)).toBe(readJournal().entries.length);
    expect(userTables(db)).toEqual(EXPECTED_TABLES);
    expect(appliedMigrations(db)).toHaveLength(readJournal().entries.length);
    expect(db.$client.pragma("integrity_check", { simple: true })).toBe("ok");
    expect(db.$client.pragma("foreign_key_check")).toEqual([]);
  });

  it("does nothing the second time", () => {
    const db = open(join(tempDir, "club.sqlite"));
    migrate(db);
    db.insert(settings).values({ key: "club.name", value: "US Exemple" }).run();
    const schemaBefore = schemaDump(db);
    const migrationsBefore = appliedMigrations(db);

    expect(migrate(db)).toBe(0);

    expect(schemaDump(db)).toEqual(schemaBefore);
    expect(appliedMigrations(db)).toEqual(migrationsBefore);
    expect(db.select().from(settings).all()).toMatchObject([
      { key: "club.name", value: "US Exemple" },
    ]);
  });

  it("does nothing on a migrated database opened again", () => {
    const path = join(tempDir, "club.sqlite");
    const first = open(path);
    migrate(first);
    first
      .insert(pages)
      .values({ path: "/", title: "Accueil", draftData: { content: [] } })
      .run();
    const schemaBefore = schemaDump(first);
    first.$client.close();

    const second = open(path);
    migrate(second);
    expect(schemaDump(second)).toEqual(schemaBefore);
    expect(appliedMigrations(second)).toHaveLength(readJournal().entries.length);
    expect(second.select({ path: pages.path }).from(pages).all()).toEqual([{ path: "/" }]);
  });

  it("leaves foreign keys enforced afterwards", () => {
    const db = open(IN_MEMORY);
    migrate(db);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("refuses to run inside a transaction", () => {
    const db = open(IN_MEMORY);
    db.$client.exec("BEGIN");
    expect(() => migrate(db)).toThrow("Migrations cannot run inside a transaction.");
    db.$client.exec("ROLLBACK");
    expect(userTables(db)).toEqual([]);
  });
});

describe("migrations written like drizzle-kit's", () => {
  const CREATE_TABLES = [
    "CREATE TABLE `parent` (`id` integer PRIMARY KEY NOT NULL)",
    "CREATE TABLE `child` (`id` integer PRIMARY KEY NOT NULL, `parent_id` integer NOT NULL REFERENCES `parent`(`id`) ON DELETE cascade)",
  ];

  /** The table rebuild drizzle-kit generates to alter a SQLite table. */
  const REBUILD_PARENT = [
    "PRAGMA foreign_keys=OFF;",
    "CREATE TABLE `__new_parent` (`id` integer PRIMARY KEY NOT NULL, `name` text DEFAULT '' NOT NULL)",
    "INSERT INTO `__new_parent`(`id`) SELECT `id` FROM `parent`;",
    "DROP TABLE `parent`;",
    "ALTER TABLE `__new_parent` RENAME TO `parent`;",
    "PRAGMA foreign_keys=ON;",
  ];

  /** Applies `migrations`, written in a folder of their own, and returns how many were applied. */
  function apply(db: Database, name: string, migrations: string[][]): number {
    return migrate(db, { migrationsFolder: writeMigrations(join(tempDir, name), migrations) });
  }

  /** Database at "version N": parent and child tables, one parent with one child. */
  function databaseWithChildren(): Database {
    const db = open(IN_MEMORY);
    apply(db, "v1", [CREATE_TABLES]);
    db.$client.exec(
      "INSERT INTO parent (id) VALUES (1); INSERT INTO child (id, parent_id) VALUES (10, 1);",
    );
    return db;
  }

  it("applies only the pending migrations and returns their number", () => {
    const db = open(IN_MEMORY);
    const addName = ["ALTER TABLE `parent` ADD `name` text"];
    expect(apply(db, "v1", [CREATE_TABLES])).toBe(1);
    expect(apply(db, "v2", [CREATE_TABLES, addName])).toBe(1);
    expect(apply(db, "v2-again", [CREATE_TABLES, addName])).toBe(0);
    expect(appliedMigrations(db)).toHaveLength(2);
  });

  it("rebuilds a parent table without cascading to its children", () => {
    const db = databaseWithChildren();

    apply(db, "v2", [CREATE_TABLES, REBUILD_PARENT]);

    expect(db.$client.prepare("SELECT id, name FROM parent").all()).toEqual([{ id: 1, name: "" }]);
    expect(db.$client.prepare("SELECT id, parent_id FROM child").all()).toEqual([
      { id: 10, parent_id: 1 },
    ]);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    // The rebuilt table is still referenced: deleting the parent cascades again.
    db.$client.exec("DELETE FROM parent");
    expect(db.$client.prepare("SELECT count(*) FROM child").pluck().get()).toBe(0);
  });

  it("rolls back every pending migration when one of them fails", () => {
    const db = open(IN_MEMORY);
    expect(() =>
      apply(db, "broken", [
        CREATE_TABLES,
        ["CREATE TABLE `other` (`id` integer PRIMARY KEY NOT NULL)", "THIS IS NOT SQL"],
      ]),
    ).toThrow();
    expect(userTables(db)).toEqual([]);
    expect(appliedMigrations(db)).toEqual([]);
    expect(db.$client.inTransaction).toBe(false);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
  });

  it("rolls back migrations that would violate foreign keys, and version N still starts", () => {
    const db = databaseWithChildren();
    const schemaBefore = schemaDump(db);
    const migrationsBefore = appliedMigrations(db);

    expect(() =>
      apply(db, "v2", [
        CREATE_TABLES,
        ["CREATE TABLE `other` (`id` integer PRIMARY KEY NOT NULL)", "DELETE FROM `parent`"],
      ]),
    ).toThrow("Migrations rolled back: they would leave foreign key violations (child: 1).");

    expect(schemaDump(db)).toEqual(schemaBefore);
    expect(appliedMigrations(db)).toEqual(migrationsBefore);
    expect(db.$client.prepare("SELECT id FROM parent").all()).toEqual([{ id: 1 }]);
    expect(db.$client.inTransaction).toBe(false);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    // Version N, restarted after the failed update, finds nothing to do.
    expect(apply(db, "v1-again", [CREATE_TABLES])).toBe(0);
  });

  it("counts the violations per table in its error", () => {
    const db = databaseWithChildren();
    db.$client.exec("INSERT INTO child (id, parent_id) VALUES (11, 1), (12, 1);");
    const orphanRules = [
      "CREATE TABLE `rule` (`id` integer PRIMARY KEY NOT NULL, `parent_id` integer REFERENCES `parent`(`id`))",
      "INSERT INTO `rule` (`id`, `parent_id`) VALUES (1, 1)",
      "DELETE FROM `parent`",
    ];
    expect(() => apply(db, "v2", [CREATE_TABLES, orphanRules])).toThrow(
      "Migrations rolled back: they would leave foreign key violations (child: 3, rule: 1).",
    );
  });

  it("checks no foreign key when no migration is pending", () => {
    const db = databaseWithChildren();
    // A violation left by something other than the migrations (foreign keys disabled here).
    db.$client.pragma("foreign_keys = OFF");
    db.$client.exec("DELETE FROM parent");
    db.$client.pragma("foreign_keys = ON");
    expect(db.$client.pragma("foreign_key_check")).toHaveLength(1);

    expect(apply(db, "v1-again", [CREATE_TABLES])).toBe(0);
  });

  it("keeps foreign keys disabled afterwards if they were", () => {
    const db = open(IN_MEMORY);
    db.$client.pragma("foreign_keys = OFF");
    apply(db, "v1", [CREATE_TABLES]);
    expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(0);
  });

  it("tracks each set of migrations in its own table", () => {
    const db = createTestDatabase();
    openedDatabases.push(db);
    const moduleMigrations = {
      migrationsFolder: writeMigrations(join(tempDir, "module"), [
        ["CREATE TABLE `mod_exemple_items` (`id` integer PRIMARY KEY NOT NULL)"],
      ]),
      migrationsTable: "__mod_exemple_migrations",
    };

    expect(migrate(db, moduleMigrations)).toBe(1);
    expect(migrate(db, moduleMigrations)).toBe(0);
    expect(migrate(db)).toBe(0);
    expect(appliedMigrations(db)).toHaveLength(readJournal().entries.length);
    expect(db.$client.prepare("SELECT count(*) FROM __mod_exemple_migrations").pluck().get()).toBe(
      1,
    );
    expect(userTables(db)).toContain("mod_exemple_items");
  });

  it("records applied migrations exactly like Drizzle's own migrator", () => {
    const folder = writeMigrations(join(tempDir, "v2"), [
      CREATE_TABLES,
      ["ALTER TABLE `parent` ADD `name` text"],
    ]);
    const ours = open(IN_MEMORY);
    const drizzles = open(IN_MEMORY);
    migrate(ours, { migrationsFolder: folder });
    applyDrizzleMigrations(drizzles, { migrationsFolder: folder });

    const trackingTable = (db: Database) =>
      db.$client.prepare("SELECT * FROM pragma_table_info(?) ORDER BY cid").all(MIGRATIONS_TABLE);
    expect(trackingTable(ours)).toEqual(trackingTable(drizzles));
    expect(appliedMigrations(ours)).toEqual(appliedMigrations(drizzles));
    expect(appliedMigrations(ours)).toEqual([
      { hash: expect.stringMatching(/^[0-9a-f]{64}$/), created_at: 1_700_000_000_000 },
      { hash: expect.stringMatching(/^[0-9a-f]{64}$/), created_at: 1_700_000_000_001 },
    ]);
    // Each one sees the other's progress.
    expect(migrate(drizzles, { migrationsFolder: folder })).toBe(0);
  });
});

describe("createTestDatabase", () => {
  it("returns a migrated in-memory database with foreign keys enforced", () => {
    const db = createTestDatabase();
    try {
      expect(db.$client.memory).toBe(true);
      expect(userTables(db)).toEqual(EXPECTED_TABLES);
      expect(appliedMigrations(db)).toHaveLength(readJournal().entries.length);
      expect(db.$client.pragma("foreign_keys", { simple: true })).toBe(1);
    } finally {
      db.$client.close();
    }
  });

  it("returns independent databases", () => {
    const first = createTestDatabase();
    const second = createTestDatabase();
    try {
      first.insert(settings).values({ key: "club.name", value: "US Exemple" }).run();
      expect(second.select().from(settings).all()).toEqual([]);
      expect(first.get(sql`select count(*) as count from ${settings}`)).toEqual({ count: 1 });
    } finally {
      first.$client.close();
      second.$client.close();
    }
  });
});
