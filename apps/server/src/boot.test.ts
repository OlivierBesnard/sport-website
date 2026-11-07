import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type JsonObject, pages } from "@sport-cms/db";
import { writeModuleFixture } from "@sport-cms/module-loader/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BootedInstance,
  type BootOptions,
  bootInstance,
  MODULES_DIRECTORY,
  StartupError,
} from "./boot.js";

let dataDir: string;
let env: Record<string, string>;
const started: BootedInstance[] = [];
const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() };

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-boot-"));
  env = {
    DATA_DIR: dataDir,
    BASE_URL: "http://localhost:3000",
    // Generated for the test: no secret is written anywhere.
    SECRET_KEY: randomBytes(32).toString("base64"),
  };
  for (const mock of Object.values(logger)) {
    mock.mockReset();
  }
});

afterEach(() => {
  for (const instance of started.splice(0)) {
    if (instance.db.$client.open) {
      instance.close();
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
});

/** Starts the instance of `DATA_DIR`, as the entry point does after a (re)start. */
async function start(options: BootOptions = {}): Promise<BootedInstance> {
  const instance = await bootInstance(env, { logger, adminDirectory: dataDir, ...options });
  started.push(instance);
  return instance;
}

/** Stops the instance, as a restart does. */
function stop(instance: BootedInstance): void {
  instance.close();
}

/** Publishes a page with a block of the installed test module, inside a section. */
function publishBadgePage(instance: BootedInstance): void {
  const data: JsonObject = {
    root: { props: { title: "Badges" } },
    content: [
      {
        type: "Section",
        props: {
          id: "s",
          background: "default",
          content: [
            { type: "badge-test.badge", props: { id: "b", text: "champions 2026" } },
            { type: "Heading", props: { id: "h", text: "Nos équipes", level: 2, align: "left" } },
          ],
        },
      },
    ],
    zones: {},
  };
  instance.db
    .insert(pages)
    .values({
      path: "/badges",
      title: "Badges",
      draftData: data,
      publishedData: data,
      status: "published",
      publishedAt: new Date(),
    })
    .run();
}

async function pageHtml(instance: BootedInstance, path = "/badges"): Promise<string> {
  const response = await instance.app.request(path);
  expect(response.status).toBe(200);
  return response.text();
}

describe("bootInstance", () => {
  it("loads a compiled module copied into DATA_DIR/modules at the next start, and renders its block on a public page", async () => {
    const first = await start();
    publishBadgePage(first);
    expect(await pageHtml(first)).not.toContain("Badge :");
    stop(first);

    // The club copies a compiled module (manifest.json + server.js) into DATA_DIR/modules.
    writeModuleFixture(join(dataDir, MODULES_DIRECTORY), { id: "badge-test", version: "1.0.0" });

    const second = await start();
    expect(second.modules.view("badge-test")).toMatchObject({
      source: "installed",
      status: "available",
      enabled: false,
    });
    expect(await pageHtml(second)).not.toContain("Badge :");
    expect(await second.modules.enable("badge-test", null)).toMatchObject({ ok: true });
    const html = await pageHtml(second);
    expect(html).toContain('<p class="cms-heading">Badge : champions 2026</p>');
    expect(html).toContain("Nos équipes");
    stop(second);

    // Enabled state lives in the database: after another restart the block renders at once.
    const third = await start();
    expect(await pageHtml(third)).toContain("Badge : champions 2026");
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("starts without the modules it refuses, and logs why", async () => {
    const modulesDirectory = join(dataDir, MODULES_DIRECTORY);
    writeModuleFixture(modulesDirectory, { id: "incompatible", cms: "^42.0.0" });
    writeModuleFixture(modulesDirectory, { id: "casse", manifest: { id: "casse" } });
    writeModuleFixture(modulesDirectory, { id: "plante", server: "throw new Error('boum');" });
    writeModuleFixture(modulesDirectory, { id: "valide" });

    const instance = await start();
    expect((await instance.app.request("/health")).status).toBe(200);
    expect(instance.modules.failures().map((failure) => failure.id)).toEqual([
      "casse",
      "incompatible",
      "plante",
    ]);
    expect(instance.modules.view("valide")?.status).toBe("available");
    expect(logger.error).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("Module « incompatible » refusé : Module incompatible"),
    );
  });

  it("includes the official modules, disabled", async () => {
    const instance = await start();
    expect(instance.modules.view("exemple")).toMatchObject({
      source: "official",
      status: "available",
      enabled: false,
    });
    expect(instance.modules.blocks().has("exemple.citation")).toBe(false);
  });

  it("refuses to start without SECRET_KEY, and releases the database", async () => {
    const { SECRET_KEY: _omitted, ...withoutKey } = env;
    env = withoutKey;
    await expect(start()).rejects.toThrow(StartupError);
    await expect(start()).rejects.toThrow(/SECRET_KEY est requise/);
    // The database file is closed: the directory can be removed (Windows locks open files).
    expect(() => rmSync(dataDir, { recursive: true, force: true })).not.toThrow();
  });
});
