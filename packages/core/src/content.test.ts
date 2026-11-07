import { describe, expect, it } from "vitest";
import { isPublicMedia, postPath, SLUG_PATTERN } from "./content.js";

describe("editorial content helpers", () => {
  it("keeps the media whose rights were not checked off the public site", () => {
    expect(isPublicMedia("none")).toBe(true);
    expect(isPublicMedia("authorized")).toBe(true);
    expect(isPublicMedia("unverified")).toBe(false);
  });

  it("gives each news item its page under /actualites", () => {
    expect(postPath("victoire-des-u13")).toBe("/actualites/victoire-des-u13");
    expect(SLUG_PATTERN.test("victoire-des-u13")).toBe(true);
    expect(SLUG_PATTERN.test("Victoire")).toBe(false);
    expect(SLUG_PATTERN.test("a--b")).toBe(false);
    expect(SLUG_PATTERN.test("-a")).toBe(false);
  });
});
