import { coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import { buildThemeCss, defaultTheme } from "@sport-cms/themes";
import { describe, expect, it } from "vitest";
import {
  buildEditorConfig,
  editorProps,
  injectStylesheet,
  THEME_STYLE_ATTRIBUTE,
} from "./puck-config";

/**
 * The stylesheet of the public site in the canvas of the editor. The tests run without a DOM:
 * a small stand-in of `Document` records what the editor does to the head of the canvas.
 */

interface FakeElement {
  readonly tagName: string;
  readonly attributes: Map<string, string>;
  textContent: string | null;
  setAttribute(name: string, value: string): void;
  remove(): void;
}

function fakeDocument() {
  const head: FakeElement[] = [];
  const document = {
    createElement(tagName: string): FakeElement {
      const element: FakeElement = {
        tagName,
        attributes: new Map(),
        textContent: null,
        setAttribute(name, value) {
          element.attributes.set(name, value);
        },
        remove() {
          const index = head.indexOf(element);
          if (index !== -1) {
            head.splice(index, 1);
          }
        },
      };
      return element;
    },
    head: {
      appendChild(element: FakeElement) {
        head.push(element);
        return element;
      },
      querySelectorAll(selector: string): FakeElement[] {
        expect(selector).toBe(`style[${THEME_STYLE_ATTRIBUTE}]`);
        return head.filter(
          (element) => element.tagName === "style" && element.attributes.has(THEME_STYLE_ATTRIBUTE),
        );
      },
    },
  };
  return { document: document as unknown as Document, head };
}

describe("injectStylesheet", () => {
  it("adds the stylesheet of the site to the head of the canvas, and takes it out", () => {
    const { document, head } = fakeDocument();
    const css = buildThemeCss(defaultTheme);
    const remove = injectStylesheet(document, css);
    expect(head).toHaveLength(1);
    expect(head[0]?.tagName).toBe("style");
    expect(head[0]?.textContent).toBe(css);
    expect(head[0]?.textContent).toContain(".cms-hero");
    remove();
    expect(head).toHaveLength(0);
  });

  it("replaces a stylesheet already there instead of piling them up", () => {
    const { document, head } = fakeDocument();
    injectStylesheet(document, "body { color: red; }");
    injectStylesheet(document, "body { color: blue; }");
    expect(head).toHaveLength(1);
    expect(head[0]?.textContent).toBe("body { color: blue; }");
  });
});

describe("buildEditorConfig and the canvas", () => {
  it("overrides the canvas of Puck, keeping the clickable drawer items", () => {
    const overrides = buildEditorConfig(createBlockRegistry(coreBlocks)).overrides as Record<
      string,
      unknown
    >;
    expect(typeof overrides.iframe).toBe("function");
    expect(typeof overrides.drawerItem).toBe("function");
  });
});

describe("editorProps", () => {
  const registry = createBlockRegistry(coreBlocks);

  it("fills missing or invalid values with the defaults, like the public renderer", () => {
    const heading = registry.get("Heading");
    if (heading === undefined) {
      throw new Error("Bloc Titre absent.");
    }
    const props = editorProps(heading, { id: "h1", level: 9, text: 42 });
    expect(props.id).toBe("h1");
    expect(props.level).toBe(heading.defaultProps.level);
    expect(props.text).toBe(heading.defaultProps.text);
  });

  it("keeps the slots and the rich texts as Puck hands them over", () => {
    const section = registry.get("Section");
    const richText = registry.get("RichText");
    if (section === undefined || richText === undefined) {
      throw new Error("Blocs absents.");
    }
    const slot = () => null;
    expect(editorProps(section, { id: "s1", content: slot }).content).toBe(slot);
    const node = { editable: true };
    expect(editorProps(richText, { id: "r1", body: node }).body).toBe(node);
  });
});
