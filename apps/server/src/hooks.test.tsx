import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { auditLog, inboundWebhooks, type JsonObject, pages } from "@sport-cms/db";
import { defineBlock, defineModule, type WebhookRequest } from "@sport-cms/module-sdk";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupBody } from "./auth/testing.js";
import { type BootedInstance, bootInstance } from "./boot.js";
import { hooksRoutes, MAX_WEBHOOK_BODY_BYTES } from "./hooks.js";

const BASE_URL = "http://localhost:3000";
let dataDir: string;
let instance: BootedInstance | undefined;
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

const received: WebhookRequest[] = [];
const control = { fail: 0 };

const scoreBlock = defineBlock<{ team: string }>({
  type: "club.score",
  label: "Score",
  fields: { team: { type: "text", label: "Équipe" } },
  defaultProps: { team: "" },
  dependsOn: ["club.score_updated"],
  render: ({ team }) => <p className="cms-heading">Score de {team}</p>,
});

/** A module with a webhook, a block depending on its own event, and that event. */
const club = defineModule({
  id: "club",
  name: "Club",
  version: "1.0.0",
  emits: ["club.score_updated"],
  blocks: [scoreBlock],
  webhooks: {
    notifications: async (request, ctx) => {
      if (control.fail > 0) {
        control.fail -= 1;
        throw new Error("signature invalide");
      }
      received.push(request);
      await ctx.emit(
        "club.score_updated",
        { score: "3-1" },
        { idempotencyKey: `wh-${request.id}` },
      );
    },
  },
});

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-hooks-"));
  received.length = 0;
  control.fail = 0;
  logger.error.mockReset();
});

afterEach(() => {
  instance?.close();
  instance = undefined;
  rmSync(dataDir, { recursive: true, force: true });
});

async function start(): Promise<BootedInstance> {
  instance = await bootInstance(
    {
      DATA_DIR: dataDir,
      BASE_URL,
      // Generated for the test: no secret is written anywhere.
      SECRET_KEY: randomBytes(32).toString("base64"),
    },
    { logger, adminDirectory: dataDir, officialModules: [club] },
  );
  return instance;
}

async function owner(booted: BootedInstance): Promise<string> {
  const response = await booted.app.request("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify(setupBody()),
  });
  expect(response.status).toBe(201);
  return (response.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
}

function hook(booted: BootedInstance, path: string, body = '{"order":42}', headers = {}) {
  return booted.app.request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "session=ne-doit-pas-etre-garde",
      "x-signature": "sig-123",
      ...headers,
    },
    body,
  });
}

describe("POST /hooks/:module/:name", () => {
  it("answers 404 while the module is disabled, or for an unknown webhook", async () => {
    const booted = await start();
    expect((await hook(booted, "/hooks/club/notifications")).status).toBe(404);
    await booted.modules.enable("club", null);
    expect((await hook(booted, "/hooks/club/inconnu")).status).toBe(404);
    expect((await hook(booted, "/hooks/autre/notifications")).status).toBe(404);
    expect((await hook(booted, "/hooks/Club/notifications")).status).toBe(404);
    expect((await booted.app.request("/hooks/club/notifications")).status).toBe(404);
    expect(booted.db.select().from(inboundWebhooks).all()).toEqual([]);
  });

  it("stores the request raw and answers 200 at once; the module processes it afterwards", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    const response = await hook(booted, "/hooks/club/notifications");
    expect(response.status).toBe(200);
    const { id } = (await response.json()) as { id: number };
    expect(received).toEqual([]);
    const stored = booted.db.select().from(inboundWebhooks).get();
    expect(stored).toMatchObject({
      id,
      moduleId: "club",
      name: "notifications",
      status: "pending",
    });
    expect(Buffer.from(stored?.body ?? []).toString()).toBe('{"order":42}');
    expect(stored?.headers["x-signature"]).toBe("sig-123");
    expect(stored?.headers).not.toHaveProperty("cookie");

    await booted.runtime.tick();
    expect(received.map((request) => request.json())).toEqual([{ order: 42 }]);
    expect(booted.db.select().from(inboundWebhooks).get()).toMatchObject({ status: "processed" });
  });

  it("limits the rate per client address, in French", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    const app = new Hono();
    hooksRoutes({
      db: booted.db,
      modules: booted.modules,
      logger,
      limit: { windowMs: 60_000, max: 2 },
    })(app);
    const post = () => app.request("/hooks/club/notifications", { method: "POST", body: "{}" });
    expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(200);
    const refused = await post();
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
  });

  it("refuses a body over the limit", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    const response = await hook(
      booted,
      "/hooks/club/notifications",
      "x".repeat(MAX_WEBHOOK_BODY_BYTES + 1),
    );
    expect(response.status).toBe(413);
    expect(((await response.json()) as { error: string }).error).toContain("trop volumineux");
  });
});

describe("admin API of the webhooks", () => {
  it("lists the webhooks without their content, for modules.manage only", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    expect((await booted.app.request("/api/webhooks")).status).toBe(401);
    const cookie = await owner(booted);
    await hook(booted, "/hooks/club/notifications");
    const response = await booted.app.request("/api/webhooks", { headers: { cookie } });
    expect(response.status).toBe(200);
    const { webhooks } = (await response.json()) as { webhooks: Record<string, unknown>[] };
    expect(webhooks).toMatchObject([
      { module: "club", name: "notifications", status: "pending", attempts: 0, size: 12 },
    ]);
    expect(webhooks[0]).not.toHaveProperty("body");
    expect(webhooks[0]).not.toHaveProperty("headers");
    expect(
      (await booted.app.request("/api/webhooks?status=perdu", { headers: { cookie } })).status,
    ).toBe(400);
  });

  it("replays a webhook that failed: processed again, audited", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    const cookie = await owner(booted);
    const { id } = (await (await hook(booted, "/hooks/club/notifications")).json()) as {
      id: number;
    };
    control.fail = 1;
    await booted.runtime.tick();
    expect(received).toEqual([]);
    const replay = await booted.app.request(`/api/webhooks/${id}/replay`, {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ webhook: { id, status: "pending" } });
    await booted.runtime.tick();
    expect(received.map((request) => [request.id, request.attempt])).toEqual([[id, 2]]);
    expect(
      booted.db.select().from(auditLog).where(eq(auditLog.action, "webhooks.replayed")).all(),
    ).toHaveLength(1);
    const unknown = await booted.app.request("/api/webhooks/999/replay", {
      method: "POST",
      headers: { cookie, origin: BASE_URL },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("cache invalidated by events", () => {
  function publishPage(booted: BootedInstance, path: string, withScore: boolean): void {
    const data: JsonObject = {
      root: { props: { title: path } },
      content: [
        {
          type: "Section",
          props: {
            id: "s",
            background: "default",
            content: withScore
              ? [{ type: "club.score", props: { id: "b", team: "U13" } }]
              : [{ type: "Heading", props: { id: "h", text: "Contact", level: 2, align: "left" } }],
          },
        },
      ],
      zones: {},
    };
    booted.db
      .insert(pages)
      .values({
        path,
        title: path,
        draftData: data,
        publishedData: data,
        status: "published",
        publishedAt: new Date(),
      })
      .run();
  }

  it("forgets the pages whose blocks depend on the event, and only them", async () => {
    const booted = await start();
    await booted.modules.enable("club", null);
    publishPage(booted, "/resultats", true);
    publishPage(booted, "/contact", false);
    await booted.runtime.tick();
    expect(await (await booted.app.request("/resultats")).text()).toContain("Score de U13");
    await booted.app.request("/contact");
    expect(booted.htmlCache.get("/resultats")).toBeDefined();
    expect(booted.htmlCache.get("/contact")).toBeDefined();

    // The webhook makes the module emit `club.score_updated`; the next round delivers it.
    await hook(booted, "/hooks/club/notifications");
    await booted.runtime.tick();
    await booted.runtime.tick();
    expect(booted.htmlCache.get("/resultats")).toBeUndefined();
    expect(booted.htmlCache.get("/contact")).toBeDefined();
  });
});
