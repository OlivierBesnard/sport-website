import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestDatabase,
  type Database,
  IN_MEMORY,
  inboundWebhooks,
  jobs,
  migrate,
  modules,
  openDatabase,
  outboxEvents,
  settings,
} from "./index.js";
import { writeMigrations } from "./test-migrations.js";

const UNIQUE_VIOLATION = expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" });

let db: Database;
let tempDir: string;

beforeEach(() => {
  db = createTestDatabase();
  tempDir = mkdtempSync(join(tmpdir(), "sport-cms-limits-"));
});

afterEach(() => {
  if (db.$client.open) {
    db.$client.close();
  }
  rmSync(tempDir, { recursive: true, force: true });
  vi.useRealTimers();
});

describe("inbound webhook bodies", () => {
  function storeAndReload(body: Buffer) {
    db.insert(modules).values({ id: "exemple", version: "1.0.0" }).onConflictDoNothing().run();
    const { id } = db
      .insert(inboundWebhooks)
      .values({ moduleId: "exemple", name: "notifications", headers: {}, body })
      .returning({ id: inboundWebhooks.id })
      .get();
    const stored = db.select().from(inboundWebhooks).where(eq(inboundWebhooks.id, id)).get();
    const raw = db.$client
      .prepare(
        "SELECT typeof(body) AS type, length(body) AS length FROM inbound_webhooks WHERE id = ?",
      )
      .get(id);
    return { stored, raw };
  }

  it("keeps every byte value, invalid UTF-8, a BOM, CRLF and NUL bytes", () => {
    const body = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from('{"nom":"Élodie"}\r\n', "utf8"),
      Buffer.from([0xc3, 0x28, 0xa0, 0xa1, 0xff, 0xfe, 0x00, 0x00]),
      Buffer.from(Array.from({ length: 256 }, (_, byte) => byte)),
    ]);
    const { stored, raw } = storeAndReload(body);
    expect(Buffer.isBuffer(stored?.body)).toBe(true);
    expect(Buffer.compare(stored?.body ?? Buffer.alloc(0), body)).toBe(0);
    expect(raw).toEqual({ type: "blob", length: body.length });
  });

  it("stores an empty body as an empty BLOB, not as NULL", () => {
    const { stored, raw } = storeAndReload(Buffer.alloc(0));
    expect(stored?.body).toEqual(Buffer.alloc(0));
    expect(raw).toEqual({ type: "blob", length: 0 });
  });
});

describe("outbox idempotency", () => {
  function emit(idempotencyKey: string, amount: number) {
    return db
      .insert(outboxEvents)
      .values({
        type: "payment.received",
        source: "helloasso",
        idempotencyKey,
        payload: { amount },
      })
      .onConflictDoNothing()
      .run();
  }

  it("turns a second emission of the same event into a no-op that keeps the first payload", () => {
    expect(emit("order-42", 3000).changes).toBe(1);
    expect(emit("order-42", 9999).changes).toBe(0);
    expect(db.select({ payload: outboxEvents.payload }).from(outboxEvents).all()).toEqual([
      { payload: { amount: 3000 } },
    ]);
  });
});

describe("jobs unique key", () => {
  it("is unique across owners: core and modules share the key space", () => {
    db.insert(modules).values({ id: "helloasso", version: "1.0.0" }).run();
    db.insert(jobs).values({ name: "backup", uniqueKey: "tick@2026-10-25T03:00" }).run();
    expect(() =>
      db
        .insert(jobs)
        .values({ moduleId: "helloasso", name: "sync-orders", uniqueKey: "tick@2026-10-25T03:00" })
        .run(),
    ).toThrow(UNIQUE_VIOLATION);
  });
});

describe("settings upsert", () => {
  it("bumps updated_at when an existing key is replaced", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const created = new Date("2026-10-25T10:00:00.000Z");
    const replaced = new Date("2026-10-25T11:30:00.000Z");
    vi.setSystemTime(created);
    db.insert(settings).values({ key: "club.name", value: "US Exemple" }).run();

    vi.setSystemTime(replaced);
    db.insert(settings)
      .values({ key: "club.name", value: "Union Sportive Exemple" })
      .onConflictDoUpdate({ target: settings.key, set: { value: "Union Sportive Exemple" } })
      .run();

    expect(db.select().from(settings).all()).toEqual([
      { key: "club.name", value: "Union Sportive Exemple", updatedAt: replaced },
    ]);
  });
});

describe("migrations and an older version of the application", () => {
  const V1 = [["CREATE TABLE `club` (`id` integer PRIMARY KEY NOT NULL)"]];
  const V2 = [...V1, ["ALTER TABLE `club` ADD `name` text DEFAULT '' NOT NULL"]];

  it("leaves a database migrated by a newer version untouched (N-1 still starts)", () => {
    const migrated = openDatabase(IN_MEMORY);
    try {
      migrate(migrated, { migrationsFolder: writeMigrations(join(tempDir, "v2"), V2) });
      migrated.$client.exec("INSERT INTO club (id, name) VALUES (1, 'US Exemple')");
      const schema = migrated.$client.prepare("SELECT sql FROM sqlite_schema").all();

      expect(() =>
        migrate(migrated, { migrationsFolder: writeMigrations(join(tempDir, "v1"), V1) }),
      ).not.toThrow();

      expect(migrated.$client.prepare("SELECT sql FROM sqlite_schema").all()).toEqual(schema);
      expect(
        migrated.$client.prepare("SELECT count(*) FROM __drizzle_migrations").pluck().get(),
      ).toBe(2);
      expect(migrated.$client.prepare("SELECT id, name FROM club").all()).toEqual([
        { id: 1, name: "US Exemple" },
      ]);
    } finally {
      migrated.$client.close();
    }
  });
});
