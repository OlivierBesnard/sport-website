import type { SportReader } from "@sport-cms/core";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { coreBlocks } from "../blocks/index.js";
import { createBlockRegistry } from "../registry.js";
import { type BlockLoaderContext, defineBlock } from "../types.js";
import { BlockLoaderTimeoutError, loadPageBlocks } from "./load.js";
import { BlockDataMissingError, renderPageContent } from "./render.js";

const noSport: SportReader = {
  matches: async () => [],
  teams: async () => [],
  team: async () => null,
  trainingSlots: async () => [],
  venues: async () => [],
};

function context(overrides: Partial<BlockLoaderContext> = {}): BlockLoaderContext {
  return { sport: noSport, now: new Date(0), expiresAt: () => {}, ...overrides };
}

const counter = defineBlock<{ label: string }, string>({
  type: "Counter",
  label: "Compteur",
  fields: { label: { type: "text" } },
  defaultProps: { label: "par défaut" },
  loader: async ({ label }) => `chargé : ${label}`,
  render: ({ data }) => <p>{data}</p>,
});

const broken = defineBlock<Record<string, never>, string>({
  type: "Broken",
  label: "Cassé",
  fields: {},
  defaultProps: {},
  loader: async () => {
    throw new Error("service indisponible");
  },
  render: ({ data }) => <p>{data}</p>,
});

const slow = defineBlock<Record<string, never>, string>({
  type: "Slow",
  label: "Lent",
  fields: {},
  defaultProps: {},
  loader: () => new Promise<string>(() => {}),
  render: ({ data }) => <p>{data}</p>,
});

const registry = createBlockRegistry([...coreBlocks, counter, broken, slow]);

function page(...content: unknown[]) {
  return { root: { props: {} }, content };
}

function section(id: string, ...content: unknown[]) {
  return { type: "Section", props: { id, background: "default", content } };
}

describe("loadPageBlocks", () => {
  it("loads every block with a loader, nested ones included, with props checked first", async () => {
    const data = page(
      { type: "Counter", props: { id: "a", label: "accueil" } },
      section("s", { type: "Counter", props: { id: "b", label: 42 } }),
    );
    const loaded = await loadPageBlocks(data, { registry, context: context() });
    const html = renderToStaticMarkup(renderPageContent(data, { registry, loaded }));
    expect(html).toContain("<p>chargé : accueil</p>");
    // An invalid stored value reaches the loader as the default, like `render`.
    expect(html).toContain("<p>chargé : par défaut</p>");
  });

  it("gives two blocks sharing an id their own data", async () => {
    const data = page(
      { type: "Counter", props: { id: "same", label: "un" } },
      { type: "Counter", props: { id: "same", label: "deux" } },
    );
    const loaded = await loadPageBlocks(data, { registry, context: context() });
    expect(renderToStaticMarkup(renderPageContent(data, { registry, loaded }))).toBe(
      "<p>chargé : un</p><p>chargé : deux</p>",
    );
  });

  it("leaves out a block whose loader fails or hangs, and reports it once", async () => {
    const onBlockError = vi.fn();
    const data = page(
      { type: "Broken", props: { id: "x" } },
      { type: "Slow", props: { id: "y" } },
      { type: "Counter", props: { id: "z", label: "reste" } },
    );
    const loaded = await loadPageBlocks(data, {
      registry,
      context: context(),
      onBlockError,
      timeoutMs: 20,
    });
    const renderErrors = vi.fn();
    expect(
      renderToStaticMarkup(
        renderPageContent(data, { registry, loaded, onBlockError: renderErrors }),
      ),
    ).toBe("<p>chargé : reste</p>");
    expect(onBlockError).toHaveBeenCalledTimes(2);
    expect(onBlockError).toHaveBeenCalledWith(
      expect.objectContaining({ message: "service indisponible" }),
      {
        type: "Broken",
        id: "x",
      },
    );
    expect(onBlockError).toHaveBeenCalledWith(expect.any(BlockLoaderTimeoutError), {
      type: "Slow",
      id: "y",
    });
    // Already reported while loading: the render does not report it again.
    expect(renderErrors).not.toHaveBeenCalled();
  });

  it("skips the blocks of unknown types, with their nested blocks", async () => {
    const loader = vi.spyOn(counter, "loader");
    await loadPageBlocks(
      page({
        type: "Inconnu",
        props: { id: "u", content: [{ type: "Counter", props: { id: "c" } }] },
      }),
      { registry, context: context() },
    );
    expect(loader).not.toHaveBeenCalled();
    loader.mockRestore();
  });

  it("hands the context to the loaders", async () => {
    const expiresAt = vi.fn();
    const timed = defineBlock<Record<string, never>, null>({
      type: "Timed",
      label: "Daté",
      fields: {},
      defaultProps: {},
      loader: async (_props, loaderContext) => {
        loaderContext.expiresAt(new Date(loaderContext.now.getTime() + 1000));
        return null;
      },
      render: () => null,
    });
    await loadPageBlocks(page({ type: "Timed", props: { id: "t" } }), {
      registry: createBlockRegistry([timed]),
      context: context({ now: new Date(5000), expiresAt }),
    });
    expect(expiresAt).toHaveBeenCalledWith(new Date(6000));
  });
});

describe("renderPageContent without loaded data", () => {
  it("leaves out the blocks that need data, and says why", () => {
    const onBlockError = vi.fn();
    expect(
      renderToStaticMarkup(
        renderPageContent(page({ type: "Counter", props: { id: "c" } }), {
          registry,
          onBlockError,
        }),
      ),
    ).toBe("");
    expect(onBlockError).toHaveBeenCalledWith(expect.any(BlockDataMissingError), {
      type: "Counter",
      id: "c",
    });
  });
});
