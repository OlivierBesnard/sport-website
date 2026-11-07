import { describe, expect, it } from "vitest";
import { slotAccepts } from "./slots.js";
import type { SlotField } from "./types.js";

describe("slotAccepts", () => {
  it("accepts every type when the slot has no rule", () => {
    expect(slotAccepts({ type: "slot" }, "Text")).toBe(true);
  });

  it("refuses the types of disallow", () => {
    const field: SlotField = { type: "slot", disallow: ["Section", "Hero"] };
    expect(slotAccepts(field, "Section")).toBe(false);
    expect(slotAccepts(field, "Text")).toBe(true);
  });

  it("accepts only the types of allow, minus those of disallow", () => {
    expect(slotAccepts({ type: "slot", allow: ["Text"] }, "Text")).toBe(true);
    expect(slotAccepts({ type: "slot", allow: ["Text"] }, "Image")).toBe(false);
    expect(slotAccepts({ type: "slot", allow: ["Text"], disallow: ["Text"] }, "Text")).toBe(false);
  });
});
