import { describe, expect, it } from "vitest";
import { type CronSchedule, nextOccurrence, parseCron } from "./cron.js";

function schedule(expression: string): CronSchedule {
  const parsed = parseCron(expression);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  return parsed.schedule;
}

/** Local date, as the scheduler reads it. */
function at(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(year, month - 1, day, hours, minutes);
}

describe("parseCron", () => {
  it("reads the five fields: stars, numbers, ranges, steps and lists", () => {
    const parsed = schedule("*/15 8-10,18 1 */3 1-5");
    expect([...parsed.minutes]).toEqual([0, 15, 30, 45]);
    expect([...parsed.hours]).toEqual([8, 9, 10, 18]);
    expect([...parsed.days]).toEqual([1]);
    expect([...parsed.months]).toEqual([1, 4, 7, 10]);
    expect([...parsed.weekdays]).toEqual([1, 2, 3, 4, 5]);
    expect(parsed.daysRestricted).toBe(true);
    expect(parsed.weekdaysRestricted).toBe(true);
  });

  it("reads 7 as Sunday and a start with a step as a range to the end", () => {
    expect([...schedule("0 0 * * 7").weekdays]).toEqual([0]);
    expect([...schedule("10/20 * * * *").minutes]).toEqual([10, 30, 50]);
  });

  it("refuses invalid expressions in French", () => {
    expect(parseCron("* * * *")).toEqual({
      ok: false,
      error:
        "La planification « * * * * » doit compter 5 champs (minute heure jour mois jour-de-la-semaine).",
    });
    expect(parseCron("60 * * * *")).toEqual({
      ok: false,
      error: "Planification « 60 * * * * », minutes : « 60 » sort de l'intervalle 0-59.",
    });
    expect(parseCron("* * * jan *")).toMatchObject({ ok: false });
    expect(parseCron("*/0 * * * *")).toMatchObject({ ok: false });
    expect(parseCron("5-1 * * * *")).toMatchObject({ ok: false });
  });

  it("refuses a schedule that never fires", () => {
    expect(parseCron("0 0 30 2 *")).toEqual({
      ok: false,
      error: "La planification « 0 0 30 2 * » ne se déclenche jamais.",
    });
  });
});

describe("nextOccurrence", () => {
  it("gives the first minute strictly after the date", () => {
    const every30 = schedule("*/30 * * * *");
    expect(nextOccurrence(every30, at(2026, 11, 7, 10, 0))).toEqual(at(2026, 11, 7, 10, 30));
    expect(nextOccurrence(every30, at(2026, 11, 7, 10, 29))).toEqual(at(2026, 11, 7, 10, 30));
    const late = new Date(at(2026, 11, 7, 10, 59).getTime() + 30_000);
    expect(nextOccurrence(every30, late)).toEqual(at(2026, 11, 7, 11, 0));
  });

  it("crosses days, months and years", () => {
    expect(nextOccurrence(schedule("0 3 * * *"), at(2026, 12, 31, 4))).toEqual(at(2027, 1, 1, 3));
    expect(nextOccurrence(schedule("0 0 1 3 *"), at(2026, 11, 7))).toEqual(at(2027, 3, 1));
    expect(nextOccurrence(schedule("0 0 29 2 *"), at(2026, 3, 1))).toEqual(at(2028, 2, 29));
  });

  it("matches the day of month or the day of week when both are restricted", () => {
    // 2026-11-07 is a Saturday: the next Monday is the 9th, before the 15th.
    expect(nextOccurrence(schedule("0 12 15 * 1"), at(2026, 11, 7))).toEqual(at(2026, 11, 9, 12));
    // Only the day of week: Mondays.
    expect(nextOccurrence(schedule("0 12 * * 1"), at(2026, 11, 9, 12))).toEqual(
      at(2026, 11, 16, 12),
    );
  });
});
