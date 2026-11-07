import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import { describe, expect, it } from "vitest";
import { type EditorSelection, planInsertion, ROOT_ZONE, zoneAccepts } from "./insertion";

const registry = createBlockRegistry(coreBlocks);

/** Types of the blocks of a small page: a section holding columns holding a heading. */
const TYPES: Record<string, string> = {
  "section-1": "Section",
  "columns-1": "Columns",
  "heading-1": "Heading",
  "hero-1": "Hero",
};
const typeOf = (id: string): string | undefined => TYPES[id];

function selection(
  selected: EditorSelection["selected"],
  selector: EditorSelection["selector"],
): EditorSelection {
  return { selected, selector, typeOf, rootLength: 3 };
}

const section = {
  type: "Section",
  props: { id: "section-1", background: "default", content: [{}, {}] },
};
const columns = {
  type: "Columns",
  props: { id: "columns-1", layout: "halves", first: [{}], second: [], third: [], fourth: [] },
};
const heading = { type: "Heading", props: { id: "heading-1", text: "Titre", level: 2 } };
const hero = { type: "Hero", props: { id: "hero-1", title: "Bienvenue" } };

describe("planInsertion", () => {
  it("adds at the end of the page when nothing is selected", () => {
    expect(planInsertion("Section", selection(null, null), registry)).toEqual({
      zone: ROOT_ZONE,
      index: 3,
    });
  });

  it("adds inside the selected Section, at the end of its slot", () => {
    const target = planInsertion("Heading", selection(section, { index: 1 }), registry);
    expect(target).toEqual({ zone: "section-1:content", index: 2 });
  });

  it("adds into the first column that accepts the block", () => {
    const target = planInsertion(
      "Image",
      selection(columns, { index: 0, zone: "section-1:content" }),
      registry,
    );
    expect(target).toEqual({ zone: "columns-1:first", index: 1 });
  });

  it("never puts Columns into Columns: they go right after the selected ones, in the Section", () => {
    const target = planInsertion(
      "Columns",
      selection(columns, { index: 0, zone: "section-1:content" }),
      registry,
    );
    expect(target).toEqual({ zone: "section-1:content", index: 1 });
  });

  it("never puts a Section into a Section: it goes after it, at the root", () => {
    const target = planInsertion("Section", selection(section, { index: 1 }), registry);
    expect(target).toEqual({ zone: ROOT_ZONE, index: 2 });
  });

  it("adds right after a selected block that holds nothing, in its zone", () => {
    const target = planInsertion(
      "RichText",
      selection(heading, { index: 0, zone: "columns-1:first" }),
      registry,
    );
    expect(target).toEqual({ zone: "columns-1:first", index: 1 });
  });

  it("falls back to the end of the page when the zone of the selected block refuses the type", () => {
    // A Section after a Heading inside a column: the column refuses it.
    const target = planInsertion(
      "Section",
      selection(heading, { index: 0, zone: "columns-1:first" }),
      registry,
    );
    expect(target).toEqual({ zone: ROOT_ZONE, index: 3 });
  });

  it("adds a Section right after a selected Hero, at the root", () => {
    const target = planInsertion("Section", selection(hero, { index: 0 }), registry);
    expect(target).toEqual({ zone: ROOT_ZONE, index: 1 });
  });

  it("does not put a Heading at the root after a Hero: end of the page, refused at the save", () => {
    const target = planInsertion("Heading", selection(hero, { index: 0 }), registry);
    expect(target).toEqual({ zone: ROOT_ZONE, index: 3 });
  });
});

describe("zoneAccepts", () => {
  it("reads the root rule and the allow / disallow lists of the slots", () => {
    expect(zoneAccepts(ROOT_ZONE, "Hero", registry, typeOf)).toBe(true);
    expect(zoneAccepts(ROOT_ZONE, "Heading", registry, typeOf)).toBe(false);
    expect(zoneAccepts("section-1:content", "Columns", registry, typeOf)).toBe(true);
    expect(zoneAccepts("section-1:content", "Hero", registry, typeOf)).toBe(false);
    expect(zoneAccepts("columns-1:second", "Columns", registry, typeOf)).toBe(false);
  });

  it("refuses a zone it cannot read: unknown parent, unknown or non-slot field", () => {
    expect(zoneAccepts("inconnu:content", "Heading", registry, typeOf)).toBe(false);
    expect(zoneAccepts("section-1:background", "Heading", registry, typeOf)).toBe(false);
    expect(zoneAccepts("sans-separateur", "Heading", registry, typeOf)).toBe(false);
  });
});
