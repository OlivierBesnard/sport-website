import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Test helper (entry `@sport-cms/module-loader/testing`): writes a compiled module into `modulesDirectory/<id>/`,
 * as a module author would ship it: `manifest.json` and an ESM `server.js` that imports React's
 * JSX runtime and zod from the CMS (shared dependencies), not from a bundle of its own.
 */
export interface ModuleFixture {
  readonly id?: string;
  readonly version?: string;
  /** Range of `engines.cms` (`^0.1.0` by default). */
  readonly cms?: string;
  /** Replaces the whole manifest (any JSON value), or its text when a string. */
  readonly manifest?: unknown;
  /** Replaces the code of `server.js`; `null` leaves the file out. */
  readonly server?: string | null;
  /** Directory name, the id by default. */
  readonly directory?: string;
  /** Code of `client.js` (the client entry of the back-office); absent by default. */
  readonly client?: string;
}

/** `client.js` of the fixture module: its block, for the editor, as a module author ships it. */
export function fixtureClientSource(id: string): string {
  return `import { jsx } from "react/jsx-runtime";
import { defineModuleClient } from "@sport-cms/module-sdk";

export default defineModuleClient({
  id: ${JSON.stringify(id)},
  blocks: [
    {
      type: ${JSON.stringify(`${id}.badge`)},
      label: "Badge",
      fields: { text: { type: "text", label: "Texte" } },
      defaultProps: { text: "" },
      render: ({ text }) => jsx("p", { className: "cms-heading", children: "Badge : " + text }),
    },
  ],
});
`;
}

/** `server.js` of a module with one block `<id>.badge`, settings and credentials. */
export function fixtureServerSource(id: string, version: string): string {
  return `import { jsx } from "react/jsx-runtime";
import { z } from "zod";

export default {
  id: ${JSON.stringify(id)},
  name: "Module de test",
  version: ${JSON.stringify(version)},
  settings: z.object({ color: z.enum(["rouge", "bleu"]).default("bleu") }),
  credentials: z.object({ token: z.string().min(1) }),
  blocks: [
    {
      type: ${JSON.stringify(`${id}.badge`)},
      label: "Badge",
      fields: { text: { type: "text", label: "Texte" } },
      defaultProps: { text: "" },
      render: ({ text }) => jsx("p", { className: "cms-heading", children: "Badge : " + text }),
    },
  ],
};
`;
}

export function writeModuleFixture(modulesDirectory: string, fixture: ModuleFixture = {}): string {
  const id = fixture.id ?? "badge-test";
  const version = fixture.version ?? "1.0.0";
  const directory = join(modulesDirectory, fixture.directory ?? id);
  mkdirSync(directory, { recursive: true });
  const manifest =
    fixture.manifest === undefined
      ? {
          id,
          name: "Module de test",
          version,
          engines: { cms: fixture.cms ?? "^0.1.0" },
          permissions: ["pages.read"],
        }
      : fixture.manifest;
  writeFileSync(
    join(directory, "manifest.json"),
    typeof manifest === "string" ? manifest : JSON.stringify(manifest),
  );
  if (fixture.server !== null) {
    writeFileSync(join(directory, "server.js"), fixture.server ?? fixtureServerSource(id, version));
  }
  if (fixture.client !== undefined) {
    writeFileSync(join(directory, "client.js"), fixture.client);
  }
  return directory;
}
