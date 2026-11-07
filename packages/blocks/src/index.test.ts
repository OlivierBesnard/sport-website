import { describe, expect, it } from "vitest";
import * as root from "./index.js";
import * as server from "./server/index.js";

describe("entries of @sport-cms/blocks", () => {
  it("keep the server-only renderer and sanitizer out of the root entry, used by the editor", () => {
    expect(root).not.toHaveProperty("renderPageContent");
    expect(root).not.toHaveProperty("sanitizeRichText");
    expect(Object.keys(server).sort()).toEqual([
      "BLOCK_LOADER_TIMEOUT_MS",
      "BlockComponentError",
      "BlockDataMissingError",
      "BlockLoaderTimeoutError",
      "MAX_NESTING_DEPTH",
      "loadPageBlocks",
      "renderPageContent",
      "sanitizeRichText",
    ]);
  });

  it("expose the block contract and the core blocks at the root", () => {
    expect(root.coreBlocks).toHaveLength(13);
    expect(typeof root.defineBlock).toBe("function");
    expect(typeof root.createBlockRegistry).toBe("function");
    expect(typeof root.safeLinkUrl).toBe("function");
    expect(typeof root.safeImageUrl).toBe("function");
  });
});
