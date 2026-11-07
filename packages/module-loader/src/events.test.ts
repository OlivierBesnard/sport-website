import { createSecretKey, randomBytes } from "node:crypto";
import { coreBlocks } from "@sport-cms/blocks";
import {
  auditLog,
  createTestDatabase,
  type Database,
  emitEvent,
  eventDeliveries,
  outboxEvents,
} from "@sport-cms/db";
import { defineModule, type ModuleDefinition, type ModuleEvent } from "@sport-cms/module-sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventDispatcher, type EventSubscriber, moduleSubscribers, retryDelay } from "./events.js";
import { ModuleHost } from "./host.js";
import type { LoadedModule } from "./load.js";

let db: Database;
let clock: Date;
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const retry = { baseDelayMs: 1000, maxDelayMs: 8000, maxAttempts: 4 };

beforeEach(() => {
  db = createTestDatabase();
  clock = new Date("2026-11-07T10:00:00Z");
  for (const mock of Object.values(logger)) {
    mock.mockReset();
  }
});

afterEach(() => {
  db.$client.close();
});

function dispatcher(): EventDispatcher {
  return new EventDispatcher({ db, logger, now: () => clock, retry });
}

function later(ms: number): void {
  clock = new Date(clock.getTime() + ms);
}

function emit(type = "page.published", extra: Partial<Parameters<typeof emitEvent>[1]> = {}) {
  return emitEvent(db, { type, source: "core", payload: { n: 1 }, ...extra });
}

/** A subscriber recording what it receives, failing while `failures` is above zero. */
function recorder(name: string, accepts: (type: string) => boolean = () => true) {
  const received: ModuleEvent[] = [];
  const state = { failures: 0 };
  const subscriber: EventSubscriber = {
    name,
    accepts: (type) => accepts(type),
    handle: async (event) => {
      if (state.failures > 0) {
        state.failures -= 1;
        throw new Error(`échec de ${name}`);
      }
      received.push(event);
    },
  };
  return { subscriber, received, state };
}

function cursor(name: string) {
  return db.select().from(eventDeliveries).where(eq(eventDeliveries.subscriber, name)).get();
}

describe("EventDispatcher", () => {
  it("starts a new subscriber after the last event, then delivers the next ones in order", async () => {
    emit("page.published");
    const { subscriber, received } = recorder("core:test");
    expect(await dispatcher().dispatch([subscriber])).toBe(0);
    expect(cursor("core:test")?.lastEventId).toBe(1);

    emit("page.published", { payload: { n: 2 } });
    emit("module.enabled", { payload: { n: 3 } });
    expect(await dispatcher().dispatch([subscriber])).toBe(2);
    expect(received.map((event) => [event.id, event.type, event.payload.n])).toEqual([
      [2, "page.published", 2],
      [3, "module.enabled", 3],
    ]);
    expect(received[0]).toMatchObject({ version: 1, source: "core", key: "event:2" });
    // Nothing more to deliver.
    expect(await dispatcher().dispatch([subscriber])).toBe(0);
  });

  it("steps over the events a subscriber does not listen to", async () => {
    const { subscriber, received } = recorder("core:pages", (type) => type === "page.published");
    await dispatcher().dispatch([subscriber]);
    emit("module.enabled");
    emit("page.published");
    emit("module.disabled");
    await dispatcher().dispatch([subscriber]);
    expect(received.map((event) => event.type)).toEqual(["page.published"]);
    expect(cursor("core:pages")?.lastEventId).toBe(3);
  });

  it("does not let a failing subscriber hold up the others", async () => {
    const failing = recorder("core:a");
    const healthy = recorder("core:b");
    await dispatcher().dispatch([failing.subscriber, healthy.subscriber]);
    failing.state.failures = 1;
    emit();
    emit();
    expect(await dispatcher().dispatch([failing.subscriber, healthy.subscriber])).toBe(2);
    expect(failing.received).toEqual([]);
    expect(healthy.received.map((event) => event.id)).toEqual([1, 2]);
    expect(cursor("core:a")).toMatchObject({
      lastEventId: 0,
      attempts: 1,
      lastError: "échec de core:a",
    });
  });

  it("delivers an event again after a failure, with an exponential delay", async () => {
    const { subscriber, received, state } = recorder("core:retry");
    await dispatcher().dispatch([subscriber]);
    emit();
    state.failures = 2;

    await dispatcher().dispatch([subscriber]);
    expect(cursor("core:retry")?.nextAttemptAt).toEqual(new Date(clock.getTime() + 1000));
    // Before the delay: nothing is tried.
    await dispatcher().dispatch([subscriber]);
    expect(state.failures).toBe(1);

    later(1000);
    await dispatcher().dispatch([subscriber]);
    expect(cursor("core:retry")).toMatchObject({ attempts: 2 });
    expect(cursor("core:retry")?.nextAttemptAt).toEqual(new Date(clock.getTime() + 2000));

    later(2000);
    expect(await dispatcher().dispatch([subscriber])).toBe(1);
    expect(received.map((event) => event.id)).toEqual([1]);
    expect(cursor("core:retry")).toMatchObject({
      lastEventId: 1,
      attempts: 0,
      nextAttemptAt: null,
      lastError: null,
    });
  });

  it("gives an event up after the last attempt, audited, and goes on with the next", async () => {
    const { subscriber, received, state } = recorder("core:giveup");
    await dispatcher().dispatch([subscriber]);
    emit();
    emit();
    state.failures = retry.maxAttempts;
    for (let round = 0; round < retry.maxAttempts; round += 1) {
      await dispatcher().dispatch([subscriber]);
      later(retry.maxDelayMs);
    }
    expect(received.map((event) => event.id)).toEqual([2]);
    expect(db.select().from(auditLog).all()).toMatchObject([
      {
        action: "events.delivery_abandoned",
        targetType: "event",
        targetId: "1",
        details: {
          subscriber: "core:giveup",
          type: "page.published",
          error: "échec de core:giveup",
        },
      },
    ]);
  });

  it("processes once an event emitted twice with the same idempotency key", async () => {
    const { subscriber, received } = recorder("core:once");
    await dispatcher().dispatch([subscriber]);
    emit("payment.received", { source: "helloasso", idempotencyKey: "commande-42" });
    emit("payment.received", { source: "helloasso", idempotencyKey: "commande-42" });
    await dispatcher().dispatch([subscriber]);
    await dispatcher().dispatch([subscriber]);
    expect(received).toHaveLength(1);
    expect(received[0]?.key).toBe("helloasso:commande-42");
  });

  it("delivers again after a crash during the handler (at least once)", async () => {
    const { subscriber } = recorder("core:crash");
    await dispatcher().dispatch([subscriber]);
    emit();
    const seen: number[] = [];
    const crashing: EventSubscriber = {
      ...subscriber,
      handle: async (event) => {
        seen.push(event.id);
        // The process dies here: the cursor was not moved.
        throw new Error("arrêt brutal");
      },
    };
    await dispatcher().dispatch([crashing]);
    later(retry.baseDelayMs);
    await dispatcher().dispatch([crashing]);
    expect(seen).toEqual([1, 1]);
  });

  it("computes the retry delays, doubled and capped", () => {
    expect([1, 2, 3, 4, 5].map((attempts) => retryDelay(retry, attempts))).toEqual([
      1000, 2000, 4000, 8000, 8000,
    ]);
  });
});

describe("subscribers of the modules", () => {
  const secretKey = createSecretKey(randomBytes(32));

  function loaded(definition: ModuleDefinition): LoadedModule {
    return {
      definition,
      source: "official",
      manifest: {
        id: definition.id,
        name: definition.name,
        version: definition.version,
        permissions: [],
        dataProcessing: [],
      },
    };
  }

  const calls: string[] = [];
  const compta = defineModule({
    id: "compta",
    name: "Compta",
    version: "1.0.0",
    on: {
      "payment.received": async (event, ctx) => {
        calls.push(`compta:${event.type}@${event.version}:${ctx.module.id}`);
      },
      "payment.received@2": async () => {
        calls.push("compta:v2");
      },
    },
  });
  const newsletter = defineModule({
    id: "newsletter",
    name: "Newsletter",
    version: "1.0.0",
    emits: ["newsletter.subscribed"],
    on: {
      "member.joined": async (event, ctx) => {
        calls.push(`newsletter:${event.type}`);
        await ctx.emit("newsletter.subscribed", { member: event.payload.member ?? null });
      },
    },
  });

  function host(): ModuleHost {
    return new ModuleHost({
      db,
      modules: [loaded(compta), loaded(newsletter)],
      coreBlocks,
      secretKey,
      logger,
    });
  }

  beforeEach(() => {
    calls.length = 0;
  });

  it("delivers to the enabled modules only, every matching handler, with the module's ctx", async () => {
    const modules = host();
    await modules.enable("compta", null);
    expect(moduleSubscribers(modules).map((subscriber) => subscriber.name)).toEqual(["compta"]);
    emit("payment.received", { source: "helloasso", version: 2 });
    emit("member.joined", { payload: { member: 7 } });
    await dispatcher().dispatch(moduleSubscribers(modules));
    expect(calls).toEqual(["compta:payment.received@2:compta", "compta:v2"]);
  });

  it("lets a module emit the events it declares, and refuses the others", async () => {
    const modules = host();
    await modules.enable("newsletter", null);
    emit("member.joined", { payload: { member: 7 } });
    await dispatcher().dispatch(moduleSubscribers(modules));
    expect(calls).toEqual(["newsletter:member.joined"]);
    expect(
      db.select().from(outboxEvents).where(eq(outboxEvents.source, "newsletter")).all(),
    ).toMatchObject([{ type: "newsletter.subscribed", payload: { member: 7 } }]);
    await expect(modules.context("newsletter")?.emit("payment.received", {})).rejects.toThrow(
      "Le module « newsletter » ne déclare pas l'événement « payment.received » (emits)",
    );
  });

  it("starts a module's cursor when it is enabled, and catches up after a pause", async () => {
    const modules = host();
    emit("payment.received");
    await modules.enable("compta", null);
    // The event before the activation is not delivered; module.enabled is written after it.
    await dispatcher().dispatch(moduleSubscribers(modules));
    expect(calls).toEqual([]);

    await modules.disable("compta", null);
    emit("payment.received");
    await dispatcher().dispatch(moduleSubscribers(modules));
    expect(calls).toEqual([]);
    await modules.enable("compta", null);
    await dispatcher().dispatch(moduleSubscribers(modules));
    expect(calls).toEqual(["compta:payment.received@1:compta"]);
  });

  it("emits module.enabled and module.disabled from the core", async () => {
    const modules = host();
    await modules.enable("compta", null);
    await modules.disable("compta", null);
    expect(
      db
        .select({
          type: outboxEvents.type,
          source: outboxEvents.source,
          payload: outboxEvents.payload,
        })
        .from(outboxEvents)
        .all(),
    ).toEqual([
      { type: "module.enabled", source: "core", payload: { module: "compta", version: "1.0.0" } },
      { type: "module.disabled", source: "core", payload: { module: "compta", version: "1.0.0" } },
    ]);
  });
});
