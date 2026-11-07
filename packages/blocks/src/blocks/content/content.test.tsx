import type {
  ContentReader,
  MediaView,
  PartnerView,
  PostSummaryView,
  SportReader,
} from "@sport-cms/core";
import { BLOCKS_CSS } from "@sport-cms/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createBlockRegistry } from "../../registry.js";
import { loadPageBlocks } from "../../server/load.js";
import { renderPageContent } from "../../server/render.js";
import { coreBlocks } from "../index.js";

const registry = createBlockRegistry(coreBlocks);

const photo: MediaView = {
  id: 4,
  alt: "Les U13 après leur victoire",
  variants: [
    { url: "/media/abc-400.webp", width: 400, height: 300 },
    { url: "/media/abc-800.webp", width: 800, height: 600 },
  ],
};

const post: PostSummaryView = {
  id: 1,
  slug: "victoire-des-u13",
  title: "Victoire des U13",
  excerpt: "Un beau match à domicile.",
  path: "/actualites/victoire-des-u13",
  publishedAt: new Date(2026, 10, 7, 12).getTime(),
  featured: true,
  category: { id: 2, name: "Résultats" },
  team: null,
  image: photo,
};

const partners: PartnerView[] = [
  {
    id: 1,
    name: "Boulangerie Martin",
    url: "https://boulangerie.example",
    level: "gold",
    logo: photo,
  },
  { id: 2, name: "Garage du Stade", url: "javascript:alert(1)", level: "bronze", logo: null },
];

const noSport: SportReader = {
  matches: async () => [],
  teams: async () => [],
  team: async () => null,
  trainingSlots: async () => [],
  venues: async () => [],
};

function reader(): ContentReader {
  return {
    posts: vi.fn(async () => [post]),
    post: vi.fn(async () => null),
    partners: vi.fn(async () => ({ partners, nextChange: 1_000_000 })),
    media: vi.fn(async (ids: readonly number[]) => (ids.includes(4) ? [photo] : [])),
  };
}

async function render(
  type: string,
  props: Record<string, unknown> = {},
  content: ContentReader = reader(),
  expiresAt: (date: Date) => void = () => {},
): Promise<string> {
  const data = { root: { props: {} }, content: [{ type, props: { id: `${type}-1`, ...props } }] };
  const onBlockError = vi.fn();
  const loaded = await loadPageBlocks(data, {
    registry,
    context: { sport: noSport, content, now: new Date(0), expiresAt },
    onBlockError,
  });
  const html = renderToStaticMarkup(renderPageContent(data, { registry, loaded, onBlockError }));
  expect(onBlockError).not.toHaveBeenCalled();
  return html;
}

describe("NewsList", () => {
  it("lists the latest news with their image, date, category and link", async () => {
    const content = reader();
    const html = await render("NewsList", { count: 3, categoryId: 2, featuredOnly: true }, content);
    expect(content.posts).toHaveBeenCalledWith({ limit: 3, categoryId: 2, featuredOnly: true });
    expect(html).toContain('<a href="/actualites/victoire-des-u13">Victoire des U13</a>');
    expect(html).toContain("7 novembre 2026</time> · Résultats");
    expect(html).toContain('srcSet="/media/abc-400.webp 400w, /media/abc-800.webp 800w"');
    expect(html).toContain('alt="Les U13 après leur victoire"');
    expect(html).toContain('loading="lazy"');
  });

  it("says when there is no news", async () => {
    const content = reader();
    vi.mocked(content.posts).mockResolvedValue([]);
    expect(await render("NewsList", {}, content)).toContain("Aucune actualité pour le moment.");
  });
});

describe("Partners", () => {
  it("groups the partners by level, links only safe addresses, and expires at the next change", async () => {
    const expiresAt = vi.fn();
    const html = await render("Partners", {}, reader(), expiresAt);
    expect(expiresAt).toHaveBeenCalledWith(new Date(1_000_000));
    expect(html.indexOf("Partenaires or")).toBeLessThan(html.indexOf("Partenaires bronze"));
    expect(html).toContain(
      '<a href="https://boulangerie.example" rel="sponsored noopener noreferrer">',
    );
    // The logo's alternative text is the name of the partner.
    expect(html).toContain('alt="Boulangerie Martin"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('<span class="cms-partner__name">Garage du Stade</span>');
  });

  it("shows nothing without partners", async () => {
    const content = reader();
    vi.mocked(content.partners).mockResolvedValue({ partners: [], nextChange: null });
    expect(await render("Partners", {}, content)).toBe("");
  });
});

describe("Gallery", () => {
  it("shows the images that may be shown, each once", async () => {
    const content = reader();
    const html = await render(
      "Gallery",
      {
        title: "Tournoi",
        images: [{ mediaId: 4 }, { mediaId: 4 }, { mediaId: 9 }, { mediaId: 0 }],
      },
      content,
    );
    expect(content.media).toHaveBeenCalledWith([4, 9]);
    expect(html.match(/<img /g)).toHaveLength(1);
    expect(html).toContain('<h2 class="cms-heading">Tournoi</h2>');
  });

  it("shows nothing without images", async () => {
    expect(await render("Gallery", { images: [] })).toBe("");
  });
});

describe("content blocks", () => {
  it("depend on the events that change what they show", () => {
    expect(registry.get("NewsList")?.dependsOn).toEqual([
      "post.published",
      "post.updated",
      "media.updated",
    ]);
    expect(registry.get("Partners")?.dependsOn).toEqual(["partner.updated", "media.updated"]);
    expect(registry.get("Gallery")?.dependsOn).toEqual(["media.updated"]);
  });

  it("only use classes styled by the theme", async () => {
    const html = [
      await render("NewsList"),
      await render("Partners"),
      await render("Gallery", { images: [{ mediaId: 4 }] }),
    ].join("");
    const classes = new Set(
      [...html.matchAll(/class="([^"]*)"/g)].flatMap((match) =>
        (match[1] ?? "").split(" ").filter((name) => name.startsWith("cms-")),
      ),
    );
    expect(classes.size).toBeGreaterThan(10);
    for (const className of classes) {
      expect(BLOCKS_CSS, `.${className}`).toContain(`.${className}`);
    }
  });
});
