import { describe, expect, it } from "vitest";
import * as root from "./index.js";

describe("root entry of @sport-cms/core", () => {
  it("leaves out the runtime configuration, which needs Node.js built-ins", () => {
    expect(Object.keys(root)).toEqual(["slugify"]);
    expect(root).not.toHaveProperty("parseRuntimeConfig");
  });
});
