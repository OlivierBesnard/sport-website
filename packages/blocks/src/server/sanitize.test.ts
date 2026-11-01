import { describe, expect, it } from "vitest";
import { sanitizeRichText } from "./sanitize.js";

describe("sanitizeRichText: XSS", () => {
  it.each([
    ["a script element", "<p>Bonjour</p><script>alert(1)</script>", "<p>Bonjour</p>"],
    ["a script in upper case", "<SCRIPT>alert(1)</SCRIPT><p>x</p>", "<p>x</p>"],
    ["a style element", "<style>body{display:none}</style><p>x</p>", "<p>x</p>"],
    ["an event handler", '<p onclick="alert(1)" onmouseover="alert(2)">x</p>', "<p>x</p>"],
    ["an image with onerror", '<img src="x" onerror="alert(1)"><p>x</p>', "<p>x</p>"],
    ["an SVG with onload", '<svg onload="alert(1)"><circle /></svg><p>x</p>', "<p>x</p>"],
    ["a script inside SVG", "<svg><script>alert(1)</script></svg>", ""],
    ["an iframe", '<iframe src="https://evil.example"></iframe><p>x</p>', "<p>x</p>"],
    ["an object", '<object data="evil.swf"></object>', ""],
    ["a form", '<form action="https://evil.example"><input name="q"></form>', ""],
    ["a meta refresh", '<meta http-equiv="refresh" content="0;url=https://evil.example">', ""],
    ["a base element", '<base href="https://evil.example/">', ""],
    [
      "markup hidden in a noscript attribute",
      '<noscript><p title="</noscript><img src=x onerror=alert(1)>"></noscript>',
      "<p></p>",
    ],
  ])("removes %s", (_label, input, expected) => {
    expect(sanitizeRichText(input)).toBe(expected);
  });

  it.each([
    "javascript:alert(1)",
    "JAVASCRIPT:alert(1)",
    " javascript:alert(1)",
    "java\tscript:alert(1)",
    "&#106;avascript:alert(1)",
    "&#x6A;avascript:alert(1)",
    "jav&#x09;ascript:alert(1)",
    "vbscript:msgbox(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
  ])("removes the dangerous link address %j", (href) => {
    const output = sanitizeRichText(`<p><a href="${href}">lien</a></p>`);
    expect(output).toBe("<p><a>lien</a></p>");
  });

  // Added by the tester: Chromium on Windows resolves `\\host/path` as a UNC path, i.e.
  // `file://host/path` (see url.test.ts), so such a link must not survive sanitization.
  it.each(["\\\\evil.example/x", " \\\\evil.example/x", "\\\\evil.example\\share\\doc.pdf"])(
    "removes the UNC link address %j (tester)",
    (href) => {
      const output = sanitizeRichText(`<p><a href="${href}">lien</a></p>`);
      expect(output).toBe("<p><a>lien</a></p>");
    },
  );

  it("removes style attributes, which could load resources or hide content", () => {
    expect(sanitizeRichText('<p style="background:url(javascript:alert(1))">x</p>')).toBe(
      "<p>x</p>",
    );
    expect(sanitizeRichText('<strong style="position:fixed;inset:0">x</strong>')).toBe(
      "<strong>x</strong>",
    );
  });

  it("removes classes and identifiers that could reuse the site styles or clash with anchors", () => {
    expect(sanitizeRichText('<p class="cms-hero" id="contenu">x</p>')).toBe("<p>x</p>");
    expect(sanitizeRichText('<ul class="cms-text-center"><li>x</li></ul>')).toBe(
      "<ul><li>x</li></ul>",
    );
  });

  it("escapes text that looks like markup", () => {
    expect(sanitizeRichText("<p>1 &lt; 2 &amp;&amp; &lt;script&gt;</p>")).toBe(
      "<p>1 &lt; 2 &amp;&amp; &lt;script&gt;</p>",
    );
  });

  it("closes unclosed elements and ignores stray closing tags, as browsers do", () => {
    expect(sanitizeRichText("<p><strong>gras")).toBe("<p><strong>gras</strong></p>");
    // A lone </p> opens and closes an empty paragraph in HTML.
    expect(sanitizeRichText("</div></p>texte")).toBe("<p></p>texte");
  });
});

describe("sanitizeRichText: editor output", () => {
  it("keeps paragraphs, emphasis, lists, quotes, code and separators", () => {
    const html =
      "<p>Texte <strong>gras</strong>, <b>gras</b>, <em>italique</em>, <i>italique</i>, " +
      "<u>souligné</u>, <s>barré</s> et <code>code</code>.<br>Ligne suivante</p>" +
      "<ul><li><p>Un</p></li><li><p>Deux</p></li></ul>" +
      '<ol start="3"><li><p>Trois</p></li></ol>' +
      "<blockquote><p>Citation</p></blockquote><pre><code>bloc</code></pre><hr>";
    expect(sanitizeRichText(html)).toBe(html.replace("<br>", "<br />").replace("<hr>", "<hr />"));
  });

  it("keeps headings from level 2 and turns level 1 into level 2", () => {
    expect(sanitizeRichText("<h1>Titre</h1><h2>Deux</h2><h6>Six</h6>")).toBe(
      "<h2>Titre</h2><h2>Deux</h2><h6>Six</h6>",
    );
  });

  it("turns the editor's text alignment into a class", () => {
    expect(sanitizeRichText('<p style="text-align: center">x</p>')).toBe(
      '<p class="cms-text-center">x</p>',
    );
    expect(sanitizeRichText('<h2 style="color: red; TEXT-ALIGN:Right;">x</h2>')).toBe(
      '<h2 class="cms-text-right">x</h2>',
    );
    expect(sanitizeRichText('<h1 style="text-align: justify">x</h1>')).toBe(
      '<h2 class="cms-text-justify">x</h2>',
    );
    expect(sanitizeRichText('<p style="text-align: inherit">x</p>')).toBe("<p>x</p>");
  });

  it("keeps safe links with their title", () => {
    for (const href of [
      "https://www.ffr.fr/",
      "/le-club",
      "#contact",
      "mailto:a@b.fr",
      "tel:+33100",
    ]) {
      expect(sanitizeRichText(`<a href="${href}" title="Voir">lien</a>`)).toBe(
        `<a href="${href}" title="Voir">lien</a>`,
      );
    }
  });

  it("opens links in a new tab only without access to the opener", () => {
    expect(
      sanitizeRichText(
        '<a target="_blank" rel="noopener noreferrer nofollow" href="https://x.fr">x</a>',
      ),
    ).toBe('<a href="https://x.fr" target="_blank" rel="noopener noreferrer">x</a>');
    expect(sanitizeRichText('<a href="https://x.fr" target="_top" rel="opener">x</a>')).toBe(
      '<a href="https://x.fr">x</a>',
    );
  });

  it("keeps the text of removed elements", () => {
    expect(sanitizeRichText("<div><span>Texte</span> <font>libre</font></div>")).toBe(
      "Texte libre",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(sanitizeRichText("")).toBe("");
  });
});
