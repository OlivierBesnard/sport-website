import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coreBlocks } from "../blocks/index.js";
import { createBlockRegistry } from "../registry.js";
import { type ComponentData, defineBlock, type Slot } from "../types.js";
import { MAX_NESTING_DEPTH, type RenderOptions, renderPageContent } from "./render.js";

const registry = createBlockRegistry(coreBlocks);

function render(data: unknown, options: Partial<RenderOptions> = {}): string {
  return renderToStaticMarkup(renderPageContent(data, { registry, ...options }));
}

function page(...content: unknown[]) {
  return { root: { props: { title: "Page" } }, content, zones: {} };
}

function heading(id: string, text: string): ComponentData {
  return { type: "Heading", props: { id, text, level: 2, align: "left" } };
}

function section(id: string, ...content: unknown[]) {
  return { type: "Section", props: { id, background: "default", content } };
}

describe("renderPageContent", () => {
  it("renders the blocks of the page in order", () => {
    expect(render(page(heading("a", "Un"), heading("b", "Deux")))).toBe(
      '<h2 class="cms-heading">Un</h2><h2 class="cms-heading">Deux</h2>',
    );
  });

  it("renders the blocks nested in slots", () => {
    const html = render(page(section("s", heading("h", "Dans la section"))));
    expect(html).toBe(
      '<section class="cms-section"><div class="cms-container cms-stack">' +
        '<h2 class="cms-heading">Dans la section</h2></div></section>',
    );
  });

  it("leaves out blocks of an unknown type, at any depth, and renders the rest", () => {
    const html = render(
      page(
        { type: "FutureBlock", props: { id: "f", text: "<b>?</b>" } },
        heading("a", "Avant"),
        section(
          "s",
          { type: "helloasso.membership-button", props: { id: "m" } },
          heading("b", "Après"),
        ),
      ),
    );
    expect(html).toBe(
      '<h2 class="cms-heading">Avant</h2><section class="cms-section">' +
        '<div class="cms-container cms-stack"><h2 class="cms-heading">Après</h2></div></section>',
    );
  });

  it("skips items that are not blocks", () => {
    const html = render(
      page(
        null,
        "Heading",
        42,
        [],
        { type: 1, props: {} },
        { type: "Heading" },
        { type: "Heading", props: "x" },
        heading("ok", "Valide"),
      ),
    );
    expect(html).toBe('<h2 class="cms-heading">Valide</h2>');
  });

  it("renders nothing for content that is not page data", () => {
    for (const data of [null, undefined, "texte", 42, [], {}, { content: "x" }, { content: {} }]) {
      expect(render(data)).toBe("");
    }
  });

  it("does not render root props nor drop zones", () => {
    const data = {
      root: { props: { title: "<script>alert(1)</script>" } },
      content: [],
      zones: { "Section-1:content": [heading("z", "Zone")] },
    };
    expect(render(data)).toBe("");
  });

  it("fills missing or invalid props with the block defaults", () => {
    const html = render(
      page({ type: "Heading", props: { id: "h", text: "Titre", level: 9, align: 3 } }),
    );
    expect(html).toBe('<h2 class="cms-heading">Titre</h2>');
  });

  it("shows nothing from the defaults of a block whose content is missing", () => {
    for (const type of ["Heading", "RichText", "Image", "Button", "Hero"]) {
      expect(render(page({ type, props: { id: type } })), type).toBe("");
    }
  });

  it("renders blocks without id, or with a repeated id", () => {
    const html = render(
      page(
        { type: "Heading", props: { text: "Sans id" } },
        heading("x", "Premier"),
        heading("x", "Second"),
      ),
    );
    expect(html).toBe(
      '<h2 class="cms-heading">Sans id</h2><h2 class="cms-heading">Premier</h2>' +
        '<h2 class="cms-heading">Second</h2>',
    );
  });

  it("passes the stored id to render", () => {
    const withId = defineBlock<{ text: string }>({
      type: "WithId",
      label: "Avec id",
      fields: { text: { type: "text" } },
      defaultProps: { text: "" },
      render: ({ id }) => <span>{id}</span>,
    });
    const html = renderToStaticMarkup(
      renderPageContent(page({ type: "WithId", props: { id: "WithId-42" } }), {
        registry: createBlockRegistry([withId]),
      }),
    );
    expect(html).toBe("<span>WithId-42</span>");
  });

  it("sanitizes rich text fields before render", () => {
    const html = render(
      page({
        type: "RichText",
        props: { id: "t", body: '<p onclick="alert(1)">Texte<script>alert(2)</script></p>' },
      }),
    );
    expect(html).toBe('<div class="cms-rich-text"><div><p>Texte</p></div></div>');
  });

  it("leaves out a block that throws, reports it, and renders the rest of the page", () => {
    const broken = defineBlock<Record<string, never>>({
      type: "Broken",
      label: "Cassé",
      fields: {},
      defaultProps: {},
      render: () => {
        throw new Error("boom");
      },
    });
    const onBlockError = vi.fn();
    const html = renderToStaticMarkup(
      renderPageContent(
        page(heading("a", "Avant"), section("s", { type: "Broken", props: { id: "b" } })),
        { registry: createBlockRegistry([...coreBlocks, broken]), onBlockError },
      ),
    );
    expect(html).toContain("Avant");
    expect(html).toContain('<section class="cms-section">');
    expect(onBlockError).toHaveBeenCalledOnce();
    expect(onBlockError).toHaveBeenCalledWith(new Error("boom"), { type: "Broken", id: "b" });
  });

  it(`stops rendering nested blocks below depth ${MAX_NESTING_DEPTH}`, () => {
    let content: unknown = heading("deepest", "Trop profond");
    for (let level = MAX_NESTING_DEPTH + 1; level >= 1; level--) {
      content = section(`s${level}`, content);
    }
    const html = render(page(content));
    expect(html).not.toContain("Trop profond");
    expect(html.match(/<section/g)).toHaveLength(MAX_NESTING_DEPTH + 1);

    let allowed: unknown = heading("deep", "Assez profond");
    for (let level = MAX_NESTING_DEPTH; level >= 1; level--) {
      allowed = section(`s${level}`, allowed);
    }
    expect(render(page(allowed))).toContain("Assez profond");
  });

  it("survives a very deep tree without exhausting the stack", () => {
    let content: unknown = heading("h", "x");
    for (let level = 0; level < 10_000; level++) {
      content = section(`s${level}`, content);
    }
    expect(() => render(page(content))).not.toThrow();
  });

  it("lets a block choose the element wrapping its slot", () => {
    const list = defineBlock<{ items: Slot }>({
      type: "List",
      label: "Liste",
      fields: { items: { type: "slot" } },
      defaultProps: { items: [] },
      render: ({ items: Items }) => <Items as="ul" className="liste" />,
    });
    const item = defineBlock<{ text: string }>({
      type: "Item",
      label: "Élément",
      fields: { text: { type: "text" } },
      defaultProps: { text: "" },
      render: ({ text }) => <li>{text}</li>,
    });
    const html = renderToStaticMarkup(
      renderPageContent(
        page({
          type: "List",
          props: { id: "l", items: [{ type: "Item", props: { id: "i", text: "Un" } }] },
        }),
        { registry: createBlockRegistry([list, item]) },
      ),
    );
    expect(html).toBe('<ul class="liste"><li>Un</li></ul>');
  });
});
