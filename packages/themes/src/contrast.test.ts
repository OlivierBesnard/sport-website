import { describe, expect, it } from "vitest";
import {
  AA_TEXT_CONTRAST,
  checkThemeContrast,
  contrastRatio,
  isHexColor,
  relativeLuminance,
} from "./contrast.js";
import { defaultTheme, type ThemeTokens } from "./tokens.js";

describe("contrastRatio", () => {
  it("gives 21 for black on white and 1 for identical colors", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#0b5cad", "#0b5cad")).toBe(1);
  });

  it("matches reference values of the WCAG formula", () => {
    // #767676 is the lightest grey reaching 4.5:1 on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(AA_TEXT_CONTRAST);
  });

  it("accepts upper-case hexadecimal digits", () => {
    expect(relativeLuminance("#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("refuses anything but #rrggbb", () => {
    for (const value of ["#fff", "white", "rgb(0,0,0)", "#12345g", "#1234567", ""]) {
      expect(isHexColor(value)).toBe(false);
      expect(() => relativeLuminance(value)).toThrow(TypeError);
    }
  });
});

describe("checkThemeContrast", () => {
  it("finds no issue in the default theme: it meets WCAG 2.1 AA", () => {
    expect(checkThemeContrast(defaultTheme)).toEqual([]);
  });

  it("reaches 4.5:1 on every pairing of the default theme", () => {
    const { colors } = defaultTheme;
    const pairings: [string, string][] = [
      [colors.text, colors.background],
      [colors.text, colors.surface],
      [colors.textMuted, colors.background],
      [colors.textMuted, colors.surface],
      [colors.primary, colors.background],
      [colors.primary, colors.surface],
      [colors.onPrimary, colors.primary],
    ];
    for (const [foreground, background] of pairings) {
      expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(AA_TEXT_CONTRAST);
    }
  });

  it("reports each pairing below AA", () => {
    const pale: ThemeTokens = {
      ...defaultTheme,
      colors: { ...defaultTheme.colors, primary: "#7fb2e5", textMuted: "#999999" },
    };
    const issues = checkThemeContrast(pale);
    expect(issues.map(({ foreground, background }) => `${foreground}/${background}`)).toEqual([
      "textMuted/background",
      "textMuted/surface",
      "primary/background",
      "primary/surface",
      "onPrimary/primary",
    ]);
    for (const issue of issues) {
      expect(issue.ratio).toBeLessThan(AA_TEXT_CONTRAST);
    }
  });
});
