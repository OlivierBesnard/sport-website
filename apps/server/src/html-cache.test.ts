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
});
