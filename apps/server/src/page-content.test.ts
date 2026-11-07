import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import { describe, expect, it } from "vitest";
import { countLevel1Headings, findContentIssues } from "./page-content.js";

const registry = createBlockRegistry(coreBlocks);

describe("findContentIssues", () => {
  it("walks the slots of the sections and the columns, wherever they sit", () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            background: "default",
            content: [
              {
                type: "Columns",
                props: {
                  id: "c1",
                  layout: "halves",
                  first: [
                    {
                      type: "Image",
                      props: {
                        id: "i1",
                        src: "/media/a.jpg",
                        alt: "",
                        decorative: false,
                        caption: "",
                      },
                    },
                  ],
                  second: [],
                  third: [],
                  fourth: [],
                },
              },
            ],
          },
        },
      ],
      zones: {},
    };
    const issues = findContentIssues(data, registry);
    expect(issues.map((issue) => issue.path)).toEqual(["content.0.content.0.first.0.alt"]);
  });

  it("refuses the blocks a slot disallows: Columns in Columns, Section or Hero in a Section", () => {
    const columns = (first: unknown[]) => ({
      type: "Columns",
      props: { id: "c1", layout: "halves", first, second: [], third: [], fourth: [] },
    });
    const data = {
      root: { props: {} },
      content: [
        {
          type: "Section",
          props: {
            id: "s1",
            background: "default",
            content: [
              columns([columns([]), { type: "RichText", props: { id: "t1", body: "<p>Ok</p>" } }]),
              { type: "Section", props: { id: "s2", background: "default", content: [] } },
              { type: "Hero", props: { id: "h1", title: "" } },
            ],
          },
        },
      ],
      zones: {},
    };
    const issues = findContentIssues(data, registry);
    expect(issues.map((issue) => issue.path)).toEqual([
      "content.0.content.1",
      "content.0.content.2",
      "content.0.content.0.first.0",
    ]);
    expect(issues[0]?.message).toContain(
      "« Section » ne peut pas être placé dans un bloc « Section »",
    );
    expect(issues[2]?.message).toContain("« Colonnes »");
  });

  it("walks the zones of the page data like the renderer ignores them: only the content counts", () => {
    const data = {
      root: { props: {} },
      content: [],
      zones: { "zone-1": [{ type: "Button", props: { id: "b", label: "x", href: "/" } }] },
    };
    expect(findContentIssues(data, registry)).toEqual([]);
    expect(countLevel1Headings(data, registry)).toBe(0);
  });

  it("requires the alternative text of the image of a hero unless it is decorative", () => {
    const hero = (decorative: boolean, imageAlt: string) => ({
      root: { props: {} },
      content: [
        {
          type: "Hero",
          props: {
            id: "h",
            title: "US Exemple",
            subtitle: "",
            imageSrc: "/media/hero.jpg",
            imageAlt,
            decorative,
            ctaLabel: "",
            ctaHref: "",
          },
        },
      ],
      zones: {},
    });
    expect(findContentIssues(hero(false, ""), registry)).toHaveLength(1);
    expect(findContentIssues(hero(true, ""), registry)).toEqual([]);
    expect(findContentIssues(hero(false, "La mêlée"), registry)).toEqual([]);
  });

  it("ignores an image without a safe address: nothing is rendered, nothing is required", () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: "Section",
          props: {
            id: "s",
            background: "default",
            content: [
              {
                type: "Image",
                props: {
                  id: "i",
                  src: "javascript:alert(1)",
                  alt: "",
                  decorative: false,
                  caption: "",
                },
              },
            ],
          },
        },
      ],
      zones: {},
    };
    expect(findContentIssues(data, registry)).toEqual([]);
  });
});

describe("countLevel1Headings", () => {
  it("counts the level 1 headings and the heroes, deeply nested", () => {
    const heading1 = (id: string) => ({
      type: "Heading",
      props: { id, text: "Titre", level: 1, align: "left" },
    });
    const data = {
      root: { props: {} },
      content: [
        {
          type: "Section",
          props: {
            id: "s",
            background: "default",
            content: [
              {
                type: "Columns",
                props: {
                  id: "c",
                  layout: "halves",
                  first: [heading1("h1")],
                  second: [],
                  third: [],
                  fourth: [],
                },
              },
            ],
          },
        },
        {
          type: "Hero",
          props: {
            id: "hero",
            title: "US Exemple",
            subtitle: "",
            imageSrc: "",
            imageAlt: "",
            decorative: false,
            ctaLabel: "",
            ctaHref: "",
          },
        },
      ],
      zones: {},
    };
    expect(countLevel1Headings(data, registry)).toBe(2);
  });

  it("ignores an empty heading and a heading of another level", () => {
    const data = {
      root: { props: {} },
      content: [
        {
          type: "Section",
          props: {
            id: "s",
            background: "default",
            content: [
              { type: "Heading", props: { id: "a", text: "  ", level: 1, align: "left" } },
              { type: "Heading", props: { id: "b", text: "Deux", level: 2, align: "left" } },
            ],
          },
        },
      ],
      zones: {},
    };
    expect(countLevel1Headings(data, registry)).toBe(0);
  });

  it("ignores blocks of an unknown type: they render nothing", () => {
    const data = {
      root: { props: {} },
      content: [{ type: "Mystère", props: { id: "m", title: "Niveau 1 ?" } }],
      zones: {},
    };
    expect(countLevel1Headings(data, registry)).toBe(0);
  });
});
