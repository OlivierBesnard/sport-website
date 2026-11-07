import { describe, expect, it } from "vitest";
import { HtmlCache } from "./html-cache.js";

describe("HtmlCache", () => {
  it("stores and returns pages by path", () => {
    const cache = new HtmlCache();
    expect(cache.get("/club")).toBeUndefined();
    cache.set("/club", "<p>club</p>");
    expect(cache.get("/club")).toBe("<p>club</p>");
    expect(cache.size).toBe(1);
  });

  it("uses the canonical form of paths as keys", () => {
    const cache = new HtmlCache();
    cache.set("/équipes/", "<p>équipes</p>");
    expect(cache.get("/équipes")).toBe("<p>équipes</p>");
    expect(cache.get("équipes//")).toBe("<p>équipes</p>");
    expect(cache.size).toBe(1);
  });

  it("keeps paths case-sensitive", () => {
    const cache = new HtmlCache();
    cache.set("/Club", "majuscule");
    expect(cache.get("/club")).toBeUndefined();
  });

  it("invalidates one path and says whether it was cached", () => {
    const cache = new HtmlCache();
    cache.set("/a", "a");
    cache.set("/b", "b");
    expect(cache.invalidate("/a/")).toBe(true);
    expect(cache.invalidate("/a")).toBe(false);
    expect(cache.get("/a")).toBeUndefined();
    expect(cache.get("/b")).toBe("b");
  });

  it("clears every path", () => {
    const cache = new HtmlCache();
    cache.set("/", "accueil");
    cache.set("/club", "club");
    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.get("/")).toBeUndefined();
  });

  describe("tickets", () => {
    it("store the HTML of a render when nothing changed meanwhile", () => {
      const cache = new HtmlCache();
      const ticket = cache.ticket("/club/");
      expect(cache.set("/club", "club", ticket)).toBe(true);
      expect(cache.get("/club")).toBe("club");
    });

    it("drop the HTML of a render started before the page was invalidated", () => {
      const cache = new HtmlCache();
      const ticket = cache.ticket("/club");
      cache.invalidate("/club");
      expect(cache.set("/club", "périmé", ticket)).toBe(false);
      expect(cache.get("/club")).toBeUndefined();
      // A render started after the invalidation is stored.
      expect(cache.set("/club", "à jour", cache.ticket("/club"))).toBe(true);
    });

    it("drop the HTML of a render started before the cache was cleared", () => {
      const cache = new HtmlCache();
      const ticket = cache.ticket("/club");
      cache.invalidate("/club");
      const later = cache.ticket("/club");
      cache.clear();
      expect(cache.set("/club", "périmé", ticket)).toBe(false);
      expect(cache.set("/club", "périmé", later)).toBe(false);
      expect(cache.size).toBe(0);
    });

    it("are not affected by the invalidation of another page", () => {
      const cache = new HtmlCache();
      const ticket = cache.ticket("/club");
      cache.invalidate("/equipes");
      expect(cache.set("/club", "club", ticket)).toBe(true);
    });

    it("only fit the page they were taken for", () => {
      const cache = new HtmlCache();
      expect(cache.set("/b", "b", cache.ticket("/a"))).toBe(false);
    });
  });

  describe("dependencies on events", () => {
    it("forgets the pages that depend on an event, and only them", () => {
      const cache = new HtmlCache();
      cache.set("/", "accueil", cache.ticket("/"), ["match.result_published", "post.published"]);
      cache.set("/equipes", "équipes", cache.ticket("/equipes"), ["match.result_published"]);
      cache.set("/contact", "contact", cache.ticket("/contact"));
      expect(cache.invalidateDependency("match.result_published")).toBe(2);
      expect(cache.get("/")).toBeUndefined();
      expect(cache.get("/equipes")).toBeUndefined();
      expect(cache.get("/contact")).toBe("contact");
      expect(cache.invalidateDependency("match.result_published")).toBe(0);
    });

    it("keeps no stale dependency once a page is stored again or invalidated", () => {
      const cache = new HtmlCache();
      cache.set("/", "v1", cache.ticket("/"), ["post.published"]);
      cache.set("/", "v2", cache.ticket("/"), []);
      expect(cache.invalidateDependency("post.published")).toBe(0);
      expect(cache.get("/")).toBe("v2");
      cache.set("/a", "a", cache.ticket("/a"), ["post.published"]);
      cache.invalidate("/a");
      cache.set("/a", "a", cache.ticket("/a"));
      expect(cache.invalidateDependency("post.published")).toBe(0);
    });

    it("does not store a render started before its dependency was invalidated", () => {
      const cache = new HtmlCache();
      const ticket = cache.ticket("/");
      cache.invalidateDependency("match.updated");
      expect(cache.set("/", "périmé", ticket, ["match.updated"])).toBe(false);
      // A render depending on something else is not concerned.
      expect(cache.set("/", "frais", ticket, ["post.published"])).toBe(true);
      expect(cache.set("/x", "x", cache.ticket("/x"), ["match.updated"])).toBe(true);
    });
  });
});
