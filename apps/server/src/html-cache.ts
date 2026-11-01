import { normalizePagePath } from "@sport-cms/core";

/**
 * Rendered HTML of the published pages, in memory, by canonical path. Only pages that exist are
 * cached (never a 404), so the cache holds at most one entry per published page.
 *
 * Whatever changes what a page shows must invalidate it: publishing or unpublishing the page
 * (`invalidate(path)`), or a change seen by every page, such as the theme (`clear()`).
 */
export class HtmlCache {
  readonly #pages = new Map<string, string>();

  get(path: string): string | undefined {
    return this.#pages.get(normalizePagePath(path));
  }

  set(path: string, html: string): void {
    this.#pages.set(normalizePagePath(path), html);
  }

  /** Forgets the page at `path`, given in any form; returns whether it was cached. */
  invalidate(path: string): boolean {
    return this.#pages.delete(normalizePagePath(path));
  }

  /** Forgets every page. */
  clear(): void {
    this.#pages.clear();
  }

  get size(): number {
    return this.#pages.size;
  }
}
