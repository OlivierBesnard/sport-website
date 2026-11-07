import { createRequire } from "node:module";
import type { HtmlTagDescriptor, Plugin } from "vite";

/**
 * Shares the dependencies of the back-office with the client entries of the modules (their
 * `client.js`, imported at run time, never built with the back-office): one copy of React —
 * hooks and contexts only work with one —, of zod and of the SDK.
 *
 * Each shared package gets an entry of its own in the build (a virtual module re-exporting it),
 * so Rollup puts the package in a chunk the back-office and that entry share, and an import map
 * in `index.html` maps the bare specifier to the entry's file:
 *
 * ```html
 * <script type="importmap">{"imports":{"react":"/admin/assets/shared-react-Ab12.js",…}}</script>
 * ```
 *
 * A module's `import { useState } from "react"` then gets the very React of the back-office. The
 * server allows this one inline script by its hash (`adminIndexContentSecurityPolicy`). In
 * development, the map points to the same virtual modules served by Vite.
 */

/** A package the modules import from the back-office. */
export interface SharedModule {
  readonly specifier: string;
  /**
   * `commonjs`: the package is CommonJS (React): its named exports are listed from the package
   * itself, since `export *` cannot see through CommonJS. `esm`: re-exported with `export *`.
   */
  readonly format: "commonjs" | "esm";
  /** Whether an ESM package has a default export to re-export. */
  readonly hasDefault?: boolean;
}

/** What the back-office shares with the modules (see `client.ts` of `@sport-cms/module-sdk`). */
export const SHARED_MODULES: readonly SharedModule[] = [
  { specifier: "react", format: "commonjs" },
  { specifier: "react/jsx-runtime", format: "commonjs" },
  { specifier: "react-dom", format: "commonjs" },
  { specifier: "zod", format: "esm", hasDefault: true },
  { specifier: "@sport-cms/module-sdk", format: "esm" },
];

const VIRTUAL_PREFIX = "virtual:sport-cms-shared/";
/** Rollup's marker of a virtual module id. */
const RESOLVED_PREFIX = `\0${VIRTUAL_PREFIX}`;

/** Name of the build entry of a shared package (`shared-react-jsx-runtime`). */
export function sharedEntryName(specifier: string): string {
  return `shared-${specifier.replace(/^@/, "").replace(/[^a-z0-9]+/gi, "-")}`;
}

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** Source of the virtual module re-exporting `shared`; `keys`: the names a CommonJS one exports. */
export function sharedModuleSource(shared: SharedModule, keys: readonly string[] = []): string {
  const specifier = JSON.stringify(shared.specifier);
  if (shared.format === "esm") {
    return shared.hasDefault === true
      ? `export * from ${specifier};\nexport { default } from ${specifier};\n`
      : `export * from ${specifier};\n`;
  }
  const names = [...new Set(keys)].filter((key) => key !== "default" && IDENTIFIER.test(key));
  // The default import of a CommonJS package is its `module.exports`, in the build as in Vite's
  // development server: its properties are the named exports.
  return [
    `import shared from ${specifier};`,
    "export default shared;",
    names.length === 0 ? "" : `export const { ${names.join(", ")} } = shared;`,
    "",
  ].join("\n");
}

/** Chunk of a Rollup bundle, as far as the import map needs it. */
interface BundleChunk {
  readonly type: string;
  readonly isEntry?: boolean;
  readonly facadeModuleId?: string | null;
  readonly fileName: string;
}

/** Import map of a build: each shared specifier to the URL of its entry under `base`. */
export function importMapOf(
  bundle: Readonly<Record<string, BundleChunk>>,
  base: string,
): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const chunk of Object.values(bundle)) {
    const id = chunk.facadeModuleId ?? "";
    if (chunk.type === "chunk" && chunk.isEntry === true && id.startsWith(RESOLVED_PREFIX)) {
      imports[id.slice(RESOLVED_PREFIX.length)] = `${base}${chunk.fileName}`;
    }
  }
  return { imports };
}

/** Import map of the development server: the virtual modules as Vite serves them. */
export function devImportMap(base: string): { imports: Record<string, string> } {
  const imports: Record<string, string> = {};
  for (const shared of SHARED_MODULES) {
    imports[shared.specifier] = `${base}@id/__x00__${VIRTUAL_PREFIX}${shared.specifier}`;
  }
  return { imports };
}

function importMapTag(map: { imports: Record<string, string> }): HtmlTagDescriptor {
  // First in the head: an import map must come before any module script or preload.
  return {
    tag: "script",
    attrs: { type: "importmap" },
    children: JSON.stringify(map),
    injectTo: "head-prepend",
  };
}

export function sharedModulesPlugin(): Plugin {
  const require = createRequire(import.meta.url);
  let base = "/";
  return {
    name: "sport-cms-shared-modules",
    config() {
      const input: Record<string, string> = {
        index: "index.html",
      };
      for (const shared of SHARED_MODULES) {
        input[sharedEntryName(shared.specifier)] = `${VIRTUAL_PREFIX}${shared.specifier}`;
      }
      return {
        build: {
          rollupOptions: {
            input,
            // Keep the exports of the shared entries: nothing in the back-office imports them,
            // the modules do.
            preserveEntrySignatures: "exports-only",
          },
        },
      };
    },
    configResolved(config) {
      base = config.base;
    },
    resolveId(id) {
      return id.startsWith(VIRTUAL_PREFIX) ? `\0${id}` : undefined;
    },
    load(id) {
      if (!id.startsWith(RESOLVED_PREFIX)) {
        return undefined;
      }
      const specifier = id.slice(RESOLVED_PREFIX.length);
      const shared = SHARED_MODULES.find((candidate) => candidate.specifier === specifier);
      if (shared === undefined) {
        return undefined;
      }
      const keys =
        shared.format === "commonjs" ? Object.keys(require(shared.specifier) as object) : [];
      return sharedModuleSource(shared, keys);
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        const map =
          context.bundle === undefined ? devImportMap(base) : importMapOf(context.bundle, base);
        return [importMapTag(map)];
      },
    },
  };
}
