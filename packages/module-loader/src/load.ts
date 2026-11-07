import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CMS_VERSION } from "@sport-cms/core";
import {
  checkModuleDefinition,
  type DataProcessing,
  type ModuleDefinition,
  parseModuleManifest,
} from "@sport-cms/module-sdk";
import { satisfies, validRange } from "semver";
import { shareDependenciesWith } from "./shared-dependencies.js";

/** Where a module comes from: shipped with the CMS, or installed in `DATA_DIR/modules`. */
export type ModuleSource = "official" | "installed";

/** Manifest of a loaded module, defaults filled in. */
export interface ModuleManifestInfo {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description?: string | undefined;
  readonly category?: string | undefined;
  /** Range of CMS versions, when declared (always for an installed module). */
  readonly engines?: { readonly cms: string } | undefined;
  readonly permissions: readonly string[];
  readonly dataProcessing: readonly DataProcessing[];
}

/** A module accepted by the loader: its code is loaded and fits this CMS. */
export interface LoadedModule {
  readonly manifest: ModuleManifestInfo;
  readonly definition: ModuleDefinition;
  readonly source: ModuleSource;
  /** Directory of an installed module. */
  readonly directory?: string;
}

/** A module the loader refused; the server runs without it. */
export interface ModuleLoadFailure {
  /** Identifier of the module, or the name of its directory when the manifest is unreadable. */
  readonly id: string;
  readonly source: ModuleSource;
  /** Why, in French, for the logs and the back-office. */
  readonly reasons: readonly string[];
}

export interface ModuleLoadResult {
  readonly modules: readonly LoadedModule[];
  readonly failures: readonly ModuleLoadFailure[];
}

/** Where the loader reports refused modules. */
export interface LoaderLogger {
  error(message: string, ...details: unknown[]): void;
}

export interface LoadModulesOptions {
  /** Definitions of the official modules (default exports of `modules/*`). */
  readonly official?: readonly unknown[];
  /** `DATA_DIR/modules`: one directory per installed module (absent: none). */
  readonly modulesDirectory?: string;
  /** Version checked against `engines.cms` ({@link CMS_VERSION} by default). */
  readonly cmsVersion?: string;
  /** Block types already taken (the core blocks): a module cannot declare them. */
  readonly reservedBlockTypes?: Iterable<string>;
  /**
   * How long startup waits for the code of an installed module to finish loading (10 s by
   * default) before refusing it. The code itself is not stopped: a module that keeps waiting
   * (top-level `await`) is only given up, and one that blocks the thread blocks the startup.
   */
  readonly importTimeoutMs?: number;
  readonly logger?: LoaderLogger;
}

/** Files of an installed module, in `DATA_DIR/modules/<id>/`. */
export const MANIFEST_FILE = "manifest.json";
export const SERVER_ENTRY_FILE = "server.js";

const DEFAULT_IMPORT_TIMEOUT_MS = 10_000;

/** Raised to refuse a module, with the reasons in French. */
class Refusal extends Error {
  readonly reasons: readonly string[];

  constructor(reasons: readonly string[]) {
    super(reasons.join(" "));
    this.reasons = reasons;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Refuses the module unless the CMS version is in its range `engines.cms` (prereleases included:
 * `^1.2.0` accepts `1.3.0-beta.1`).
 */
export function checkEngines(range: string, cmsVersion: string): string | undefined {
  if (validRange(range) === null) {
    return `La plage de versions du CMS « ${range} » (engines.cms) est invalide.`;
  }
  if (!satisfies(cmsVersion, range, { includePrerelease: true })) {
    return (
      `Module incompatible : il demande une version du CMS « ${range} », ` +
      `celle de l'instance est ${cmsVersion}.`
    );
  }
  return undefined;
}

function manifestOf(definition: ModuleDefinition): ModuleManifestInfo {
  return {
    id: definition.id,
    name: definition.name,
    version: definition.version,
    description: definition.description,
    category: definition.category,
    engines: definition.engines,
    permissions: definition.permissions ?? [],
    dataProcessing: definition.dataProcessing ?? [],
  };
}

function checkDefinition(value: unknown): ModuleDefinition {
  const result = checkModuleDefinition(value);
  if (!result.success) {
    throw new Refusal(["Définition du module invalide :", ...result.issues]);
  }
  return result.value;
}

/**
 * Imports `url`, giving up after `timeoutMs`: the startup goes on without the module, whose code
 * is not interrupted (JavaScript cannot stop it).
 */
async function importWithTimeout(url: string, timeoutMs: number): Promise<unknown> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`le module ne s'est pas chargé en ${timeoutMs / 1000} s`)),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([import(/* @vite-ignore */ url), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Loads one installed module: `manifest.json` is read and checked first (identifier matching
 * the directory, `engines.cms` satisfied), so that the code of a refused module never runs; then
 * `server.js` is imported (ESM) and its default export checked against the manifest.
 * The manifest is what the instance shows (name, permissions, data processing).
 */
async function loadInstalled(
  directory: string,
  name: string,
  cmsVersion: string,
  importTimeoutMs: number,
): Promise<LoadedModule> {
  const manifestPath = join(directory, MANIFEST_FILE);
  if (!existsSync(manifestPath)) {
    throw new Refusal([`Fichier ${MANIFEST_FILE} introuvable.`]);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    throw new Refusal([`Le fichier ${MANIFEST_FILE} n'est pas du JSON valide.`]);
  }
  const parsed = parseModuleManifest(raw);
  if (!parsed.success) {
    throw new Refusal([`Manifeste invalide (${MANIFEST_FILE}) :`, ...parsed.issues]);
  }
  const manifest = parsed.value;
  if (manifest.id !== name) {
    throw new Refusal([
      `L'identifiant du manifeste (« ${manifest.id} ») doit être le nom du dossier (« ${name} »).`,
    ]);
  }
  const incompatible = checkEngines(manifest.engines.cms, cmsVersion);
  if (incompatible !== undefined) {
    throw new Refusal([incompatible]);
  }
  const entry = join(directory, SERVER_ENTRY_FILE);
  if (!existsSync(entry)) {
    throw new Refusal([`Fichier ${SERVER_ENTRY_FILE} introuvable.`]);
  }
  let exported: unknown;
  try {
    const namespace = (await importWithTimeout(pathToFileURL(entry).href, importTimeoutMs)) as {
      default?: unknown;
    };
    exported = namespace.default;
  } catch (error) {
    throw new Refusal([
      `Le code du module (${SERVER_ENTRY_FILE}) n'a pas pu être chargé : ${errorMessage(error)}`,
    ]);
  }
  const definition = checkDefinition(exported);
  if (definition.id !== manifest.id || definition.version !== manifest.version) {
    throw new Refusal([
      `Le code du module (${definition.id} ${definition.version}) ne correspond pas à son ` +
        `manifeste (${manifest.id} ${manifest.version}).`,
    ]);
  }
  return { manifest, definition, source: "installed", directory };
}

/** Subdirectories of the modules directory, by name; none when it does not exist. */
function installedDirectories(modulesDirectory: string | undefined): string[] {
  if (modulesDirectory === undefined || !existsSync(modulesDirectory)) {
    return [];
  }
  return readdirSync(modulesDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

/**
 * Loads the modules of the instance, at startup: the official ones, then those installed in
 * `modulesDirectory` (`DATA_DIR/modules/<id>/manifest.json` + `server.js`), imported dynamically,
 * without any build. A module is refused — logged, listed in `failures`, and the server starts
 * without it — when its manifest or its definition is invalid, its range `engines.cms` excludes
 * this CMS, its code fails to load, its identifier is already taken, or one of its block types
 * is.
 */
export async function loadModules(options: LoadModulesOptions = {}): Promise<ModuleLoadResult> {
  const {
    official = [],
    modulesDirectory,
    cmsVersion = CMS_VERSION,
    reservedBlockTypes = [],
    importTimeoutMs = DEFAULT_IMPORT_TIMEOUT_MS,
    logger = console,
  } = options;
  const modules: LoadedModule[] = [];
  const failures: ModuleLoadFailure[] = [];
  const blockOwners = new Map<string, string>();
  for (const type of reservedBlockTypes) {
    blockOwners.set(type, "le noyau");
  }

  function refuse(id: string, source: ModuleSource, reasons: readonly string[]): void {
    failures.push({ id, source, reasons });
    logger.error(`Module « ${id} » refusé : ${reasons.join(" ")}`);
  }

  /** Last checks, against the modules already accepted. */
  function accept(module: LoadedModule): void {
    const { id } = module.manifest;
    if (modules.some((other) => other.manifest.id === id)) {
      throw new Refusal([`Un autre module porte déjà l'identifiant « ${id} ».`]);
    }
    const taken = (module.definition.blocks ?? []).flatMap((block) => {
      const owner = blockOwners.get(block.type);
      return owner === undefined
        ? []
        : [`Le type de bloc « ${block.type} » est déjà déclaré par ${owner}.`];
    });
    if (taken.length > 0) {
      throw new Refusal(taken);
    }
    for (const block of module.definition.blocks ?? []) {
      blockOwners.set(block.type, `le module « ${id} »`);
    }
    modules.push(module);
  }

  for (const [index, value] of official.entries()) {
    const id =
      typeof value === "object" && value !== null && typeof Reflect.get(value, "id") === "string"
        ? String(Reflect.get(value, "id"))
        : `officiel n° ${index + 1}`;
    try {
      const definition = checkDefinition(value);
      const incompatible =
        definition.engines === undefined
          ? undefined
          : checkEngines(definition.engines.cms, cmsVersion);
      if (incompatible !== undefined) {
        throw new Refusal([incompatible]);
      }
      accept({ manifest: manifestOf(definition), definition, source: "official" });
    } catch (error) {
      refuse(id, "official", error instanceof Refusal ? error.reasons : [errorMessage(error)]);
    }
  }

  const names = installedDirectories(modulesDirectory);
  if (modulesDirectory !== undefined && names.length > 0) {
    shareDependenciesWith(modulesDirectory);
  }
  for (const name of names) {
    try {
      const directory = join(modulesDirectory ?? "", name);
      accept(await loadInstalled(directory, name, cmsVersion, importTimeoutMs));
    } catch (error) {
      refuse(name, "installed", error instanceof Refusal ? error.reasons : [errorMessage(error)]);
    }
  }
  return { modules, failures };
}
