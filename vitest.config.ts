import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Export condition under which internal packages expose their TypeScript sources.
 * Tests resolve it so they never run against a missing or stale `dist/`.
 */
const SOURCE_CONDITION = "@sport-cms/source";

const WORKSPACE_MANIFESTS = [
  "apps/*/package.json",
  "packages/*/package.json",
  "modules/*/package.json",
];

/**
 * One Vitest project per workspace package, named after its package.json.
 * Inline projects inherit this config (`extends: true`), resolve conditions included;
 * plain directory globs in `test.projects` would not.
 */
const projects = globSync(WORKSPACE_MANIFESTS, { cwd: import.meta.dirname })
  .sort()
  .map((manifest) => {
    const { name } = JSON.parse(readFileSync(join(import.meta.dirname, manifest), "utf8")) as {
      name: string;
    };
    return { extends: true, root: dirname(manifest), test: { name } };
  });

export default defineConfig({
  // Node-side tests run in Vite's `ssr` environment. Vitest appends its default
  // server conditions and forwards the list to the workers as `--conditions`.
  ssr: { resolve: { conditions: [SOURCE_CONDITION] } },
  test: { projects },
});
