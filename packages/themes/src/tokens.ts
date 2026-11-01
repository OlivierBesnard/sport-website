/** Colors of a theme, each a `#rrggbb` hexadecimal value. */
export interface ThemeColors {
  /** Page background. */
  readonly background: string;
  /** Background of highlighted sections. */
  readonly surface: string;
  /** Body text and headings. */
  readonly text: string;
  /** Secondary text, such as image captions. */
  readonly textMuted: string;
  /** Main color of the club: links, buttons, hero and highlighted sections. */
  readonly primary: string;
  /** Text drawn on the main color. */
  readonly onPrimary: string;
  /** Decorative lines (separators, quotations); not used to convey information. */
  readonly border: string;
}

/** Design tokens of a theme, turned into CSS custom properties by `buildThemeCss`. */
export interface ThemeTokens {
  readonly colors: ThemeColors;
  readonly fonts: {
    /** CSS font stack of the body text. */
    readonly body: string;
    /** CSS font stack of the headings. */
    readonly heading: string;
  };
  /** Corner radius of buttons and images, as a CSS length (`0`, `0.5rem`, `6px`). */
  readonly radius: string;
}

/** System fonts: nothing to download and no request to a third-party font service. */
const SYSTEM_FONTS =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif';

/**
 * Theme used until the club chooses its own colors. Every text and background pairing it is used
 * with meets WCAG 2.1 AA (see `checkThemeContrast`).
 */
export const defaultTheme: ThemeTokens = Object.freeze({
  colors: Object.freeze({
    background: "#ffffff",
    surface: "#f1f4f8",
    text: "#1b2230",
    textMuted: "#4a5568",
    primary: "#0b5cad",
    onPrimary: "#ffffff",
    border: "#c9d2de",
  }),
  fonts: Object.freeze({ body: SYSTEM_FONTS, heading: SYSTEM_FONTS }),
  radius: "0.5rem",
});
