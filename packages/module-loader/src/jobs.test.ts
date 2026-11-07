import { createSecretKey, randomBytes } from "node:crypto";
import { coreBlocks } from "@sport-cms/blocks";
import { auditLog, createTestDatabase, type Database, inboundWebhooks, jobs } from "@sport-cms/db";
import {
  defineModule,
  type JobRun,
  type ModuleDefinition,
  type WebhookRequest,
} from "@sport-cms/module-sdk";
import { asc, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ModuleHost } from "./host.js";
import { JobScheduler, receiveWebhook, replayWebhook, storableHeaders, tickKey } from "./jobs.js";
import type { LoadedModule } from "./load.js";
import { ModuleRuntime } from "./runtime.js";

let db: Database;
let clock: Date;
const secretKey = createSecretKey(randomBytes(32));
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };
const retry = { baseDelayMs: 1000, maxDelayMs: 8000, maxAttempts: 3 };

/** Local time, as cron reads it. */
function at(hours: number, minutes = 0, day = 7): Date {
  return new Date(2026, 10, day, hours, minutes);
}

beforeEach(() => {
  db = createTestDatabase();
  clock = at(10, 5);
  for (const mock of Object.values(logger)) {
    mock.mockReset();
  }
});

afterEach(() => {
  db.$client.close();
});

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

const runs: JobRun[] = [];
const received: WebhookRequest[] = [];
const control = { jobFailures: 0, webhookFailures: 0 };

const sync = defineModule({
  id: "sync",
  name: "Synchro",
  version: "1.0.0",
  jobs: [
    {
      id: "commandes",
      schedule: "*/30 * * * *",
      run: async (_ctx, run) => {
        if (control.jobFailures > 0) {
          control.jobFailures -= 1;
          throw new Error("service indisponible");
        }
        runs.push(run);
      },
    },
  ],
  webhooks: {
    notifications: async (request) => {
      if (control.webhookFailures > 0) {
        control.webhookFailures -= 1;
        throw new Error("signature invalide");
      }
      received.push(request);
    },
  },
});

function host(): ModuleHost {
  return new ModuleHost({ db, modules: [loaded(sync)], coreBlocks, secretKey, logger });
}

function scheduler(modules: ModuleHost): JobScheduler {
  return new JobScheduler({ db, host: modules, logger, now: () => clock, retry });
}

function rows() {
  return db.select().from(jobs).orderBy(asc(jobs.id)).all();
}

beforeEach(() => {
  runs.length = 0;
  received.length = 0;
  control.jobFailures = 0;
  control.webhookFailures = 0;
});

describe("scheduled jobs", () => {
  it("plans one row per tick, never twice, and runs it once", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const jobsOf = scheduler(modules);
    jobsOf.plan();
    // Seen for the first time: it waits for its next tick (10:30).
    expect(rows()).toEqual([]);

    clock = at(10, 30);
    jobsOf.plan();
    jobsOf.plan();
    // Another scheduler (a restart) plans the same tick: still one row.
    scheduler(modules).plan();
    expect(rows().map((row) => row.uniqueKey)).toEqual([tickKey("sync", "commandes", at(10, 30))]);

    expect(await jobsOf.runDue()).toBe(1);
    expect(await jobsOf.runDue()).toBe(0);
    expect(runs).toEqual([{ scheduledAt: at(10, 30), attempt: 1 }]);
    expect(rows()[0]).toMatchObject({ status: "succeeded", attempts: 1, lockedUntil: null });
  });

  it("catches up the first tick missed while the server was stopped, once", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const before = scheduler(modules);
    before.plan();
    clock = at(10, 30);
    before.plan();
    await before.runDue();

    // Stopped from 10:31 to 12:10: 11:00, 11:30 and 12:00 were missed.
    clock = at(12, 10);
    const after = scheduler(modules);
    after.plan();
    await after.runDue();
    expect(runs.map((run) => run.scheduledAt)).toEqual([at(10, 30), at(11, 0)]);
    clock = at(12, 30);
    after.plan();
    await after.runDue();
    expect(runs.map((run) => run.scheduledAt)).toEqual([at(10, 30), at(11, 0), at(12, 30)]);
  });

  it("retries a failing job with a growing delay, then marks it failed", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const jobsOf = scheduler(modules);
    jobsOf.plan();
    clock = at(10, 30);
    jobsOf.plan();
    control.jobFailures = 3;

    await jobsOf.runDue();
    expect(rows()[0]).toMatchObject({
      status: "pending",
      attempts: 1,
      lastError: "service indisponible",
      runAt: new Date(at(10, 30).getTime() + 1000),
    });
    expect(await jobsOf.runDue()).toBe(0);
    clock = new Date(clock.getTime() + 1000);
    await jobsOf.runDue();
    expect(rows()[0]).toMatchObject({ status: "pending", attempts: 2 });
    clock = new Date(clock.getTime() + 2000);
    await jobsOf.runDue();
    expect(rows()[0]).toMatchObject({ status: "failed", attempts: 3 });
    expect(runs).toEqual([]);
  });

  it("takes again a job whose lease expired (the server stopped during its run)", async () => {
    const modules = host();
    await modules.enable("sync", null);
    clock = at(10, 30);
    const jobsOf = scheduler(modules);
    jobsOf.plan();
    db.insert(jobs)
      .values({
        moduleId: "sync",
        name: "commandes",
        uniqueKey: tickKey("sync", "commandes", at(10, 0)),
        runAt: at(10, 0),
        status: "running",
        attempts: 1,
        lockedUntil: at(10, 20),
      })
      .run();
    await jobsOf.runDue();
    expect(runs.map((run) => [run.scheduledAt, run.attempt])).toEqual([[at(10, 0), 2]]);
  });

  it("waits while the module is disabled", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const jobsOf = scheduler(modules);
    jobsOf.plan();
    clock = at(10, 30);
    jobsOf.plan();
    await modules.disable("sync", null);
    expect(await jobsOf.runDue()).toBe(0);
    await modules.enable("sync", null);
    expect(await jobsOf.runDue()).toBe(1);
  });
});

describe("webhooks", () => {
  function request(body = '{"order":42}') {
    return {
      moduleId: "sync",
      name: "notifications",
      headers: { "content-type": "application/json", "x-signature": "abc" },
      body: new TextEncoder().encode(body),
    };
  }

  it("stores the request raw, then hands it to the module's handler", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const id = receiveWebhook(db, request(), clock);
    expect(received).toEqual([]);
    await scheduler(modules).runDue();
    expect(received).toHaveLength(1);
    const [webhook] = received;
    expect(webhook?.id).toBe(id);
    expect(webhook?.headers).toEqual({ "content-type": "application/json", "x-signature": "abc" });
    expect(webhook?.json()).toEqual({ order: 42 });
    expect(webhook?.text()).toBe('{"order":42}');
    expect(webhook?.attempt).toBe(1);
    expect(db.select().from(inboundWebhooks).get()).toMatchObject({
      status: "processed",
      attempts: 1,
      lastError: null,
    });
  });

  it("retries a failing webhook, and marks it failed after the last attempt", async () => {
    const modules = host();
    await modules.enable("sync", null);
    receiveWebhook(db, request(), clock);
    control.webhookFailures = 3;
    const jobsOf = scheduler(modules);
    for (let round = 0; round < 3; round += 1) {
      await jobsOf.runDue();
      clock = new Date(clock.getTime() + retry.maxDelayMs);
    }
    expect(db.select().from(inboundWebhooks).get()).toMatchObject({
      status: "failed",
      attempts: 3,
      lastError: "signature invalide",
    });
  });

  it("is replayed from the back-office: processed again, audited", async () => {
    const modules = host();
    await modules.enable("sync", null);
    const id = receiveWebhook(db, request(), clock);
    control.webhookFailures = 3;
    const jobsOf = scheduler(modules);
    for (let round = 0; round < 3; round += 1) {
      await jobsOf.runDue();
      clock = new Date(clock.getTime() + retry.maxDelayMs);
    }
    expect(replayWebhook(db, id, "owner-1", clock)).toBe(true);
    expect(db.select().from(inboundWebhooks).get()).toMatchObject({ status: "pending" });
    await jobsOf.runDue();
    expect(received.map((webhook) => [webhook.id, webhook.attempt])).toEqual([[id, 4]]);
    expect(db.select().from(inboundWebhooks).get()).toMatchObject({ status: "processed" });
    expect(
      db.select().from(auditLog).where(eq(auditLog.action, "webhooks.replayed")).all(),
    ).toMatchObject([
      {
        actorId: "owner-1",
        targetId: String(id),
        details: { module: "sync", name: "notifications" },
      },
    ]);
    expect(replayWebhook(db, 999, null)).toBe(false);
  });

  it("stores the headers in lowercase, without cookies nor authorization", () => {
    expect(
      storableHeaders(
        new Headers({
          "Content-Type": "application/json",
          Cookie: "session=secret",
          Authorization: "Bearer x",
          "X-HelloAsso-Signature": "sig",
        }),
      ),
    ).toEqual({ "content-type": "application/json", "x-helloasso-signature": "sig" });
  });
});

describe("ModuleRuntime", () => {
  it("delivers events, plans and runs jobs in one round, and stops cleanly", async () => {
    const delivered: string[] = [];
    const modules = host();
    await modules.enable("sync", null);
    receiveWebhook(
      db,
      {
        moduleId: "sync",
        name: "notifications",
        headers: {},
        body: new Uint8Array(),
      },
      clock,
    );
    const runtime = new ModuleRuntime({
      db,
      host: modules,
      logger,
      now: () => clock,
      coreSubscribers: [
        {
          name: "core:test",
          accepts: () => true,
          handle: async (event) => {
            delivered.push(event.type);
          },
        },
      ],
    });
    await runtime.tick();
    expect(received).toHaveLength(1);
    runtime.start();
    await modules.disable("sync", null);
    await runtime.stop();
    await runtime.tick();
    expect(delivered).toContain("module.disabled");
  });
});
