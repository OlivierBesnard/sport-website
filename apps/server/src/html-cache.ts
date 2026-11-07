import { normalizePagePath } from "@sport-cms/core";

/**
 * Taken by {@link HtmlCache.ticket} before a page is rendered: the rendered HTML is only stored
 * if nothing invalidated that page in between.
 */
export interface CacheTicket {
  readonly path: string;
  readonly epoch: number;
  readonly generation: number;
  /** Count of the dependency invalidations when the ticket was taken. */
  readonly dependencies: number;
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
 *
 * A page can also depend on events (`dependsOn` of its blocks: `match.result_published`…): `set`
 * records them, and `invalidateDependency(type)` forgets every page that depends on it — and
 * any render of such a page in progress, by the same tickets. And it can depend on time (the
 * next match is no longer upcoming once it has started): `set` takes the date until which the
 * HTML is right, after which `get` no longer returns it.
 */
export class HtmlCache {
  readonly #pages = new Map<string, string>();
  /** Date (epoch milliseconds) after which a page must be rendered again, when it has one. */
  readonly #expiries = new Map<string, number>();
  readonly #now: () => number;
  /** Invalidations of each path in the current epoch (paths never invalidated are absent). */
  readonly #generations = new Map<string, number>();
  /** Pages cached with each dependency, and the dependencies of each cached page. */
  readonly #dependents = new Map<string, Set<string>>();
  readonly #dependencies = new Map<string, ReadonlySet<string>>();
  /** Invalidations by dependency so far, and the count at the last one of each dependency. */
  #dependencyInvalidations = 0;
  readonly #invalidatedAt = new Map<string, number>();
  #epoch = 0;

  constructor(options: { readonly now?: () => number } = {}) {
    this.#now = options.now ?? Date.now;
  }

  get(path: string): string | undefined {
    const canonical = normalizePagePath(path);
    const expiry = this.#expiries.get(canonical);
    if (expiry !== undefined && this.#now() >= expiry) {
      // Out of date: forgotten like an invalidation, so a render in progress is not stored.
      this.invalidate(canonical);
      return undefined;
    }
    return this.#pages.get(canonical);
  }

  /** To take before rendering the page at `path`, then to pass to {@link set}. */
  ticket(path: string): CacheTicket {
    const canonical = normalizePagePath(path);
    return {
      path: canonical,
      epoch: this.#epoch,
      generation: this.#generations.get(canonical) ?? 0,
      dependencies: this.#dependencyInvalidations,
    };
  }

  /**
   * Stores the HTML of the page at `path`. With a ticket, only when the page was not invalidated
   * (nor the cache cleared) since the ticket was taken; returns whether the HTML was stored.
   */
  set(
    path: string,
    html: string,
    ticket?: CacheTicket,
    dependencies: Iterable<string> = [],
    expiresAt?: number,
  ): boolean {
    const canonical = normalizePagePath(path);
    const depends = new Set(dependencies);
    if (
      ticket !== undefined &&
      (ticket.path !== canonical ||
        ticket.epoch !== this.#epoch ||
        ticket.generation !== (this.#generations.get(canonical) ?? 0) ||
        [...depends].some(
          (dependency) => (this.#invalidatedAt.get(dependency) ?? 0) > ticket.dependencies,
        ))
    ) {
      return false;
    }
    this.#forgetDependencies(canonical);
    this.#pages.set(canonical, html);
    if (expiresAt === undefined) {
      this.#expiries.delete(canonical);
    } else {
      this.#expiries.set(canonical, expiresAt);
    }
    if (depends.size > 0) {
      this.#dependencies.set(canonical, depends);
      for (const dependency of depends) {
        let pages = this.#dependents.get(dependency);
        if (pages === undefined) {
          pages = new Set();
          this.#dependents.set(dependency, pages);
        }
        pages.add(canonical);
      }
    }
    return true;
  }

  #forgetDependencies(canonical: string): void {
    for (const dependency of this.#dependencies.get(canonical) ?? []) {
      const pages = this.#dependents.get(dependency);
      pages?.delete(canonical);
      if (pages?.size === 0) {
        this.#dependents.delete(dependency);
      }
    }
    this.#dependencies.delete(canonical);
  }

  /** Forgets the page at `path`, given in any form; returns whether it was cached. */
  invalidate(path: string): boolean {
    const canonical = normalizePagePath(path);
    this.#generations.set(canonical, (this.#generations.get(canonical) ?? 0) + 1);
    this.#forgetDependencies(canonical);
    this.#expiries.delete(canonical);
    return this.#pages.delete(canonical);
  }

  /**
   * Forgets every page that depends on `dependency` (an event type), and outdates the renders
   * in progress that would record it; returns how many pages were forgotten.
   */
  invalidateDependency(dependency: string): number {
    this.#dependencyInvalidations += 1;
    this.#invalidatedAt.set(dependency, this.#dependencyInvalidations);
    const pages = [...(this.#dependents.get(dependency) ?? [])];
    for (const page of pages) {
      this.invalidate(page);
    }
    return pages.length;
  }

  /** Forgets every page; the renders in progress will not be stored. */
  clear(): void {
    this.#pages.clear();
    this.#expiries.clear();
    // A new epoch outdates every ticket, so the generations can start over (bounded memory).
    this.#generations.clear();
    this.#dependents.clear();
    this.#dependencies.clear();
    this.#invalidatedAt.clear();
    this.#epoch += 1;
  }

  get size(): number {
    return this.#pages.size;
  }
}
