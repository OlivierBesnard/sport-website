import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import type { ContentReader, SportReader } from "@sport-cms/core";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BlockDataContext, buildEditorConfig } from "./puck-config";

/**
 * The blocks bound to the sports content in the editor: their `reference` fields list the rows
 * of the instance, and their preview waits for the data of their loader.
 */

const registry = createBlockRegistry(coreBlocks);

const sport: SportReader = {
  matches: async () => [],
  teams: async () => [],
  team: async () => null,
  trainingSlots: async () => [],
  venues: async () => [],
};

const references = {
  teams: [
    { value: 7, label: "Seniors A" },
    { value: 8, label: "U13 (2025-2026)" },
  ],
  sections: [],
  venues: [],
  postCategories: [],
  media: [],
};

const content: ContentReader = {
  posts: async () => [],
  post: async () => null,
  partners: async () => ({ partners: [], nextChange: null }),
  media: async () => [],
};

type CustomField = {
  type: string;
  label?: string;
  render: (props: {
    id: string;
    value: unknown;
    onChange: (value: number) => void;
    field: unknown;
  }) => ReactElement;
};

function field(type: string, name: string): CustomField {
  const { config } = buildEditorConfig(registry);
  const components = (
    config as unknown as { components: Record<string, { fields: Record<string, CustomField> }> }
  ).components;
  const found = components[type]?.fields[name];
  if (found === undefined) {
    throw new Error(`${type}.${name} absent`);
  }
  return found;
}

function renderField(custom: CustomField, value: unknown, withData = true): string {
  // Puck also passes its own `field` (the custom field), which must not hide the reference one.
  const element = custom.render({ id: "champ", value, onChange: () => {}, field: custom });
  return renderToStaticMarkup(
    withData ? (
      <BlockDataContext value={{ sport, content, references }}>{element}</BlockDataContext>
    ) : (
      element
    ),
  );
}

describe("reference fields in the editor", () => {
  it("are custom fields listing the rows, with the empty choice of the field", () => {
    const team = field("UpcomingMatches", "teamId");
    expect(team.type).toBe("custom");
    const html = renderField(team, 7);
    expect(html).toContain("Équipe");
    expect(html).toContain('<option value="0">Toutes les équipes</option>');
    expect(html).toContain('<option value="7" selected="">Seniors A</option>');
    expect(html).toContain('<option value="8">U13 (2025-2026)</option>');
  });

  it("say when the chosen row no longer exists, and wait for the list", () => {
    const team = field("TeamProfile", "teamId");
    const html = renderField(team, 99);
    expect(html).toContain('<option value="0">Choisir…</option>');
    expect(html).toContain('<option value="99" selected="">Élément supprimé</option>');
    expect(renderField(team, 7, false)).toContain("Chargement…");
  });
});

describe("blocks with a loader in the preview", () => {
  it("say they are loading until their data arrives", () => {
    const { config } = buildEditorConfig(registry);
    const render = (
      config as unknown as {
        components: Record<string, { render: (props: Record<string, unknown>) => ReactElement }>;
      }
    ).components.UpcomingMatches?.render;
    const html = renderToStaticMarkup(
      <BlockDataContext value={{ sport, content, references }}>
        {render?.({ id: "m", title: "Prochains matchs", teamId: 0, count: 3 })}
      </BlockDataContext>,
    );
    expect(html).toContain("Chargement des données du bloc « Prochains matchs »…");
  });
});

describe("reference fields inside a list", () => {
  it("are converted too, as in the images of the Gallery", () => {
    const images = field("Gallery", "images") as unknown as {
      type: string;
      arrayFields: Record<string, { type: string }>;
    };
    expect(images.type).toBe("array");
    expect(images.arrayFields.mediaId?.type).toBe("custom");
  });
});
