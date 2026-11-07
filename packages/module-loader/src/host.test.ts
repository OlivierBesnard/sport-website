import { createSecretKey, randomBytes } from "node:crypto";
import { coreBlocks, defineBlock } from "@sport-cms/blocks";
import {
  auditLog,
  createTestDatabase,
  type Database,
  moduleCredentials,
  moduleKv,
  modules as modulesTable,
} from "@sport-cms/db";
import { defineModule, type ModuleDefinition } from "@sport-cms/module-sdk";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ModuleHost, type ModuleHostOptions } from "./host.js";
import type { LoadedModule } from "./load.js";

let db: Database;
const secretKey = createSecretKey(randomBytes(32));
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  db = createTestDatabase();
  for (const mock of Object.values(logger)) {
    mock.mockReset();
  }
});

afterEach(() => {
  db.$client.close();
});

const noteBlock = defineBlock<{ text: string }>({
  type: "demo.note",
  label: "Note",
  fields: { text: { type: "text" } },
  defaultProps: { text: "" },
  render: ({ text }) => text,
});

const onEnable = vi.fn();
const onDisable = vi.fn();

const demo = defineModule({
  id: "demo",
  name: "Démo",
  version: "1.0.0",
  permissions: ["pages.read"],
  settings: z.object({
    color: z.enum(["rouge", "bleu"]).default("bleu"),
    size: z.number().int().min(1).default(3),
  }),
  credentials: z.object({ token: z.string().min(1, "Le jeton est requis.") }),
  blocks: [noteBlock],
  lifecycle: { onEnable, onDisable },
});

function loaded(
  definition: ModuleDefinition,
  source: LoadedModule["source"] = "official",
): LoadedModule {
  return {
    definition,
    source,
    manifest: {
      id: definition.id,
      name: definition.name,
      version: definition.version,
      permissions: definition.permissions ?? [],
      dataProcessing: definition.dataProcessing ?? [],
    },
  };
}

function host(options: Partial<ModuleHostOptions> = {}): ModuleHost {
  return new ModuleHost({
    db,
    modules: [loaded(demo)],
    coreBlocks,
    secretKey,
    logger,
    ...options,
  });
}

function auditActions(): string[] {
  return db
    .select({ action: auditLog.action })
    .from(auditLog)
    .all()
    .map((row) => row.action);
}

describe("ModuleHost state", () => {
  beforeEach(() => {
    onEnable.mockReset();
    onDisable.mockReset();
  });

  it("gives every loaded module a disabled row, and keeps it across restarts", async () => {
    const first = host();
    expect(db.select().from(modulesTable).all()).toMatchObject([
      { id: "demo", version: "1.0.0", enabled: false, settings: {} },
    ]);
    await first.enable("demo", null);
    const second = host({ modules: [loaded({ ...demo, version: "1.1.0" })] });
    expect(second.isEnabled("demo")).toBe(true);
    expect(db.select().from(modulesTable).get()).toMatchObject({ version: "1.1.0", enabled: true });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1.0.0 remplacée par 1.1.0"));
  });

  it("keeps the row and data of a module absent at this start, as unavailable", async () => {
    await host().enable("demo", null);
    const without = host({
      modules: [],
      failures: [{ id: "demo", source: "installed", reasons: ["Module incompatible."] }],
    });
    expect(without.list()).toMatchObject([
      {
        id: "demo",
        status: "unavailable",
        enabled: true,
        source: null,
        failure: ["Module incompatible."],
      },
    ]);
    expect(without.blocks().has("demo.note")).toBe(false);
    expect(await without.enable("demo", null)).toMatchObject({ ok: false, reason: "unavailable" });
    expect(await without.disable("demo", null)).toMatchObject({
      ok: true,
      module: { enabled: false },
    });
  });

  it("lists the modules with what the back-office needs, never a credential", () => {
    const [view] = host().list();
    expect(view).toMatchObject({
      id: "demo",
      name: "Démo",
      source: "official",
      status: "available",
      enabled: false,
      permissions: ["pages.read"],
      blocks: [{ type: "demo.note", label: "Note" }],
      settings: {},
      credentials: { declared: true, configured: false, fields: ["token"], updatedAt: null },
      failure: null,
    });
    expect(view?.settingsSchema).toMatchObject({
      type: "object",
      properties: { color: { enum: ["rouge", "bleu"], default: "bleu" } },
    });
  });

  it("returns not_found for an unknown module", async () => {
    const modules = host();
    expect(modules.view("inconnu")).toBeUndefined();
    for (const result of [
      await modules.enable("inconnu", null),
      await modules.disable("inconnu", null),
      modules.updateSettings("inconnu", {}, null),
      modules.setCredentials("inconnu", {}, null),
      modules.deleteCredentials("inconnu", null),
    ]) {
      expect(result).toMatchObject({
        ok: false,
        reason: "not_found",
        error: "Module introuvable.",
      });
    }
  });
});

describe("enabling and disabling", () => {
  beforeEach(() => {
    onEnable.mockReset();
    onDisable.mockReset();
  });

  it("adds and removes the module blocks of the registry, a new registry each time", async () => {
    const modules = host();
    const initial = modules.blocks();
    expect(initial.has("demo.note")).toBe(false);
    expect(initial.has("Heading")).toBe(true);
    expect(modules.blocks()).toBe(initial);

    expect(await modules.enable("demo", "owner-1")).toMatchObject({
      ok: true,
      module: { enabled: true },
    });
    const enabled = modules.blocks();
    expect(enabled).not.toBe(initial);
    expect(enabled.get("demo.note")).toBe(noteBlock);
    expect(onEnable).toHaveBeenCalledOnce();

    expect(await modules.disable("demo", "owner-1")).toMatchObject({
      ok: true,
      module: { enabled: false },
    });
    expect(modules.blocks().has("demo.note")).toBe(false);
    expect(onDisable).toHaveBeenCalledOnce();
    expect(auditActions()).toEqual(["modules.enabled", "modules.disabled"]);
    expect(db.select().from(auditLog).all()[0]).toMatchObject({
      actorId: "owner-1",
      targetType: "module",
      targetId: "demo",
      details: { version: "1.0.0", permissions: ["pages.read"] },
    });
  });

  it("does nothing when the module already is in the requested state", async () => {
    const modules = host();
    await modules.disable("demo", null);
    await modules.enable("demo", null);
    await modules.enable("demo", null);
    expect(onEnable).toHaveBeenCalledOnce();
    expect(auditActions()).toEqual(["modules.enabled"]);
  });

  it("keeps the module disabled when onEnable throws", async () => {
    onEnable.mockRejectedValueOnce(new Error("service injoignable"));
    const modules = host();
    expect(await modules.enable("demo", null)).toMatchObject({ ok: false, reason: "failed" });
    expect(modules.isEnabled("demo")).toBe(false);
    expect(auditActions()).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("échec de son activation"),
      expect.any(Error),
    );
  });

  it("disables the module even when onDisable throws", async () => {
    onDisable.mockRejectedValueOnce(new Error("boom"));
    const modules = host();
    await modules.enable("demo", null);
    expect(await modules.disable("demo", null)).toMatchObject({
      ok: true,
      module: { enabled: false },
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("onDisable"),
      expect.any(Error),
    );
  });

  it("refuses to enable a module whose saved settings break its schema", async () => {
    const modules = host();
    db.update(modulesTable)
      .set({ settings: { color: "vert" } })
      .run();
    expect(await modules.enable("demo", null)).toMatchObject({
      ok: false,
      reason: "invalid",
      error: "Complétez les réglages du module avant de l'activer.",
      fields: { color: expect.any(String) },
    });
  });

  it("refuses a second operation while the first one runs", async () => {
    let release: () => void = () => {};
    onEnable.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const modules = host();
    const first = modules.enable("demo", null);
    expect(await modules.enable("demo", null)).toMatchObject({ ok: false, reason: "busy" });
    // Even an operation that would change nothing waits: the state is about to change.
    expect(await modules.disable("demo", null)).toMatchObject({ ok: false, reason: "busy" });
    expect(modules.updateSettings("demo", { color: "rouge" }, null)).toMatchObject({
      ok: false,
      reason: "busy",
    });
    expect(modules.setCredentials("demo", { token: "t" }, null)).toMatchObject({
      ok: false,
      reason: "busy",
    });
    expect(modules.deleteCredentials("demo", null)).toMatchObject({ ok: false, reason: "busy" });
    release();
    expect(await first).toMatchObject({ ok: true });
    expect(auditActions()).toEqual(["modules.enabled"]);
  });
});

describe("settings", () => {
  it("are validated by the module schema and stored with the defaults", () => {
    const modules = host();
    expect(modules.updateSettings("demo", { color: "rouge" }, "owner-1")).toMatchObject({
      ok: true,
      module: { settings: { color: "rouge", size: 3 } },
    });
    expect(db.select().from(modulesTable).get()?.settings).toEqual({ color: "rouge", size: 3 });
    expect(db.select().from(auditLog).get()).toMatchObject({
      action: "modules.settings_updated",
      details: { keys: ["color", "size"] },
    });
  });

  it("are refused with a message per field when invalid", () => {
    const result = host().updateSettings("demo", { color: "vert", size: 0 }, null);
    expect(result).toMatchObject({ ok: false, reason: "invalid", error: "Réglages invalides." });
    expect(result.ok === false && Object.keys(result.fields ?? {}).sort()).toEqual([
      "color",
      "size",
    ]);
    expect(auditActions()).toEqual([]);
  });

  it("are refused with French messages even when the module schema has none (tester)", () => {
    // `size: z.number().int().min(1)` and `color: z.enum(...)` carry no message of their own:
    // what the back-office shows must still be French, not zod's default English.
    const result = host().updateSettings("demo", { color: "vert", size: 0 }, null);
    const messages = Object.values((result.ok === false && result.fields) || {});
    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).not.toMatch(/expected|Invalid|Too small|Too big/);
    }
  });

  it("tell a value of the wrong type from a missing one", () => {
    const wrongType = host().updateSettings("demo", { size: "grand" }, null);
    expect(wrongType.ok === false && wrongType.fields?.size).toBe("Ce champ est invalide.");
    const credentials = host().setCredentials("demo", {}, null);
    expect(credentials.ok === false && credentials.fields?.token).toBe("Ce champ est requis.");
  });

  it("are refused for a module without settings", () => {
    const bare = defineModule({ id: "nu", name: "Nu", version: "1.0.0" });
    expect(host({ modules: [loaded(bare)] }).updateSettings("nu", {}, null)).toMatchObject({
      ok: false,
      reason: "invalid",
      error: "Ce module n'a pas de réglages.",
    });
  });
});

describe("credentials", () => {
  it("are validated, stored encrypted and never shown, only their state", async () => {
    const modules = host();
    const result = modules.setCredentials("demo", { token: "jeton-très-secret" }, "owner-1");
    expect(result).toMatchObject({
      ok: true,
      module: { credentials: { configured: true, updatedAt: expect.any(Number) } },
    });
    expect(JSON.stringify(result)).not.toContain("jeton-très-secret");
    const stored = db.select().from(moduleCredentials).get();
    expect(stored?.encryptedValue).toMatch(/^v1:/);
    expect(stored?.encryptedValue).not.toContain("jeton");
    expect(await modules.context("demo")?.credentials()).toEqual({ token: "jeton-très-secret" });
    expect(db.select().from(auditLog).get()).toMatchObject({
      action: "modules.credentials_updated",
      details: { fields: ["token"] },
    });
    expect(JSON.stringify(db.select().from(auditLog).all())).not.toContain("jeton");
  });

  it("replace the previous ones, and can be deleted", async () => {
    const modules = host();
    modules.setCredentials("demo", { token: "un" }, null);
    modules.setCredentials("demo", { token: "deux" }, null);
    expect(await db.$count(moduleCredentials)).toBe(1);
    expect(await modules.context("demo")?.credentials()).toEqual({ token: "deux" });
    expect(modules.deleteCredentials("demo", null)).toMatchObject({
      ok: true,
      module: { credentials: { configured: false } },
    });
    expect(await modules.context("demo")?.credentials()).toBeUndefined();
    modules.deleteCredentials("demo", null);
    expect(auditActions()).toEqual([
      "modules.credentials_updated",
      "modules.credentials_updated",
      "modules.credentials_deleted",
    ]);
  });

  it("are refused when invalid, with French messages", () => {
    expect(host().setCredentials("demo", { token: "" }, null)).toMatchObject({
      ok: false,
      reason: "invalid",
      fields: { token: "Le jeton est requis." },
    });
    expect(db.select().from(moduleCredentials).all()).toEqual([]);
  });

  it("are checked again by the module schema when the module reads them", async () => {
    const modules = host();
    modules.setCredentials("demo", { token: "x" }, null);
    // A newer version of the module requires another field: the saved value no longer fits.
    const stricter = host({
      modules: [
        loaded({ ...demo, credentials: z.object({ token: z.string(), secret: z.string() }) }),
      ],
    });
    await expect(stricter.context("demo")?.credentials()).rejects.toThrow(
      "Les identifiants du module « demo » ne respectent plus son schéma",
    );
    // Parsed by the schema: what the module gets is the schema's output.
    const trimming = host({
      modules: [loaded({ ...demo, credentials: z.object({ token: z.string().toUpperCase() }) })],
    });
    expect(await trimming.context("demo")?.credentials()).toEqual({ token: "X" });
  });

  it("cannot be read back with another SECRET_KEY", async () => {
    host().setCredentials("demo", { token: "x" }, null);
    const other = host({ secretKey: createSecretKey(randomBytes(32)) });
    await expect(other.context("demo")?.credentials()).rejects.toThrow(/déchiffrés/);
  });
});

describe("module context", () => {
  it("is scoped to the module: settings, key-value data and logger", async () => {
    const other = defineModule({ id: "autre", name: "Autre", version: "1.0.0" });
    const modules = host({ modules: [loaded(demo), loaded(other)] });
    const ctx = modules.context("demo");
    expect(ctx?.module).toEqual({ id: "demo", version: "1.0.0" });
    expect(await ctx?.settings()).toEqual({ color: "bleu", size: 3 });

    await ctx?.kv.set("curseur", { page: 2 });
    await ctx?.kv.set("curseur", { page: 3 });
    expect(await ctx?.kv.get("curseur")).toEqual({ page: 3 });
    expect(await modules.context("autre")?.kv.get("curseur")).toBeUndefined();
    expect(await ctx?.kv.delete("curseur")).toBe(true);
    expect(await ctx?.kv.delete("curseur")).toBe(false);
    expect(db.select().from(moduleKv).where(eq(moduleKv.moduleId, "demo")).all()).toEqual([]);

    ctx?.logger.error("échec", 42);
    expect(logger.error).toHaveBeenCalledWith("[module demo] échec", 42);
    expect(modules.context("inconnu")).toBeUndefined();
  });
});
