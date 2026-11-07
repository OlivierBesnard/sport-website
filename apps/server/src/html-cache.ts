import { normalizePagePath } from "@sport-cms/core";

/**
 * Taken by {@link HtmlCache.ticket} before a page is rendered: the rendered HTML is only stored
 * if nothing invalidated that page in between.
 */
export interface CacheTicket {
  readonly path: string;
  readonly epoch: number;
  readonly generation: number;
}

/**
 * Rendered HTML of the published pages, in memory, by canonical path. Only pages that exist are
 * cached (never a 404), so the cache holds at most one entry per published page.
 *
 * Whatever changes what a page shows must invalidate it: publishing or unpublishing the page
 * (`invalidate(path)`), or a change seen by every page, such as the theme or the enabled modules
 * (`clear()`).
 *
 * A render that runs while the page is invalidated must not put the stale HTML back: each path
 * has a generation, raised by `invalidate`, and `clear` starts a new epoch. A renderer takes a
 * {@link ticket} before reading the page and passes it to `set`, which drops the HTML when the
 * page was invalidated since.
 */
export class HtmlCache {
  readonly #pages = new Map<string, string>();
  /** Invalidations of each path in the current epoch (paths never invalidated are absent). */
  readonly #generations = new Map<string, number>();
  #epoch = 0;

  get(path: string): string | undefined {
    return this.#pages.get(normalizePagePath(path));
  }

  /** To take before rendering the page at `path`, then to pass to {@link set}. */
  ticket(path: string): CacheTicket {
    const canonical = normalizePagePath(path);
    return {
      path: canonical,
      epoch: this.#epoch,
      generation: this.#generations.get(canonical) ?? 0,
    };
  }

  /**
   * Stores the HTML of the page at `path`. With a ticket, only when the page was not invalidated
   * (nor the cache cleared) since the ticket was taken; returns whether the HTML was stored.
   */
  set(path: string, html: string, ticket?: CacheTicket): boolean {
    const canonical = normalizePagePath(path);
    if (
      ticket !== undefined &&
      (ticket.path !== canonical ||
        ticket.epoch !== this.#epoch ||
        ticket.generation !== (this.#generations.get(canonical) ?? 0))
    ) {
      return false;
    }
    this.#pages.set(canonical, html);
    return true;
  }

  /** Forgets the page at `path`, given in any form; returns whether it was cached. */
  invalidate(path: string): boolean {
    const canonical = normalizePagePath(path);
    this.#generations.set(canonical, (this.#generations.get(canonical) ?? 0) + 1);
    return this.#pages.delete(canonical);
  }

  /** Forgets every page; the renders in progress will not be stored. */
  clear(): void {
    this.#pages.clear();
    // A new epoch outdates every ticket, so the generations can start over (bounded memory).
    this.#generations.clear();
    this.#epoch += 1;
  }

  get size(): number {
    return this.#pages.size;
  }
}
