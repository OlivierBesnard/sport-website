import { realpathSync } from "node:fs";
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Packages an installed module imports from the CMS instead of bundling its own copy: one React
 * (hooks only work with the renderer's copy), one zod (the core reads the module's schemas) and
 * the SDK. A module compiled for the CMS leaves these imports as they are (`external`); any other
 * dependency must be bundled into its files.
 */
export const SHARED_DEPENDENCIES = [
  "react",
  "react/jsx-runtime",
  "react/jsx-dev-runtime",
  "zod",
  "@sport-cms/module-sdk",
] as const;

let sharedUrls: ReadonlyMap<string, string> | undefined;

/** Where the CMS's own copy of each shared package lives, resolved from this package. */
export function sharedDependencyUrls(): ReadonlyMap<string, string> {
  sharedUrls ??= new Map(
    SHARED_DEPENDENCIES.map((specifier) => [specifier, import.meta.resolve(specifier)]),
  );
  return sharedUrls;
}

/** File URL of a directory, ending with `/`, compared without case on Windows. */
function directoryKey(url: string): string {
  const withSlash = url.endsWith("/") ? url : `${url}/`;
  return process.platform === "win32" ? withSlash.toLowerCase() : withSlash;
}

/**
 * URL the CMS gives for `specifier` imported by the file at `parentUrl`: its own copy of a shared
 * package when the importer lies in one of the `roots` (directories of installed modules, as
 * file URLs), `undefined` otherwise (normal resolution).
 */
export function resolveSharedDependency(
  specifier: string,
  parentUrl: string | undefined,
  roots: Iterable<string>,
  urls: ReadonlyMap<string, string> = sharedDependencyUrls(),
): string | undefined {
  const shared = urls.get(specifier);
  if (shared === undefined || parentUrl === undefined) {
    return undefined;
  }
  const parent = directoryKey(parentUrl).slice(0, -1);
  for (const root of roots) {
    if (parent.startsWith(directoryKey(root))) {
      return shared;
    }
  }
  return undefined;
}

const roots = new Set<string>();
let hookRegistered = false;

/**
 * Lets the code under `directory` (as given, and its real path) import the shared packages ({@link SHARED_DEPENDENCIES}) from
 * the CMS, through a resolution hook of Node (`module.registerHooks`), registered once per
 * process; other importers are untouched.
 */
export function shareDependenciesWith(directory: string): void {
  roots.add(pathToFileURL(directory).href);
  // Node gives the real path of the importer (links, junctions and short 8.3 names resolved):
  // `DATA_DIR` reached through a link must still match.
  try {
    roots.add(pathToFileURL(realpathSync(directory)).href);
    roots.add(pathToFileURL(realpathSync.native(directory)).href);
  } catch {
    // The directory does not exist (yet): no module to load from it.
  }
  if (hookRegistered) {
    return;
  }
  hookRegistered = true;
  // Resolved before the hook exists: `import.meta.resolve` inside the hook would call it again.
  const urls = sharedDependencyUrls();
  registerHooks({
    resolve(specifier, context, nextResolve) {
      const url = resolveSharedDependency(specifier, context.parentURL, roots, urls);
      return url === undefined ? nextResolve(specifier, context) : { url, shortCircuit: true };
    },
  });
}
