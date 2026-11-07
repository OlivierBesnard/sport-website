import { describe, expect, it } from "vitest";
import { emitEvent } from "./events.js";
import { outboxEvents } from "./schema/index.js";
import { createTestDatabase } from "./testing.js";

describe("emitEvent", () => {
  it("writes the event to the outbox, version 1 by default", () => {
    const db = createTestDatabase();
    const id = emitEvent(db, { type: "page.published", source: "core", payload: { path: "/" } });
    expect(id).toBe(1);
    expect(db.select().from(outboxEvents).all()).toMatchObject([
      { id: 1, type: "page.published", version: 1, source: "core", payload: { path: "/" } },
    ]);
  });

  it("stores an event once per source and idempotency key", () => {
    const db = createTestDatabase();
    const first = { type: "payment.received", source: "helloasso", payload: { amount: 30 } };
    expect(emitEvent(db, { ...first, idempotencyKey: "order-42" })).toBeTypeOf("number");
    expect(emitEvent(db, { ...first, idempotencyKey: "order-42" })).toBeUndefined();
    // Another source may use the same key; events without a key are never deduplicated.
    expect(emitEvent(db, { ...first, source: "stripe", idempotencyKey: "order-42" })).toBeTypeOf(
      "number",
    );
    emitEvent(db, first);
    emitEvent(db, first);
    expect(
      db
        .select()
        .from(outboxEvents)
        .all()
        .map((event) => event.source),
    ).toEqual(["helloasso", "stripe", "helloasso", "helloasso"]);
  });

  it("is rolled back with the transaction it belongs to", () => {
    const db = createTestDatabase();
    expect(() =>
      db.transaction(() => {
        emitEvent(db, { type: "page.published", source: "core", payload: {} });
        throw new Error("échec de la publication");
      }),
    ).toThrow("échec de la publication");
    expect(db.select().from(outboxEvents).all()).toEqual([]);
  });

  it("refuses an invalid type or version", () => {
    const db = createTestDatabase();
    expect(() => emitEvent(db, { type: "Publié", source: "core", payload: {} })).toThrow(
      "Type d'événement invalide",
    );
    expect(() =>
      emitEvent(db, { type: "page.published", version: 0, source: "core", payload: {} }),
    ).toThrow("Version d'événement invalide");
  });
});
