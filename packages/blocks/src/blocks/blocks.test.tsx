import { BLOCKS_CSS } from "@sport-cms/themes";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createBlockRegistry } from "../registry.js";
import { renderPageContent } from "../server/render.js";
import { coreBlocks } from "./index.js";

const registry = createBlockRegistry(coreBlocks);

/** Renders one stored block the way the public site does. */
function renderBlock(type: string, props: Record<string, unknown> = {}): string {
  const data = { root: { props: {} }, content: [{ type, props: { id: `${type}-1`, ...props } }] };
  return renderToStaticMarkup(renderPageContent(data, { registry }));
}

function heading(text: string) {
  return { type: "Heading", props: { id: `h-${text}`, text, level: 3, align: "left" } };
}

describe("Heading", () => {
  it("renders its text at the chosen level", () => {
    expect(renderBlock("Heading", { text: "Nos équipes", level: 2, align: "left" })).toBe(
      '<h2 class="cms-heading">Nos équipes</h2>',
    );
    expect(renderBlock("Heading", { text: "Le club", level: 1, align: "center" })).toBe(
      '<h1 class="cms-heading cms-text-center">Le club</h1>',
    );
    expect(renderBlock("Heading", { text: "Détail", level: 4 })).toBe(
      '<h4 class="cms-heading">Détail</h4>',
    );
  });

  it("escapes its text", () => {
    expect(renderBlock("Heading", { text: "<script>alert(1)</script> & co" })).toBe(
      '<h2 class="cms-heading">&lt;script&gt;alert(1)&lt;/script&gt; &amp; co</h2>',
    );
  });

  it("renders nothing without text: an empty heading would break the outline", () => {
    expect(renderBlock("Heading", { text: "  " })).toBe("");
  });
});

describe("RichText", () => {
  it("renders the sanitized HTML", () => {
    expect(
      renderBlock("RichText", {
        body: '<p>Entraînement <strong>mardi</strong> : <a href="/horaires">horaires</a></p>',
      }),
    ).toBe(
      '<div class="cms-rich-text"><div><p>Entraînement <strong>mardi</strong> : ' +
        '<a href="/horaires">horaires</a></p></div></div>',
    );
  });

  it("is safe against XSS", () => {
    const html = renderBlock("RichText", {
      body:
        '<p onmouseover="alert(1)">Texte</p><img src=x onerror=alert(2)>' +
        '<a href="javascript:alert(3)">lien</a><script>alert(4)</script>' +
        '<iframe src="https://evil.example"></iframe>',
    });
    expect(html).toBe('<div class="cms-rich-text"><div><p>Texte</p><a>lien</a></div></div>');
    expect(html).not.toMatch(/alert|onerror|onmouseover|javascript|<script|<iframe|<img/i);
  });

  it("renders nothing when empty", () => {
    expect(renderBlock("RichText", { body: "" })).toBe("");
    expect(renderBlock("RichText", { body: "<script>alert(1)</script>" })).toBe("");
  });
});

describe("Image", () => {
  it("renders the image with its alternative text, lazily loaded", () => {
    expect(
      renderBlock("Image", { src: "/media/u13.jpg", alt: "L'équipe U13 au complet", caption: "" }),
    ).toBe(
      '<figure class="cms-image"><img src="/media/u13.jpg" alt="L&#x27;équipe U13 au complet" ' +
        'loading="lazy" decoding="async"/></figure>',
    );
  });

  it("adds the caption when there is one", () => {
    expect(
      renderBlock("Image", {
        src: "https://images.example.com/stade.jpg",
        alt: "Le stade",
        caption: "Stade municipal",
      }),
    ).toBe(
      '<figure class="cms-image"><img src="https://images.example.com/stade.jpg" alt="Le stade" ' +
        'loading="lazy" decoding="async"/><figcaption>Stade municipal</figcaption></figure>',
    );
  });

  it("keeps an empty alternative text for a decorative image", () => {
    expect(renderBlock("Image", { src: "/media/motif.svg" })).toContain('alt=""');
  });

  it("empties the alternative text of an informative image marked decorative", () => {
    expect(
      renderBlock("Image", { src: "/media/u13.jpg", alt: "L'équipe U13", decorative: true }),
    ).toContain('alt=""');
    expect(
      renderBlock("Image", { src: "/media/u13.jpg", alt: "L'équipe U13", decorative: false }),
    ).toContain('alt="L&#x27;équipe U13"');
  });

  it("renders nothing without a safe address", () => {
    for (const src of [
      "",
      "javascript:alert(1)",
      "data:image/png;base64,AAAA",
      "http://x.fr/a.jpg",
    ]) {
      expect(renderBlock("Image", { src, alt: "x" })).toBe("");
    }
  });
});

describe("Button", () => {
  it("renders a link styled as a button", () => {
    expect(
      renderBlock("Button", {
        label: "Nous rejoindre",
        href: "/inscription",
        variant: "primary",
        align: "left",
      }),
    ).toBe(
      '<div class="cms-actions"><a class="cms-button cms-button--primary" href="/inscription">' +
        "Nous rejoindre</a></div>",
    );
  });

  it("supports the secondary style, centering, mailto: and tel:", () => {
    expect(
      renderBlock("Button", {
        label: "Écrire",
        href: "mailto:contact@club.example",
        variant: "secondary",
        align: "center",
      }),
    ).toBe(
      '<div class="cms-actions cms-text-center"><a class="cms-button cms-button--secondary" ' +
        'href="mailto:contact@club.example">Écrire</a></div>',
    );
    expect(renderBlock("Button", { label: "Appeler", href: "tel:+33100000000" })).toContain(
      'href="tel:+33100000000"',
    );
  });

  it("renders nothing with a dangerous address or without text", () => {
    expect(renderBlock("Button", { label: "Piège", href: "javascript:alert(1)" })).toBe("");
    expect(renderBlock("Button", { label: "Piège", href: " JAVASCRIPT:alert(1)" })).toBe("");
    expect(renderBlock("Button", { label: "", href: "/club" })).toBe("");
  });

  it("only uses a known style as class name", () => {
    expect(
      renderBlock("Button", { label: "x", href: "/", variant: 'primary" onclick="alert(1)' }),
    ).toContain('class="cms-button cms-button--primary"');
  });
});

describe("Hero", () => {
  it("renders the title as the level 1 heading, the text and the call to action", () => {
    expect(
      renderBlock("Hero", {
        title: "US Exemple",
        subtitle: "Rugby à XV depuis 1920",
        imageSrc: "",
        imageAlt: "",
        ctaLabel: "Nous rejoindre",
        ctaHref: "/le-club",
      }),
    ).toBe(
      '<section class="cms-hero cms-inverse"><div class="cms-container cms-hero__inner">' +
        '<div class="cms-stack"><h1 class="cms-hero__title">US Exemple</h1>' +
        '<p class="cms-hero__subtitle">Rugby à XV depuis 1920</p><div class="cms-actions">' +
        '<a class="cms-button cms-button--primary" href="/le-club">Nous rejoindre</a></div>' +
        "</div></div></section>",
    );
  });

  it("adds the image beside the text", () => {
    const html = renderBlock("Hero", {
      title: "US Exemple",
      imageSrc: "/media/hero.jpg",
      imageAlt: "Mêlée au stade",
    });
    expect(html).toContain('class="cms-hero cms-inverse cms-hero--with-image"');
    expect(html).toContain(
      '<img class="cms-hero__image" src="/media/hero.jpg" alt="Mêlée au stade"/>',
    );
  });

  it("empties the alternative text of the image marked decorative", () => {
    expect(
      renderBlock("Hero", {
        title: "US Exemple",
        imageSrc: "/media/hero.jpg",
        imageAlt: "Mêlée au stade",
        decorative: true,
      }),
    ).toContain('alt=""');
  });

  it("leaves out empty parts and unsafe addresses", () => {
    const html = renderBlock("Hero", {
      title: "",
      subtitle: "Saison 2026",
      imageSrc: "javascript:alert(1)",
      ctaLabel: "Cliquez",
      ctaHref: "javascript:alert(2)",
    });
    expect(html).toBe(
      '<section class="cms-hero cms-inverse"><div class="cms-container cms-hero__inner">' +
        '<div class="cms-stack"><p class="cms-hero__subtitle">Saison 2026</p></div></div></section>',
    );
  });

  it("renders nothing when it has nothing to show", () => {
    expect(renderBlock("Hero")).toBe("");
    expect(renderBlock("Hero", { title: " ", ctaLabel: "Go", ctaHref: "javascript:x" })).toBe("");
  });
});

describe("Section", () => {
  it("renders its blocks in a container", () => {
    expect(
      renderBlock("Section", { background: "default", content: [heading("Un"), heading("Deux")] }),
    ).toBe(
      '<section class="cms-section"><div class="cms-container cms-stack">' +
        '<h3 class="cms-heading">Un</h3><h3 class="cms-heading">Deux</h3></div></section>',
    );
  });

  it("supports a tinted background and the club color", () => {
    expect(renderBlock("Section", { background: "muted" })).toBe(
      '<section class="cms-section cms-section--muted"><div class="cms-container cms-stack"></div></section>',
    );
    expect(renderBlock("Section", { background: "primary" })).toBe(
      '<section class="cms-section cms-inverse"><div class="cms-container cms-stack"></div></section>',
    );
  });
});

describe("Columns", () => {
  it("renders two equal columns by default", () => {
    expect(
      renderBlock("Columns", { first: [heading("Gauche")], second: [heading("Droite")] }),
    ).toBe(
      '<div class="cms-columns cms-columns--halves">' +
        '<div class="cms-stack"><h3 class="cms-heading">Gauche</h3></div>' +
        '<div class="cms-stack"><h3 class="cms-heading">Droite</h3></div></div>',
    );
  });

  it("renders as many columns as the layout has", () => {
    const columns = {
      first: [heading("1")],
      second: [heading("2")],
      third: [heading("3")],
      fourth: [heading("4")],
    };
    const count = (html: string) => html.match(/class="cms-stack"/g)?.length;
    expect(count(renderBlock("Columns", { ...columns, layout: "halves" }))).toBe(2);
    expect(count(renderBlock("Columns", { ...columns, layout: "thirds" }))).toBe(3);
    expect(count(renderBlock("Columns", { ...columns, layout: "quarters" }))).toBe(4);
    expect(count(renderBlock("Columns", { ...columns, layout: "one-two" }))).toBe(2);
    const twoOne = renderBlock("Columns", { ...columns, layout: "two-one" });
    expect(twoOne).toContain('class="cms-columns cms-columns--two-one"');
    expect(twoOne).not.toContain(">3<");
  });

  it("keeps empty columns in place", () => {
    expect(renderBlock("Columns", { layout: "halves", second: [heading("Droite")] })).toBe(
      '<div class="cms-columns cms-columns--halves"><div class="cms-stack"></div>' +
        '<div class="cms-stack"><h3 class="cms-heading">Droite</h3></div></div>',
    );
  });
});

describe("block classes", () => {
  it("only uses cms-* classes that the theme stylesheet defines", () => {
    // One rendered sample per block, rich enough to light up every class it can emit.
    const samples: Record<string, Record<string, unknown>> = {
      Section: { background: "muted" },
      Columns: { layout: "quarters" },
      Heading: { text: "Titre", level: 1, align: "center" },
      RichText: { body: '<p class="cms-text-right">Texte</p>' },
      Image: { src: "/media/photo.jpg", alt: "Photo", caption: "Légende" },
      Button: { label: "Nous rejoindre", href: "/contact", variant: "primary", align: "center" },
      Hero: {
        title: "Club",
        subtitle: "Bienvenue",
        imageSrc: "/media/hero.jpg",
        imageAlt: "Photo",
        ctaLabel: "Nous rejoindre",
        ctaHref: "/contact",
      },
    };
    const classes = new Set<string>();
    for (const [type, props] of Object.entries(samples)) {
      const html = renderBlock(type, props);
      for (const attribute of html.matchAll(/class="([^"]*)"/g)) {
        const list = attribute[1];
        if (list === undefined) {
          continue;
        }
        for (const className of list.split(" ")) {
          if (className.startsWith("cms-")) {
            classes.add(className);
          }
        }
      }
    }
    // The samples really did render the blocks: their main classes are there.
    expect([...classes]).toEqual(
      expect.arrayContaining([
        "cms-section",
        "cms-columns",
        "cms-heading",
        "cms-rich-text",
        "cms-image",
        "cms-button",
        "cms-hero",
      ]),
    );
    for (const className of classes) {
      expect(BLOCKS_CSS, `.${className} is rendered but has no rule in BLOCKS_CSS`).toContain(
        `.${className}`,
      );
    }
  });
});
