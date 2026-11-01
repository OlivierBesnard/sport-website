import { isHexColor } from "./contrast.js";
import type { ThemeColors, ThemeTokens } from "./tokens.js";

/**
 * One family of a font stack: letters, digits, spaces and hyphens, either bare or between a pair
 * of matching quotes. No other quote may appear: an unclosed one would open a CSS string that
 * swallows the following declarations.
 */
const FONT_FAMILY = /^(?:"[\p{L}\p{N} -]+"|'[\p{L}\p{N} -]+'|[\p{L}\p{N} -]+)$/u;

/** A comma-separated list of font families, none of them empty. */
function isFontStack(value: string): boolean {
  return value.split(",").every((family) => FONT_FAMILY.test(family.trim()));
}
/** A plain CSS length: `0`, or a number in `px`, `rem` or `em`. */
const CSS_LENGTH = /^(?:0|\d+(?:\.\d+)?(?:px|rem|em))$/;

const COLOR_VARIABLES: Readonly<Record<keyof ThemeColors, string>> = {
  background: "--cms-color-background",
  surface: "--cms-color-surface",
  text: "--cms-color-text",
  textMuted: "--cms-color-text-muted",
  primary: "--cms-color-primary",
  onPrimary: "--cms-color-on-primary",
  border: "--cms-color-border",
};

/** Thrown when a token holds a value that is not allowed in a stylesheet. */
export class InvalidThemeError extends Error {
  constructor(token: string) {
    super(`Invalid theme token: ${token}`);
    this.name = "InvalidThemeError";
  }
}

/**
 * CSS custom properties of the theme, on `:root`. Every value is checked first: tokens will come
 * from the club's settings, and a value must never be able to close the declaration block.
 *
 * @throws {InvalidThemeError} when a token is not in its expected format.
 */
export function themeVariables(theme: ThemeTokens): string {
  const declarations: string[] = [];
  for (const [name, variable] of Object.entries(COLOR_VARIABLES)) {
    const value = theme.colors[name as keyof ThemeColors];
    if (!isHexColor(value)) {
      throw new InvalidThemeError(`colors.${name}`);
    }
    declarations.push(`${variable}: ${value.toLowerCase()};`);
  }
  for (const [name, value] of Object.entries(theme.fonts)) {
    if (!isFontStack(value)) {
      throw new InvalidThemeError(`fonts.${name}`);
    }
    declarations.push(`--cms-font-${name}: ${value};`);
  }
  if (!CSS_LENGTH.test(theme.radius)) {
    throw new InvalidThemeError("radius");
  }
  declarations.push(`--cms-radius: ${theme.radius};`);
  return `:root {\n${declarations.map((line) => `  ${line}`).join("\n")}\n}\n`;
}

/**
 * Base styles of the public site and of the core blocks, built on the theme variables.
 * Mobile first, a single breakpoint at 48rem; no inline style is ever needed, so the
 * Content-Security-Policy can forbid them.
 *
 * Blocks read contextual variables (`--cms-fg`, `--cms-link`, `--cms-accent-*`, `--cms-focus`),
 * which `.cms-inverse` switches for content drawn on the main color.
 */
export const BLOCKS_CSS = `
:root {
  --cms-fg: var(--cms-color-text);
  --cms-muted: var(--cms-color-text-muted);
  --cms-link: var(--cms-color-primary);
  --cms-accent-bg: var(--cms-color-primary);
  --cms-accent-fg: var(--cms-color-on-primary);
  --cms-focus: var(--cms-color-primary);
  --cms-space: clamp(2.5rem, 1.75rem + 3vw, 5rem);
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
}

body {
  margin: 0;
  background: var(--cms-color-background);
  color: var(--cms-fg);
  font-family: var(--cms-font-body);
  font-size: 1.125rem;
  line-height: 1.6;
  overflow-wrap: break-word;
}

h1,
h2,
h3,
h4,
h5,
h6 {
  margin: 0;
  font-family: var(--cms-font-heading);
  line-height: 1.2;
  text-wrap: balance;
}

h1 {
  font-size: clamp(2.25rem, 1.6rem + 3vw, 3.5rem);
}

h2 {
  font-size: clamp(1.75rem, 1.4rem + 1.5vw, 2.5rem);
}

h3 {
  font-size: 1.5rem;
}

h4 {
  font-size: 1.25rem;
}

h5,
h6 {
  font-size: 1.125rem;
}

p,
ul,
ol,
blockquote,
pre,
figure {
  margin: 0;
}

img {
  max-width: 100%;
  height: auto;
}

a {
  color: var(--cms-link);
  text-decoration-thickness: 0.08em;
  text-underline-offset: 0.15em;
}

:focus-visible {
  outline: 3px solid var(--cms-focus);
  outline-offset: 2px;
}

.cms-inverse {
  --cms-fg: var(--cms-color-on-primary);
  --cms-muted: var(--cms-color-on-primary);
  --cms-link: var(--cms-color-on-primary);
  --cms-accent-bg: var(--cms-color-on-primary);
  --cms-accent-fg: var(--cms-color-primary);
  --cms-focus: var(--cms-color-on-primary);
  background: var(--cms-color-primary);
  color: var(--cms-fg);
}

.cms-container {
  width: 100%;
  max-width: 72rem;
  margin-inline: auto;
  padding-inline: 1rem;
}

@media (min-width: 48rem) {
  .cms-container {
    padding-inline: 2rem;
  }
}

.cms-stack > * + * {
  margin-block-start: 1.5rem;
}

.cms-text-left {
  text-align: left;
}

.cms-text-center {
  text-align: center;
}

.cms-text-right {
  text-align: right;
}

.cms-text-justify {
  text-align: justify;
}

.cms-heading {
  text-wrap: balance;
}

.cms-section {
  padding-block: var(--cms-space);
}

.cms-section--muted {
  background: var(--cms-color-surface);
}

.cms-columns {
  display: grid;
  gap: 2rem;
}

@media (min-width: 48rem) {
  .cms-columns {
    grid-auto-columns: minmax(0, 1fr);
    grid-auto-flow: column;
  }

  .cms-columns--halves {
    grid-auto-flow: row;
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .cms-columns--thirds {
    grid-auto-flow: row;
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .cms-columns--quarters {
    grid-auto-flow: row;
    grid-template-columns: repeat(4, minmax(0, 1fr));
  }

  .cms-columns--one-two {
    grid-auto-flow: row;
    grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  }

  .cms-columns--two-one {
    grid-auto-flow: row;
    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  }
}

.cms-rich-text :where(p, ul, ol, blockquote, pre, hr, h2, h3, h4, h5, h6) {
  max-width: 70ch;
}

.cms-rich-text :where(p, ul, ol, blockquote, pre, hr, h2, h3, h4, h5, h6)
  + :where(p, ul, ol, blockquote, pre, hr, h2, h3, h4, h5, h6) {
  margin-block-start: 1em;
}

.cms-rich-text .cms-text-center {
  margin-inline: auto;
}

.cms-rich-text .cms-text-right {
  margin-inline-start: auto;
}

.cms-rich-text ul,
.cms-rich-text ol {
  padding-inline-start: 1.5em;
}

.cms-rich-text li > p + p {
  margin-block-start: 0.5em;
}

.cms-rich-text blockquote {
  padding-inline-start: 1rem;
  border-inline-start: 4px solid var(--cms-color-border);
  font-style: italic;
}

.cms-rich-text pre {
  overflow-x: auto;
  padding: 1rem;
  border-radius: var(--cms-radius);
  background: var(--cms-color-surface);
  color: var(--cms-color-text);
}

.cms-rich-text hr {
  border: 0;
  border-block-start: 1px solid var(--cms-color-border);
}

.cms-image img {
  display: block;
  width: 100%;
  border-radius: var(--cms-radius);
}

.cms-image figcaption {
  margin-block-start: 0.5rem;
  color: var(--cms-muted);
  font-size: 1rem;
}

.cms-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 1rem;
}

.cms-actions.cms-text-center {
  justify-content: center;
}

.cms-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 2.75rem;
  padding: 0.625rem 1.5rem;
  border: 2px solid var(--cms-accent-bg);
  border-radius: var(--cms-radius);
  font-weight: 600;
  line-height: 1.2;
  text-decoration: none;
}

.cms-button:hover {
  text-decoration: underline;
}

.cms-button--primary {
  background: var(--cms-accent-bg);
  color: var(--cms-accent-fg);
}

.cms-button--secondary {
  background: transparent;
  color: var(--cms-link);
  border-color: currentColor;
}

.cms-hero {
  padding-block: clamp(3rem, 2rem + 5vw, 6rem);
}

.cms-hero__inner {
  display: grid;
  gap: 2rem;
  align-items: center;
}

@media (min-width: 48rem) {
  .cms-hero--with-image .cms-hero__inner {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }
}

.cms-hero__title {
  font-size: clamp(2.25rem, 1.5rem + 3.5vw, 3.75rem);
}

.cms-hero__subtitle {
  max-width: 40ch;
  font-size: 1.25rem;
}

.cms-hero__image {
  display: block;
  width: 100%;
  border-radius: var(--cms-radius);
}
`;

/**
 * Complete stylesheet of the public site for a theme: its variables, then the block styles.
 *
 * @throws {InvalidThemeError} when a token is not in its expected format.
 */
export function buildThemeCss(theme: ThemeTokens): string {
  return `${themeVariables(theme)}${BLOCKS_CSS}`;
}
