import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { coreBlocks, defineBlock } from "@sport-cms/blocks";
import { defineModule } from "@sport-cms/module-sdk";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkEngines, loadModules } from "./load.js";
import { resolveSharedDependency } from "./shared-dependencies.js";
import { writeModuleFixture } from "./testing.js";

let dataDir: string;
let modulesDirectory: string;
const logger = { error: vi.fn() };
const reservedBlockTypes = coreBlocks.map((block) => block.type);

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), "sport-cms-loader-"));
  modulesDirectory = join(dataDir, "modules");
  logger.error.mockReset();
});

afterEach(() => {
  rmSync(dataDir, { recursive: true, force: true });
});

const demoBlock = defineBlock<{ text: string }>({
  type: "demo.note",
  label: "Note",
  fields: { text: { type: "text" } },
  defaultProps: { text: "" },
  render: ({ text }) => text,
});

const demo = defineModule({ id: "demo", name: "Démo", version: "1.0.0", blocks: [demoBlock] });

function load(options: Parameters<typeof loadModules>[0] = {}) {
  return loadModules({ modulesDirectory, reservedBlockTypes, logger, ...options });
}

describe("checkEngines", () => {
  it("accepts a version in the range, prereleases included", () => {
    expect(checkEngines("^0.1.0", "0.1.4")).toBeUndefined();
    expect(checkEngines(">=1.0.0 <3.0.0", "2.0.0-beta.1")).toBeUndefined();
  });

  it("refuses a version outside the range, or an invalid range", () => {
    expect(checkEngines("^2.0.0", "0.1.0")).toContain("Module incompatible");
    expect(checkEngines("pas une plage", "0.1.0")).toContain("est invalide");
  });
});

describe("official modules", () => {
  it("are loaded with their manifest, defaults filled in", async () => {
    const { modules, failures } = await load({ official: [demo] });
    expect(failures).toEqual([]);
    expect(modules).toHaveLength(1);
    expect(modules[0]).toMatchObject({
      source: "official",
      manifest: { id: "demo", version: "1.0.0", permissions: [], dataProcessing: [] },
    });
    expect(modules[0]?.definition).toBe(demo);
  });

  it("are refused when invalid, incompatible, or clashing, and the others still load", async () => {
    const { modules, failures } = await load({
      official: [
        { id: "Cassé" },
        { ...demo, id: "vieux", blocks: [], engines: { cms: "^9.0.0" } },
        demo,
        { ...demo, name: "Doublon" },
        { ...demo, id: "pirate", blocks: [{ ...demoBlock, type: "pirate.Heading" }] },
        defineModule({
          id: "voleur",
          name: "Voleur",
          version: "1.0.0",
          blocks: [{ ...demoBlock, type: "voleur.note" }, { ...demoBlock }],
        }),
      ],
    });
    expect(modules.map((module) => module.manifest.id)).toEqual(["demo", "pirate"]);
    expect(failures.map((failure) => failure.id)).toEqual(["Cassé", "vieux", "demo", "voleur"]);
    expect(failures[1]?.reasons.join(" ")).toContain("Module incompatible");
    expect(failures[2]?.reasons.join(" ")).toContain("porte déjà l'identifiant");
    expect(logger.error).toHaveBeenCalledTimes(4);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("Module « vieux » refusé"));
  });

  it("cannot take the type of a core block", async () => {
    const { failures } = await load({
      official: [{ ...demo, blocks: [{ ...demoBlock, type: "demo.note" }] }],
      reservedBlockTypes: ["demo.note"],
    });
    expect(failures[0]?.reasons.join(" ")).toContain("déjà déclaré par le noyau");
  });
});

describe("modules installed in DATA_DIR/modules", () => {
  it("are none when the directory does not exist", async () => {
    expect(await load()).toEqual({ modules: [], failures: [] });
  });

  it("are loaded from manifest.json and server.js, sharing React and zod with the CMS", async () => {
    writeModuleFixture(modulesDirectory, { id: "badge", version: "2.1.0" });
    const { modules, failures } = await load();
    expect(failures).toEqual([]);
    const [module] = modules;
    expect(module).toMatchObject({
      source: "installed",
      directory: join(modulesDirectory, "badge"),
      manifest: { id: "badge", version: "2.1.0", permissions: ["pages.read"] },
    });
    const block = module?.definition.blocks?.[0];
    expect(block?.type).toBe("badge.badge");
    // Rendered by this process's React: the module's JSX runtime is the CMS's copy.
    expect(
      renderToStaticMarkup(
        block?.render({ id: "b", text: "ok" }) as Parameters<typeof renderToStaticMarkup>[0],
      ),
    ).toBe('<p class="cms-heading">Badge : ok</p>');
    expect(module?.definition.settings?.parse({})).toEqual({ color: "bleu" });
  });

  it("share React and zod with modules reached through a link or a junction", async () => {
    // DATA_DIR/modules is a junction (Windows) or a symbolic link to the real directory: Node
    // reports the real path of the importing file, which the shared roots must include.
    const real = join(dataDir, "real", "modules");
    mkdirSync(real, { recursive: true });
    mkdirSync(join(dataDir, "data"));
    const linked = join(dataDir, "data", "modules");
    symlinkSync(real, linked, "junction");
    writeModuleFixture(real, { id: "lie" });
    const { modules, failures } = await load({ modulesDirectory: linked });
    expect(failures).toEqual([]);
    expect(modules.map((module) => module.manifest.id)).toEqual(["lie"]);
  });

  it("ignores files beside the module directories", async () => {
    mkdirSync(modulesDirectory, { recursive: true });
    writeFileSync(join(modulesDirectory, "LISEZMOI.txt"), "rien");
    writeModuleFixture(modulesDirectory, { id: "badge" });
    const { modules } = await load();
    expect(modules).toHaveLength(1);
  });

  it.each([
    ["without manifest.json", { manifest: undefined, removeManifest: true }, "introuvable"],
    ["with a manifest that is not JSON", { manifest: "{ pas du json" }, "pas du JSON valide"],
    [
      "with an invalid manifest",
      { manifest: { id: "badge-test", name: "", version: "1", engines: { cms: "*" } } },
      "Manifeste invalide",
    ],
    [
      "whose manifest id is not its directory",
      { directory: "autre-nom" },
      "doit être le nom du dossier",
    ],
    [
      // Tester: on Windows the file system ignores case, the identifier must not.
      "whose directory differs from the manifest id by case only",
      { directory: "Badge-Test" },
      "doit être le nom du dossier",
    ],
    ["for another CMS version", { cms: "^5.0.0" }, "Module incompatible"],
    ["with an invalid range of CMS versions", { cms: "n'importe" }, "est invalide"],
    ["without server.js", { server: null }, "server.js introuvable"],
    [
      "whose code throws when imported",
      { server: 'throw new Error("plantage au chargement");' },
      "plantage au chargement",
    ],
    [
      "whose code imports a package the CMS does not share",
      { server: 'import "inconnu-xyz"; export default {};' },
      "n'a pas pu être chargé",
    ],
    [
      "whose default export is not a module definition",
      { server: "export default { id: 'badge-test' };" },
      "Définition du module invalide",
    ],
    [
      "whose code does not match its manifest",
      {
        server: "export default { id: 'badge-test', name: 'Badge', version: '9.9.9', blocks: [] };",
      },
      "ne correspond pas à son manifeste",
    ],
  ])("are refused %s, without stopping the others", async (_name, fixture, reason) => {
    const { removeManifest, ...options } = fixture as Record<string, unknown>;
    const directory = writeModuleFixture(modulesDirectory, options);
    if (removeManifest === true) {
      rmSync(join(directory, "manifest.json"));
    }
    writeModuleFixture(modulesDirectory, { id: "zz-valide" });
    const { modules, failures } = await load();
    expect(modules.map((module) => module.manifest.id)).toEqual(["zz-valide"]);
    expect(failures).toHaveLength(1);
    expect(failures[0]?.source).toBe("installed");
    expect(failures[0]?.reasons.join(" ")).toContain(reason);
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it("never runs the code of a module whose manifest is refused", async () => {
    const marker = join(dataDir, "executed.txt");
    writeModuleFixture(modulesDirectory, {
      cms: "^5.0.0",
      server: `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)}, "x"); export default {};`,
    });
    const { failures } = await load();
    expect(failures).toHaveLength(1);
    expect(existsSync(marker)).toBe(false);
  });

  it("are refused when they reuse the id or a block type of an official module", async () => {
    writeModuleFixture(modulesDirectory, { id: "demo" });
    const { modules, failures } = await load({ official: [demo] });
    expect(modules.map((module) => module.source)).toEqual(["official"]);
    expect(failures[0]?.reasons.join(" ")).toContain("porte déjà l'identifiant");
  });

  it("give up waiting for code that never finishes loading", async () => {
    writeModuleFixture(modulesDirectory, {
      server: "await new Promise(() => {}); export default {};",
    });
    const { failures } = await load({ importTimeoutMs: 50 });
    expect(failures[0]?.reasons.join(" ")).toContain("ne s'est pas chargé en 0.05 s");
  });
});

describe("resolveSharedDependency", () => {
  const urls = new Map([["react", "file:///cms/node_modules/react/index.js"]]);
  const root = pathToFileURL(join(tmpdir(), "data", "modules")).href;

  it("gives the CMS's copy to the files of installed modules", () => {
    expect(resolveSharedDependency("react", `${root}/badge/server.js`, [root], urls)).toBe(
      "file:///cms/node_modules/react/index.js",
    );
    expect(
      resolveSharedDependency("react", `${root}/badge/lib/chunk.js`, [root], urls),
    ).toBeDefined();
  });

  it("leaves every other import to Node", () => {
    expect(
      resolveSharedDependency("lodash", `${root}/badge/server.js`, [root], urls),
    ).toBeUndefined();
    expect(
      resolveSharedDependency("react", "file:///cms/apps/server/main.js", [root], urls),
    ).toBeUndefined();
    expect(
      resolveSharedDependency("react", `${root}-autre/x/server.js`, [root], urls),
    ).toBeUndefined();
    expect(resolveSharedDependency("react", undefined, [root], urls)).toBeUndefined();
  });
});
