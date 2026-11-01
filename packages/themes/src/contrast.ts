import type { ThemeColors, ThemeTokens } from "./tokens.js";

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Minimum contrast ratio of normal text under WCAG 2.1 AA (success criterion 1.4.3). */
export const AA_TEXT_CONTRAST = 4.5;

/** Whether `value` is a `#rrggbb` color, the only format theme colors accept. */
export function isHexColor(value: string): boolean {
  return HEX_COLOR.test(value);
}

function channelLuminance(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Relative luminance of a `#rrggbb` color, as defined by WCAG 2.1. */
export function relativeLuminance(color: string): number {
  if (!isHexColor(color)) {
    throw new TypeError(`Not a #rrggbb color: ${color}`);
  }
  const [red, green, blue] = [1, 3, 5].map((start) =>
    channelLuminance(Number.parseInt(color.slice(start, start + 2), 16)),
  ) as [number, number, number];
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

/** Contrast ratio between two `#rrggbb` colors, from 1 (identical) to 21 (black on white). */
export function contrastRatio(first: string, second: string): number {
  const [lighter, darker] = [relativeLuminance(first), relativeLuminance(second)].sort(
    (a, b) => b - a,
  ) as [number, number];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Text and background pairings drawn by the block styles: text, captions and links on the page
 * background and on highlighted sections, and text on the main color (buttons, hero, highlighted
 * sections in the main color). Focus outlines reuse these pairings.
 */
const TEXT_PAIRINGS: readonly (readonly [keyof ThemeColors, keyof ThemeColors])[] = [
  ["text", "background"],
  ["text", "surface"],
  ["textMuted", "background"],
  ["textMuted", "surface"],
  ["primary", "background"],
  ["primary", "surface"],
  ["onPrimary", "primary"],
];

export interface ContrastIssue {
  readonly foreground: keyof ThemeColors;
  readonly background: keyof ThemeColors;
  /** Ratio found, below {@link AA_TEXT_CONTRAST}. */
  readonly ratio: number;
}

/** Pairings of the theme whose contrast is below WCAG 2.1 AA; empty when the theme complies. */
export function checkThemeContrast(theme: ThemeTokens): ContrastIssue[] {
  return TEXT_PAIRINGS.flatMap(([foreground, background]) => {
    const ratio = contrastRatio(theme.colors[foreground], theme.colors[background]);
    return ratio < AA_TEXT_CONTRAST ? [{ foreground, background, ratio }] : [];
  });
}
