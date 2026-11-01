/**
 * Base used to resolve relative URLs. Only its protocol matters: a relative URL inherits it, so
 * it is accepted wherever `https:` is.
 */
const RELATIVE_BASE = "https://relative.invalid/";

const LINK_PROTOCOLS: ReadonlySet<string> = new Set(["http:", "https:", "mailto:", "tel:"]);
const IMAGE_PROTOCOLS: ReadonlySet<string> = new Set(["https:"]);

/** Browsers drop tabs and line breaks anywhere in a URL. */
const TAB_OR_LINE_BREAK = /[\t\n\r]/g;
/** An absolute `https:` URL. */
const HTTPS_URL = /^https:\/\//i;
/** A path from the root of the site: one slash, never two (`//host` is another site). */
const ROOT_PATH = /^\/(?!\/)/;

/**
 * Parses `value` the way a browser parses an `href` or `src` (WHATWG URL: tabs and line breaks
 * removed, surrounding spaces ignored, scheme case-insensitive), then keeps it only if its
 * protocol is allowed. Returns the value the browser will actually use.
 *
 * Any backslash is refused: Chromium on Windows reads `\\host/path` as a UNC path, that is
 * `file://host/path`, while the WHATWG parser reads it as `https://host/path`.
 */
function allowedUrl(value: unknown, protocols: ReadonlySet<string>): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const candidate = value.replace(TAB_OR_LINE_BREAK, "").trim();
  if (candidate === "" || candidate.includes("\\")) {
    return undefined;
  }
  let url: URL;
  try {
    // Not `URL.parse`: this module also runs in the editor, and Safari only has it since 18.
    url = new URL(candidate, RELATIVE_BASE);
  } catch {
    return undefined;
  }
  return protocols.has(url.protocol) ? candidate : undefined;
}

/**
 * URL a link or a button may point to: `http:`, `https:`, `mailto:`, `tel:`, or a relative URL
 * (`/le-club`, `#contact`, `//cdn.example/plan.pdf`). Anything else (`javascript:`, `data:`,
 * `vbscript:`, a UNC path…) gives `undefined`, and the block leaves the link out.
 */
export function safeLinkUrl(value: unknown): string | undefined {
  return allowedUrl(value, LINK_PROTOCOLS);
}

/**
 * URL an image may be loaded from, among the sources the Content-Security-Policy of the site
 * allows: an absolute `https://` URL, or a path from the root of the site (`/media/photo.jpg`).
 * Anything else gives `undefined`, including `//host/…`, `#…` and paths without a leading slash,
 * which the browser would resolve against the current page.
 */
export function safeImageUrl(value: unknown): string | undefined {
  const url = allowedUrl(value, IMAGE_PROTOCOLS);
  return url !== undefined && (HTTPS_URL.test(url) || ROOT_PATH.test(url)) ? url : undefined;
}
