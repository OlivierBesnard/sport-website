/** Control characters (category Cc: C0, DEL, C1) never belong in a path and could forge log lines. */
const CONTROL_CHARACTERS = /\p{Cc}/gu;

/**
 * Canonical form of a page path, the one stored in `pages.path` and served by the public site:
 * Unicode NFC without control characters (C0, DEL, C1: tab, line breaks…, dropped the way
 * browsers drop them from a URL), a single leading slash, no empty segment (so no repeated
 * slash), no trailing slash except for the home page `/`, and no `.` or `..` segment: they are
 * resolved as browsers do
 * (`/a/./b` is `/a/b`, `/a/../b` is `/b`, and `..` never goes above `/`). Case is kept: paths are
 * case-sensitive.
 *
 * Applied to the decoded path of every request (variants are redirected to the canonical form)
 * and to every path written by the back-office, so that both always agree. The absence of
 * control characters also keeps page paths safe to put in log lines.
 *
 * @example normalizePagePath("equipes//U13/") // "/equipes/U13"
 * @example normalizePagePath("/equipes/../club") // "/club"
 * @example normalizePagePath("/a\tb") // "/ab"
 * @example normalizePagePath("") // "/"
 */
export function normalizePagePath(path: string): string {
  const segments: string[] = [];
  for (const segment of path.normalize("NFC").replace(CONTROL_CHARACTERS, "").split("/")) {
    if (segment === "" || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return `/${segments.join("/")}`;
}

/**
 * Percent-encodes each segment of a canonical page path, for an `href` or a `Location` header.
 * Every character that could change how the path is read (`?`, `#`, `%`, `\`) is encoded, so the
 * result can never be taken for a query, a fragment or another host (`//host`, `/\host`).
 *
 * @example encodePagePath("/équipes/u13") // "/%C3%A9quipes/u13"
 */
export function encodePagePath(path: string): string {
  const segments = path.split("/").filter((segment) => segment !== "");
  return `/${segments.map(encodeURIComponent).join("/")}`;
}
