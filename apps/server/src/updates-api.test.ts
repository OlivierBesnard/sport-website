import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { auditLog, type Database } from "@sport-cms/db";
import { asc } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "./api-testing.js";

let harness: ApiHarness;
let db: Database;
let app: ReturnType<ApiHarness["app"]>;
let ownerCookie: string;
let editorCookie: string;

const supervisorState = {
  current: "1.1.0",
  previous: "1.0.0",
  environment: 1,
  bucket: 42,
  failed: [],
  available: null,
  environmentOutdated: null,
  pending: null,
  history: [{ from: "1.0.0", to: "1.1.0", at: 1, outcome: "installed" }],
  lastCheckAt: 1,
  lastError: null,
};

beforeEach(async () => {
  harness = createApiHarness();
  app = harness.app();
  db = harness.db;
  const owner = await harness.createUser("owner");
  const editor = await harness.createUser("editor");
  ownerCookie = await harness.signIn(owner.email, "mot-de-passe-2026");
  editorCookie = await harness.signIn(editor.email, "mot-de-passe-2026");
});

afterEach(() => {
  db.$client.close();
  rmSync(harness.dataDir, { recursive: true, force: true });
});

async function call(
  method: "GET" | "POST" | "PUT",
  path: string,
  body?: unknown,
  cookie = ownerCookie,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await app.request(path, {
    method,
    headers: {
      cookie,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function updatesFile(name: string): string {
  return join(harness.dataDir, "updates", name);
}

function writeState(state: unknown): void {
  mkdirSync(join(harness.dataDir, "updates"), { recursive: true });
  writeFileSync(updatesFile("state.json"), JSON.stringify(state));
}

const settings = {
  policy: "automatic-minor",
  channel: "beta",
  window: { start: "23:30", end: "01:00" },
  pausedUntil: null,
};

describe("updates API", () => {
  it("is reserved to settings.manage", async () => {
    expect((await call("GET", "/api/updates", undefined, editorCookie)).status).toBe(403);
    expect((await call("PUT", "/api/updates/settings", settings, editorCookie)).status).toBe(403);
  });

  it("gives the defaults and no state without a supervisor", async () => {
    const { status, body } = await call("GET", "/api/updates");
    expect(status).toBe(200);
    expect(body).toMatchObject({
      settings: {
        policy: "automatic",
        channel: "stable",
        window: { start: "03:00", end: "05:00" },
        pausedUntil: null,
      },
      state: null,
      request: null,
    });
    expect(body.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("writes the settings for the supervisor, and audits them", async () => {
    const saved = await call("PUT", "/api/updates/settings", settings);
    expect(saved.status).toBe(200);
    expect(JSON.parse(readFileSync(updatesFile("settings.json"), "utf8"))).toEqual(settings);
    expect((await call("GET", "/api/updates")).body.settings).toEqual(settings);
    const audit = db.select().from(auditLog).orderBy(asc(auditLog.id)).all();
    expect(audit.at(-1)).toMatchObject({
      action: "updates.settings_updated",
      details: { policy: "automatic-minor", channel: "beta", window: "23:30-01:00" },
    });
  });

  it("refuses invalid settings and pauses beyond 14 days, in French", async () => {
    const invalid = await call("PUT", "/api/updates/settings", {
      ...settings,
      policy: "jamais",
      window: { start: "25:00", end: "01:00" },
    });
    expect(invalid.status).toBe(400);
    expect(invalid.body.fields).toMatchObject({
      "window.start": "Heure attendue au format HH:MM.",
    });
    expect(Object.keys(invalid.body.fields as object)).toContain("policy");

    const tooLong = await call("PUT", "/api/updates/settings", {
      ...settings,
      pausedUntil: Date.now() + 15 * 24 * 60 * 60 * 1000,
    });
    expect(tooLong.status).toBe(400);
    expect(tooLong.body.fields).toEqual({ pausedUntil: "La pause ne peut pas dépasser 14 jours." });

    const over = await call("PUT", "/api/updates/settings", { ...settings, pausedUntil: 1000 });
    expect((over.body.settings as { pausedUntil: unknown }).pausedUntil).toBeNull();
  });

  it("reads what the supervisor wrote", async () => {
    writeState(supervisorState);
    expect((await call("GET", "/api/updates")).body.state).toEqual(supervisorState);
  });

  it("passes requests to the supervisor", async () => {
    expect((await call("POST", "/api/updates/request", { action: "update" })).status).toBe(409);

    writeState(supervisorState);
    const update = await call("POST", "/api/updates/request", { action: "update" });
    expect(update.status).toBe(202);
    expect(JSON.parse(readFileSync(updatesFile("request.json"), "utf8"))).toMatchObject({
      action: "update",
    });
    expect((await call("GET", "/api/updates")).body.request).toMatchObject({ action: "update" });

    expect((await call("POST", "/api/updates/request", { action: "reinstall" })).status).toBe(400);
    writeState({ ...supervisorState, previous: null });
    const rollback = await call("POST", "/api/updates/request", { action: "rollback" });
    expect(rollback.status).toBe(409);
    expect(rollback.body.error).toBe("Aucune version précédente n'est disponible.");
  });
});
