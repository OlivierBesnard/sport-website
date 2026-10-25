import { eq, gt } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  auditLog,
  createTestDatabase,
  type Database,
  eventDeliveries,
  inboundWebhooks,
  jobs,
  moduleCredentials,
  moduleKv,
  modules,
  outboxEvents,
} from "./index.js";

const FOREIGN_KEY_VIOLATION = expect.objectContaining({ code: "SQLITE_CONSTRAINT_FOREIGNKEY" });
const UNIQUE_VIOLATION = expect.objectContaining({ code: "SQLITE_CONSTRAINT_UNIQUE" });

let db: Database;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  db.$client.close();
  vi.useRealTimers();
});

function insertModule(id: string) {
  db.insert(modules).values({ id, version: "1.0.0" }).run();
}

/** Gives the module one row in every table it owns. */
function fillModuleData(moduleId: string) {
  db.insert(moduleCredentials).values({ moduleId, encryptedValue: "v1:chiffré" }).run();
  db.insert(moduleKv)
    .values({ moduleId, key: "cursor", value: { page: 3 } })
    .run();
  db.insert(jobs).values({ moduleId, name: "sync-orders" }).run();
  db.insert(inboundWebhooks)
    .values({
      moduleId,
      name: "notifications",
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"eventType":"Order"}'),
    })
    .run();
}

async function countRows(moduleId: string) {
  return {
    credentials: await db.$count(moduleCredentials, eq(moduleCredentials.moduleId, moduleId)),
    kv: await db.$count(moduleKv, eq(moduleKv.moduleId, moduleId)),
    jobs: await db.$count(jobs, eq(jobs.moduleId, moduleId)),
    webhooks: await db.$count(inboundWebhooks, eq(inboundWebhooks.moduleId, moduleId)),
  };
}

describe("module data", () => {
  it("is deleted with its module, and only its own", async () => {
    insertModule("helloasso");
    insertModule("exemple");
    fillModuleData("helloasso");
    fillModuleData("exemple");
    db.insert(jobs).values({ name: "backup" }).run();

    db.delete(modules).where(eq(modules.id, "helloasso")).run();

    expect(await countRows("helloasso")).toEqual({ credentials: 0, kv: 0, jobs: 0, webhooks: 0 });
    expect(await countRows("exemple")).toEqual({ credentials: 1, kv: 1, jobs: 1, webhooks: 1 });
    expect(await db.$count(jobs)).toBe(2);
  });

  it("refuses rows for a module that does not exist", () => {
    expect(() => fillModuleData("inconnu")).toThrow(FOREIGN_KEY_VIOLATION);
    expect(() =>
      db.insert(moduleKv).values({ moduleId: "inconnu", key: "k", value: 1 }).run(),
    ).toThrow(FOREIGN_KEY_VIOLATION);
    expect(() => db.insert(jobs).values({ moduleId: "inconnu", name: "sync" }).run()).toThrow(
      FOREIGN_KEY_VIOLATION,
    );
    expect(() =>
      db
        .insert(inboundWebhooks)
        .values({ moduleId: "inconnu", name: "n", headers: {}, body: Buffer.alloc(0) })
        .run(),
    ).toThrow(FOREIGN_KEY_VIOLATION);
  });

  it("keeps a single value per module and key", () => {
    insertModule("exemple");
    db.insert(moduleKv).values({ moduleId: "exemple", key: "cursor", value: 1 }).run();
    expect(() =>
      db.insert(moduleKv).values({ moduleId: "exemple", key: "cursor", value: 2 }).run(),
    ).toThrow(expect.objectContaining({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }));
  });

  it("stores the exact bytes of a webhook body", () => {
    insertModule("exemple");
    const body = Buffer.from([0x00, 0xff, 0x7b, 0x22, 0xc3, 0xa9, 0x0a]);
    const stored = db
      .insert(inboundWebhooks)
      .values({ moduleId: "exemple", name: "notifications", headers: {}, body })
      .returning()
      .get();
    expect(stored.status).toBe("pending");
    expect(Buffer.compare(stored.body, body)).toBe(0);
  });
});

describe("outbox events", () => {
  function emit(source: string, idempotencyKey: string | null) {
    return db
      .insert(outboxEvents)
      .values({ type: "payment.received", source, idempotencyKey, payload: { amount: 3000 } })
      .returning()
      .get();
  }

  it("get increasing ids, usable as delivery cursors", () => {
    const first = emit("core", null);
    const second = emit("core", null);
    expect(second.id).toBeGreaterThan(first.id);
    expect(first.version).toBe(1);

    const cursor = db
      .insert(eventDeliveries)
      .values({ subscriber: "compta", lastEventId: first.id })
      .returning()
      .get();
    expect(cursor).toMatchObject({ attempts: 0, nextAttemptAt: null, lastError: null });
    const pending = db
      .select({ id: outboxEvents.id })
      .from(outboxEvents)
      .where(gt(outboxEvents.id, cursor.lastEventId))
      .all();
    expect(pending).toEqual([{ id: second.id }]);
  });

  it("refuse a second event with the same idempotency key from the same source", () => {
    emit("helloasso", "order-42");
    expect(() => emit("helloasso", "order-42")).toThrow(UNIQUE_VIOLATION);
    expect(() => emit("stripe", "order-42")).not.toThrow();
    expect(() => emit("helloasso", null)).not.toThrow();
    expect(() => emit("helloasso", null)).not.toThrow();
  });
});

describe("jobs", () => {
  it("are pending, runnable now and without payload by default", () => {
    const now = new Date("2026-10-25T03:00:00.000Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(now);
    const job = db.insert(jobs).values({ name: "backup" }).returning().get();
    expect(job).toMatchObject({
      moduleId: null,
      status: "pending",
      attempts: 0,
      payload: {},
      runAt: now,
      lockedUntil: null,
      finishedAt: null,
    });
  });

  it("refuse two occurrences with the same unique key", () => {
    db.insert(jobs).values({ name: "backup", uniqueKey: "backup@2026-10-25" }).run();
    expect(() =>
      db.insert(jobs).values({ name: "backup", uniqueKey: "backup@2026-10-25" }).run(),
    ).toThrow(UNIQUE_VIOLATION);
    expect(() => db.insert(jobs).values({ name: "backup" }).run()).not.toThrow();
    expect(() => db.insert(jobs).values({ name: "backup" }).run()).not.toThrow();
  });
});

describe("audit log", () => {
  it("records an action without requiring an existing account", () => {
    const entry = db
      .insert(auditLog)
      .values({ actorId: "compte-supprimé", action: "page.published", targetType: "page" })
      .returning()
      .get();
    expect(entry).toMatchObject({ action: "page.published", details: {}, targetId: null });
  });
});
