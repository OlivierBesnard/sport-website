import { describe, expect, it } from "vitest";
import { suggestedSeason } from "./SeasonsPage";
import { formatDay, fromLocalInput, numberOrNull, toLocalInput } from "./shared";

describe("helpers of the sports screens", () => {
  it("turns a local date and time into an instant and back", () => {
    const time = new Date(2026, 10, 14, 15, 30).getTime();
    expect(toLocalInput(time)).toBe("2026-11-14T15:30");
    expect(fromLocalInput("2026-11-14T15:30")).toBe(time);
    expect(fromLocalInput("")).toBeNull();
    expect(fromLocalInput("pas une date")).toBeNull();
    expect(toLocalInput(null)).toBe("");
  });

  it("reads numbers typed with a comma or a point", () => {
    expect(numberOrNull("45,764")).toBe(45.764);
    expect(numberOrNull(" 4.83 ")).toBe(4.83);
    expect(numberOrNull("")).toBeNull();
    expect(numberOrNull("abc")).toBeNaN();
  });

  it("shows a day in French", () => {
    expect(formatDay("2026-09-01")).toBe("1 sept. 2026");
  });

  it("suggests the season starting in September", () => {
    expect(suggestedSeason(new Date(2026, 10, 7))).toEqual({
      name: "2026-2027",
      startsOn: "2026-09-01",
      endsOn: "2027-06-30",
    });
    expect(suggestedSeason(new Date(2027, 2, 1)).name).toBe("2026-2027");
  });
});
