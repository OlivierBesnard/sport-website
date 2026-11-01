import { describe, expect, it } from "vitest";
import { safeImageUrl, safeLinkUrl } from "./url.js";

/** Values a browser would run or load as something other than a page or an image. */
const DANGEROUS = [
  "javascript:alert(1)",
  "JaVaScRiPt:alert(1)",
  " javascript:alert(1)",
  "\u0001javascript:alert(1)",
  " javascript:alert(1)",
  "java\tscript:alert(1)",
  "java\nscript:alert(1)",
  "javascript\r:alert(1)",
  "vbscript:msgbox(1)",
  "data:text/html,<script>alert(1)</script>",
  "data:image/svg+xml;base64,PHN2Zz4=",
  "file:///etc/passwd",
  "blob:https://example.com/uuid",
];

describe("safeLinkUrl", () => {
  it.each([
    "https://www.ffr.fr/",
    "http://example.com/page?x=1#y",
    "mailto:contact@club.example",
    "tel:+33123456789",
    "/le-club",
    "/équipes/u13",
    "equipes/u13",
    "#contact",
    "?saison=2026",
    "//cdn.example.com/plan.pdf",
  ])("accepts %j", (url) => {
    expect(safeLinkUrl(url)).toBe(url);
  });

  it("trims surrounding spaces and drops tabs and line breaks, as browsers do", () => {
    expect(safeLinkUrl("  /le-club \n")).toBe("/le-club");
    expect(safeLinkUrl("/le-\tclub\r\n")).toBe("/le-club");
  });

  it("refuses any backslash", () => {
    expect(safeLinkUrl("/le-club\\equipes")).toBeUndefined();
    expect(safeLinkUrl("https://club.example\\@evil.example")).toBeUndefined();
  });

  it.each(DANGEROUS)("refuses %j", (url) => {
    expect(safeLinkUrl(url)).toBeUndefined();
  });

  it("refuses empty and non-string values", () => {
    for (const value of ["", "   ", undefined, null, 42, {}, ["/"]]) {
      expect(safeLinkUrl(value)).toBeUndefined();
    }
  });
});

describe("safeImageUrl", () => {
  it.each([
    "https://images.example.com/photo.jpg",
    "HTTPS://images.example.com/photo.jpg",
    "/media/equipe.webp",
    "/",
  ])("accepts %j", (url) => {
    expect(safeImageUrl(url)).toBe(url);
  });

  it.each([
    ...DANGEROUS,
    "http://images.example.com/photo.jpg",
    "mailto:contact@club.example",
    "tel:+33123456789",
    "",
    // Relative to the current page: the browser would load a page, not an image.
    "media/logo.png",
    "./media/logo.png",
    "../media/logo.png",
    "#photo",
    "?photo=1",
    // Another host, without saying so.
    "//cdn.example.com/photo.jpg",
    "/\t/cdn.example.com/photo.jpg",
    "https:cdn.example.com/photo.jpg",
  ])("refuses %j", (url) => {
    expect(safeImageUrl(url)).toBeUndefined();
  });
});

describe("Windows UNC paths (added by the tester)", () => {
  // Chromium on Windows (Chrome, Edge) resolves an `href` or `src` that starts with two
  // backslashes as a UNC path: `\\evil.example/x` becomes `file://evil.example/x`, whatever the
  // page's own scheme (checked in the built-in browser: `new URL("\\\\evil.example/x",
  // "https://club.example/p").href === "file://evil.example/x"`). Node's WHATWG parser reads it
  // as `https://evil.example/x`, so both filters accept a value that ends up as a `file:` URL.
  const UNC = [
    "\\\\evil.example/x",
    " \\\\evil.example/x",
    "\t\\\\evil.example\\share\\photo.png",
    "\\\\evil.example\\share",
  ];

  it.each(UNC)("safeLinkUrl refuses %j", (url) => {
    expect(safeLinkUrl(url)).toBeUndefined();
  });

  it.each(UNC)("safeImageUrl refuses %j", (url) => {
    expect(safeImageUrl(url)).toBeUndefined();
  });

  it("still accepts protocol-relative and root-relative addresses", () => {
    expect(safeLinkUrl("//cdn.example.com/plan.pdf")).toBe("//cdn.example.com/plan.pdf");
    expect(safeImageUrl("/media/logo.png")).toBe("/media/logo.png");
  });
});
