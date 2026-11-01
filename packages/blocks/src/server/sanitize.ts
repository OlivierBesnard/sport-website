import sanitizeHtml from "sanitize-html";
import { safeLinkUrl } from "../url.js";

/** Alignments of the editor (Tiptap writes them as `style="text-align: …"`). */
const ALIGNMENT_CLASSES = [
  "cms-text-left",
  "cms-text-center",
  "cms-text-right",
  "cms-text-justify",
];
const TEXT_ALIGN = /(?:^|;)\s*text-align\s*:\s*(left|center|right|justify)\s*(?:;|$)/i;

const ALIGNABLE_TAGS = ["p", "h2", "h3", "h4", "h5", "h6"];

/**
 * Keeps a block element and turns its alignment into a class: the Content-Security-Policy
 * forbids `style` attributes. Every other attribute of the element is dropped.
 */
function alignable(tagName: string): sanitizeHtml.Transformer {
  return (_tagName, attribs) => {
    const alignment = TEXT_ALIGN.exec(attribs.style ?? "")?.[1]?.toLowerCase();
    const kept: sanitizeHtml.Attributes = {};
    if (alignment !== undefined) {
      kept.class = `cms-text-${alignment}`;
    }
    return { tagName, attribs: kept };
  };
}

/**
 * Keeps only the address and title of a link; a new tab never gets access to the opener. The
 * address goes through the same filter as the blocks' links (`safeLinkUrl`), which also refuses
 * what sanitize-html lets through as protocol-relative, such as the UNC path `\\host/path`.
 */
const link: sanitizeHtml.Transformer = (tagName, attribs) => {
  const kept: sanitizeHtml.Attributes = {};
  const href = safeLinkUrl(attribs.href);
  if (href !== undefined) {
    kept.href = href;
  }
  if (attribs.title !== undefined) {
    kept.title = attribs.title;
  }
  if (attribs.target === "_blank") {
    kept.target = "_blank";
    kept.rel = "noopener noreferrer";
  }
  return { tagName, attribs: kept };
};

/**
 * Allow-list of the rich text editor's output. Any other element is removed (its text is kept,
 * except for `script`, `style` and the like, removed with their content); any other attribute is
 * removed; links only keep `http:`, `https:`, `mailto:`, `tel:` and relative addresses.
 */
const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    ...ALIGNABLE_TAGS,
    "br",
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "code",
    "pre",
    "blockquote",
    "ul",
    "ol",
    "li",
    "hr",
    "a",
  ],
  // `href` is the only URL attribute kept (no element with `src` or `cite` is allowed); an
  // element added later with an image `src` must filter it with `safeImageUrl` in a transformer.
  allowedAttributes: { a: ["href", "title", "target", "rel"], ol: ["start"] },
  allowedClasses: Object.fromEntries(ALIGNABLE_TAGS.map((tag) => [tag, ALIGNMENT_CLASSES])),
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesByTag: {},
  allowedSchemesAppliedToAttributes: ["href"],
  allowProtocolRelative: true,
  disallowedTagsMode: "discard",
  transformTags: {
    // Level 1 belongs to the page title (Hero, Heading): rich text headings start at level 2.
    h1: alignable("h2"),
    ...Object.fromEntries(ALIGNABLE_TAGS.map((tag) => [tag, alignable(tag)])),
    a: link,
  },
};

/**
 * Sanitizes the HTML of a rich text field before it is sent to a visitor, with `sanitize-html`
 * and an allow-list of elements and attributes (formatting, lists, quotes, links). Whatever the
 * input, the result holds no script, event handler, style, embedded content or dangerous URL.
 */
export function sanitizeRichText(html: string): string {
  return sanitizeHtml(html, OPTIONS);
}
