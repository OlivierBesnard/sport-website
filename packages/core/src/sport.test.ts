import { describe, expect, it } from "vitest";
import { isDay, TIME_OF_DAY_PATTERN, weekdayLabel } from "./sport.js";

describe("sports content helpers", () => {
  it("accepts the days that exist only", () => {
    expect(isDay("2026-09-01")).toBe(true);
    expect(isDay("2028-02-29")).toBe(true);
    expect(isDay("2027-02-29")).toBe(false);
    expect(isDay("2026-13-01")).toBe(false);
    expect(isDay("2026-9-1")).toBe(false);
    expect(isDay("2026-09-01T00:00")).toBe(false);
  });

  it("reads times of day from 00:00 to 23:59", () => {
    expect(TIME_OF_DAY_PATTERN.test("00:00")).toBe(true);
    expect(TIME_OF_DAY_PATTERN.test("23:59")).toBe(true);
    expect(TIME_OF_DAY_PATTERN.test("24:00")).toBe(false);
    expect(TIME_OF_DAY_PATTERN.test("9:30")).toBe(false);
  });

  it("names the days of the week in French", () => {
    expect(weekdayLabel(1)).toBe("Lundi");
    expect(weekdayLabel(7)).toBe("Dimanche");
    expect(weekdayLabel(8)).toBe("");
  });
});
