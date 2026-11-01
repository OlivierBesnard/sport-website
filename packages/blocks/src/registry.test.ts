import { describe, expect, it } from "vitest";
import { coreBlocks, headingBlock } from "./blocks/index.js";
import { createBlockRegistry } from "./registry.js";
import { defineBlock } from "./types.js";

describe("createBlockRegistry", () => {
  it("indexes the core blocks by type", () => {
    const registry = createBlockRegistry(coreBlocks);
    expect([...registry.keys()].sort()).toEqual([
      "Button",
      "Columns",
      "Heading",
      "Hero",
      "Image",
      "RichText",
      "Section",
    ]);
    expect(registry.get("Heading")).toBe(headingBlock);
  });

  it("refuses two blocks with the same type", () => {
    const copy = defineBlock({ ...headingBlock, label: "Autre titre" });
    expect(() => createBlockRegistry([...coreBlocks, copy])).toThrow(
      "Duplicate block type: Heading",
    );
  });

  it("accepts module blocks next to the core ones", () => {
    const moduleBlock = defineBlock<{ label: string }>({
      type: "helloasso.membership-button",
      label: "Bouton d'adhésion",
      fields: { label: { type: "text" } },
      defaultProps: { label: "J'adhère" },
      render: ({ label }) => label,
    });
    const registry = createBlockRegistry([...coreBlocks, moduleBlock]);
    expect(registry.get("helloasso.membership-button")).toBe(moduleBlock);
  });
});

describe("core block definitions", () => {
  it.each(coreBlocks.map((block) => [block.type, block] as const))(
    "%s declares a field for every default prop, and a French label",
    (_type, block) => {
      expect(Object.keys(block.fields).sort()).toEqual(Object.keys(block.defaultProps).sort());
      expect(block.label).not.toBe("");
    },
  );
});
