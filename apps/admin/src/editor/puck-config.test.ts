import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import { describe, expect, it } from "vitest";
import { buildEditorConfig, fromPuckData, toPuckData } from "./puck-config";

/**
 * The Puck configuration of the editor is built from the same registry as the public renderer
 * (E06): same components, same render functions, same default props; the root carries the
 * metadata fields of the published version.
 */

const registry = createBlockRegistry(coreBlocks);

interface PuckComponent {
  readonly label: string;
  readonly fields: Record<string, { type: string; options?: unknown }>;
  readonly render: unknown;
  readonly defaultProps: Record<string, unknown>;
}

function components(): Record<string, PuckComponent> {
  const { config } = buildEditorConfig(registry);
  return (config as unknown as { components: Record<string, PuckComponent> }).components;
}

describe("buildEditorConfig", () => {
  it("offers exactly the blocks of the registry, with their render and default props", () => {
    const built = components();
    expect(Object.keys(built).sort()).toEqual([...registry.keys()].sort());
    for (const [type, definition] of registry) {
      // The render of the registry, behind the error boundary of the preview (props normalized
      // by `BlockPreview`): the element tree points at the very same block definition.
      const render = built[type]?.render as (props: Record<string, unknown>) => {
        props: { children: { props: { definition: unknown } } };
      };
      expect(render({ id: "x" }).props.children.props.definition, type).toBe(definition);
      expect(built[type]?.label, type).toBe(definition.label);
      expect(built[type]?.defaultProps, type).toEqual(definition.defaultProps);
    }
  });

  it("turns the boolean fields into a Oui/Non radio that stores a boolean", () => {
    const decorative = components().Image?.fields.decorative;
    expect(decorative?.type).toBe("radio");
    expect(decorative?.options).toEqual([
      { label: "Oui", value: true },
      { label: "Non", value: false },
    ]);
    expect(components().Hero?.fields.decorative?.type).toBe("radio");
  });

  it("puts the title, description and sharing image on the root of the page", () => {
    const { config } = buildEditorConfig(registry);
    const root = (config as unknown as { root: { fields: Record<string, { type: string }> } }).root;
    expect(Object.keys(root.fields).sort()).toEqual(["description", "image", "title"]);
  });

  it("does not share the default props object of the registry", () => {
    const built = components();
    const hero = registry.get("Hero");
    expect(built.Hero?.defaultProps).not.toBe(hero?.defaultProps);
  });
});

describe("toPuckData / fromPuckData", () => {
  it("falls back to an empty page for unknown shapes", () => {
    for (const value of [null, undefined, 42, "x", [], { root: null, content: "x" }]) {
      expect(toPuckData(value)).toEqual({ root: { props: {} }, content: [], zones: {} });
    }
  });

  it("round-trips stored page data", () => {
    const stored = {
      root: { props: { title: "Le club", description: "Desc" } },
      content: [{ type: "Hero", props: { id: "h1", title: "Bienvenue" } }],
      zones: {},
    };
    expect(fromPuckData(toPuckData(stored))).toEqual(stored);
  });
});
