import { describe, expect, it } from "vitest";
import { BLOCKS_CSS, buildThemeCss, InvalidThemeError, themeVariables } from "./css.js";
import { defaultTheme, type ThemeTokens } from "./tokens.js";

function withTokens(overrides: Partial<ThemeTokens>): ThemeTokens {
  return { ...defaultTheme, ...overrides };
}

describe("themeVariables", () => {
  it("declares every token as a custom property on :root", () => {
    const css = themeVariables(defaultTheme);
    expect(css.startsWith(":root {\n")).toBe(true);
    expect(css).toContain("--cms-color-background: #ffffff;");
    expect(css).toContain("--cms-color-text: #1b2230;");
    expect(css).toContain("--cms-color-text-muted: #4a5568;");
    expect(css).toContain("--cms-color-primary: #0b5cad;");
    expect(css).toContain("--cms-color-on-primary: #ffffff;");
    expect(css).toContain("--cms-color-surface: #f1f4f8;");
    expect(css).toContain("--cms-color-border: #c9d2de;");
    expect(css).toContain(`--cms-font-body: ${defaultTheme.fonts.body};`);
    expect(css).toContain(`--cms-font-heading: ${defaultTheme.fonts.heading};`);
    expect(css).toContain("--cms-radius: 0.5rem;");
  });

  it("writes colors in lower case", () => {
    const css = themeVariables(
      withTokens({ colors: { ...defaultTheme.colors, primary: "#0B5CAD" } }),
    );
    expect(css).toContain("--cms-color-primary: #0b5cad;");
  });

  it.each([
    ["a color that is not #rrggbb", { colors: { ...defaultTheme.colors, primary: "red" } }],
    [
      "a color closing the declaration block",
      { colors: { ...defaultTheme.colors, text: "#000000; } body { display: none" } },
    ],
    ["a font with a semicolon", { fonts: { ...defaultTheme.fonts, body: "Arial; color: red" } }],
    ["a font with a brace", { fonts: { ...defaultTheme.fonts, heading: "Arial } * {" } }],
    ["a font with a backslash escape", { fonts: { ...defaultTheme.fonts, body: "\\7d" } }],
    ["a font with mismatched quotes", { fonts: { ...defaultTheme.fonts, body: "\"Arial'" } }],
    ["a font with a quote inside", { fonts: { ...defaultTheme.fonts, body: '"Ari"al"' } }],
    ["an empty font family", { fonts: { ...defaultTheme.fonts, body: "Arial, , serif" } }],
    ["an empty font stack", { fonts: { ...defaultTheme.fonts, heading: "" } }],
    ["a radius that is not a length", { radius: "calc(1px + 1px)" }],
    ["a radius with an expression", { radius: "1px; background: url(x)" }],
  ])("refuses %s", (_label, overrides) => {
    expect(() => themeVariables(withTokens(overrides as Partial<ThemeTokens>))).toThrow(
      InvalidThemeError,
    );
  });

  // Added by the tester: an unbalanced quote opens a CSS string that only ends at the line
  // break, swallowing the `;` and the next declaration (checked in the built-in browser with
  // `CSSStyleSheet.replaceSync`: `--cms-font-body` and `--cms-font-heading` are both lost).
  it.each([
    ["a font with an unbalanced double quote", { body: 'Arial"', heading: "Georgia" }],
    ["a font with an unbalanced single quote", { body: "'Fira Sans, Arial", heading: "Georgia" }],
  ])("refuses %s (tester)", (_label, fonts) => {
    expect(() => themeVariables(withTokens({ fonts }))).toThrow(InvalidThemeError);
  });

  it("accepts the usual radius values and font names with accents", () => {
    for (const radius of ["0", "4px", "0.75rem", "1em"]) {
      expect(() => themeVariables(withTokens({ radius }))).not.toThrow();
    }
    const fonts = {
      body: "\"Fira Sans\", 'Noto Sans', Arial, sans-serif",
      heading: "Égalité Display, serif",
    };
    expect(themeVariables(withTokens({ fonts }))).toContain(
      "--cms-font-heading: Égalité Display, serif;",
    );
  });
});

describe("buildThemeCss", () => {
  it("puts the theme variables before the block styles", () => {
    const css = buildThemeCss(defaultTheme);
    expect(css.startsWith(themeVariables(defaultTheme))).toBe(true);
    expect(css.endsWith(BLOCKS_CSS)).toBe(true);
  });

  it("styles every core block class", () => {
    for (const className of [
      ".cms-section",
      ".cms-columns",
      ".cms-columns--halves",
      ".cms-columns--thirds",
      ".cms-columns--quarters",
      ".cms-heading",
      ".cms-rich-text",
      ".cms-image",
      ".cms-button",
      ".cms-hero",
      ".cms-inverse",
      ":focus-visible",
    ]) {
      expect(BLOCKS_CSS).toContain(className);
    }
  });

  it("is responsive: columns and hero only sit side by side from 48rem", () => {
    expect(BLOCKS_CSS).toMatch(/@media \(min-width: 48rem\) \{\s*\.cms-columns \{/);
    expect(BLOCKS_CSS).toMatch(/@media \(min-width: 48rem\) \{\s*\.cms-hero--with-image/);
  });
});
