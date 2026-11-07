import { describe, expect, it } from "vitest";
import { z } from "zod";
import * as sdk from "./index.js";
import { defineModule, type ModuleContext } from "./index.js";

describe("root entry of @sport-cms/module-sdk", () => {
  it("exports the module and block helpers", () => {
    expect(Object.keys(sdk).sort()).toEqual([
      "MODULE_ID_PATTERN",
      "checkModuleDefinition",
      "defineBlock",
      "defineModule",
      "moduleManifestSchema",
      "parseModuleManifest",
      "safeImageUrl",
      "safeLinkUrl",
    ]);
  });

  it("keeps the types of the settings and credentials up to the lifecycle hooks", () => {
    const seen: unknown[] = [];
    const definition = defineModule({
      id: "demo",
      name: "Démo",
      version: "1.0.0",
      settings: z.object({ greeting: z.string().default("Bonjour") }),
      credentials: z.object({ apiKey: z.string() }),
      lifecycle: {
        async onEnable(ctx) {
          const settings = await ctx.settings();
          const credentials = await ctx.credentials();
          // Typed: `greeting` is a string, `apiKey` a string once credentials exist.
          seen.push(settings.greeting.toUpperCase(), credentials?.apiKey.length);
        },
      },
    });
    const ctx: ModuleContext<{ greeting: string }, { apiKey: string }> = {
      module: { id: "demo", version: "1.0.0" },
      logger: { info() {}, warn() {}, error() {} },
      settings: async () => ({ greeting: "salut" }),
      credentials: async () => ({ apiKey: "clé" }),
      kv: { get: async () => undefined, set: async () => {}, delete: async () => false },
    };
    return Promise.resolve(definition.lifecycle?.onEnable?.(ctx)).then(() => {
      expect(seen).toEqual(["SALUT", 3]);
    });
  });
});
