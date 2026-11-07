import { describe, expect, it } from "vitest";
import * as root from "./index.js";

describe("root entry of @sport-cms/core", () => {
  it("exports the domain helpers and the roles, but no Node.js built-ins", () => {
    expect(Object.keys(root).sort()).toEqual([
      "CMS_VERSION",
      "CORE_PERMISSIONS",
      "ROLES",
      "ROLE_PERMISSIONS",
      "can",
      "encodePagePath",
      "normalizePagePath",
      "slugify",
    ]);
    expect(root).not.toHaveProperty("parseRuntimeConfig");
  });

  it("gives the version of the CMS in semver form", () => {
    expect(root.CMS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
