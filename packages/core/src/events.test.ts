import { describe, expect, it } from "vitest";
import { EVENT_TYPE_PATTERN, parseEventSelector, selectsEvent } from "./events.js";

describe("event types and selectors", () => {
  it("accepts dotted lowercase names only", () => {
    for (const type of ["page.published", "match.result_published", "helloasso.order.paid2"]) {
      expect(EVENT_TYPE_PATTERN.test(type), type).toBe(true);
    }
    for (const type of ["page", "Page.published", "page.", ".page", "page..x", "page.pub-lished"]) {
      expect(EVENT_TYPE_PATTERN.test(type), type).toBe(false);
    }
  });

  it("reads a type, with or without a version", () => {
    expect(parseEventSelector("page.published")).toEqual({
      type: "page.published",
      version: undefined,
    });
    expect(parseEventSelector("page.published@2")).toEqual({ type: "page.published", version: 2 });
    for (const bad of ["page.published@", "page.published@0", "page.published@v1", "page@1"]) {
      expect(parseEventSelector(bad), bad).toBeUndefined();
    }
  });

  it("selects every version, or exactly one", () => {
    const any = { type: "page.published", version: undefined };
    const one = { type: "page.published", version: 1 };
    expect(selectsEvent(any, "page.published", 3)).toBe(true);
    expect(selectsEvent(one, "page.published", 1)).toBe(true);
    expect(selectsEvent(one, "page.published", 2)).toBe(false);
    expect(selectsEvent(any, "page.deleted", 1)).toBe(false);
  });
});
