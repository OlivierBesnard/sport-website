import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixtureClientSource, writeModuleFixture } from "@sport-cms/module-loader/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ADMIN_CONTENT_SECURITY_POLICY } from "./admin.js";
import { setupBody } from "./auth/testing.js";
import { type BootedInstance, bootInstance, MODULES_DIRECTORY } from "./boot.js";
import { officialClientFiles } from "./module-clients.js";

const BASE_URL = "http://localhost:3000";
let dataDir: string;
let modulesDirectory: string;
let instance: BootedInstance | undefined;
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-clients-"));
  modulesDirectory = join(dataDir, MODULES_DIRECTORY);
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
    { logger, adminDirectory: dataDir, officialModules: [] },
  );
  return instance;
}

/** Installs the owner and returns the session cookie. */
async function owner(booted: BootedInstance): Promise<string> {
  const response = await booted.app.request("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE_URL },
    body: JSON.stringify(setupBody()),
  });
  expect(response.status).toBe(201);
  const cookie = response.headers.get("set-cookie") ?? "";
  return cookie.split(";")[0] ?? "";
}

function get(booted: BootedInstance, path: string, cookie?: string): Promise<Response> {
  return Promise.resolve(
    booted.app.request(path, cookie === undefined ? {} : { headers: { cookie } }),
  );
}

const ENTRY = "/admin/_modules/badge-test/1.0.0/client.js";

describe("GET /api/client-modules", () => {
  it("requires a session", async () => {
    const booted = await start();
    expect((await get(booted, "/api/client-modules")).status).toBe(401);
  });

  it("lists the enabled modules only, with their block types and client entry", async () => {
    writeModuleFixture(modulesDirectory, { client: fixtureClientSource("badge-test") });
    writeModuleFixture(modulesDirectory, { id: "sans-client" });
    const booted = await start();
    const cookie = await owner(booted);
    expect(await (await get(booted, "/api/client-modules", cookie)).json()).toEqual({
      modules: [],
    });

    await booted.modules.enable("badge-test", null);
    await booted.modules.enable("sans-client", null);
    expect(await (await get(booted, "/api/client-modules", cookie)).json()).toEqual({
      modules: [
        {
          id: "badge-test",
          name: "Module de test",
          version: "1.0.0",
          blocks: ["badge-test.badge"],
          client: ENTRY,
        },
        {
          id: "sans-client",
          name: "Module de test",
          version: "1.0.0",
          blocks: ["sans-client.badge"],
          client: null,
        },
      ],
    });
  });
});

describe("GET /admin/_modules/:id/:version/*", () => {
  async function enabledInstance(): Promise<{ booted: BootedInstance; cookie: string }> {
    const directory = writeModuleFixture(modulesDirectory, {
      client: fixtureClientSource("badge-test"),
    });
    mkdirSync(join(directory, "parts"));
    writeFileSync(join(directory, "parts", "badge.js"), "export const badge = 1;\n");
    writeFileSync(join(directory, "notes.txt"), "secret");
    const booted = await start();
    const cookie = await owner(booted);
    await booted.modules.enable("badge-test", null);
    return { booted, cookie };
  }

  it("serves the client entry of an enabled module as JavaScript, revalidated", async () => {
    const { booted, cookie } = await enabledInstance();
    const response = await get(booted, ENTRY, cookie);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
    expect(response.headers.get("cache-control")).toBe("no-cache");
    expect(response.headers.get("content-security-policy")).toBe(ADMIN_CONTENT_SECURITY_POLICY);
    expect(await response.text()).toBe(fixtureClientSource("badge-test"));
  });

  it("serves the files the entry imports relatively, under the same prefix", async () => {
    const { booted, cookie } = await enabledInstance();
    const response = await get(booted, "/admin/_modules/badge-test/1.0.0/parts/badge.js", cookie);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("export const badge");
  });

  it("requires a session", async () => {
    const { booted } = await enabledInstance();
    expect((await get(booted, ENTRY)).status).toBe(401);
  });

  it("refuses a disabled module, another version, or an unknown module", async () => {
    const { booted, cookie } = await enabledInstance();
    expect((await get(booted, "/admin/_modules/badge-test/0.9.0/client.js", cookie)).status).toBe(
      404,
    );
    expect((await get(booted, "/admin/_modules/inconnu/1.0.0/client.js", cookie)).status).toBe(404);
    await booted.modules.disable("badge-test", null);
    expect((await get(booted, ENTRY, cookie)).status).toBe(404);
  });

  it("serves JavaScript files only, never leaving the module's directory", async () => {
    const { booted, cookie } = await enabledInstance();
    writeFileSync(join(modulesDirectory, "outside.js"), "export const leaked = true;\n");
    for (const path of [
      "/admin/_modules/badge-test/1.0.0/notes.txt",
      "/admin/_modules/badge-test/1.0.0/manifest.json",
      "/admin/_modules/badge-test/1.0.0/../outside.js",
      "/admin/_modules/badge-test/1.0.0/%2e%2e/outside.js",
      "/admin/_modules/badge-test/1.0.0/..%2Foutside.js",
      "/admin/_modules/badge-test/1.0.0/..%5Coutside.js",
      "/admin/_modules/badge-test/1.0.0/client.js%00",
      "/admin/_modules/badge-test/1.0.0/client.js.",
      "/admin/_modules/badge-test/1.0.0/parts",
      "/admin/_modules/badge-test/1.0.0/absent.js",
      "/admin/_modules/badge-test/1.0.0/%E0%A4%A.js",
    ]) {
      const response = await get(booted, path, cookie);
      expect(response.status, path).toBe(404);
      expect(await response.text(), path).not.toContain("leaked");
    }
  });

  it("refuses a link that leads out of the module's directory", async () => {
    const { booted, cookie } = await enabledInstance();
    const outside = join(dataDir, "outside.js");
    writeFileSync(outside, "export const leaked = true;\n");
    try {
      symlinkSync(outside, join(modulesDirectory, "badge-test", "lien.js"), "file");
    } catch {
      // Creating a symbolic link needs a privilege on Windows: nothing to check without one.
      return;
    }
    const response = await get(booted, "/admin/_modules/badge-test/1.0.0/lien.js", cookie);
    expect(response.status).toBe(404);
  });
});

describe("officialClientFiles", () => {
  it("points to the dist directory of the package", () => {
    const files = officialClientFiles("@sport-cms/module-exemple");
    expect(files.entry).toBe("client.js");
    expect(files.directory.replaceAll("\\", "/")).toMatch(/modules\/exemple\/dist$/);
  });
});
