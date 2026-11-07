/**
 * Schedules of the jobs of the modules, in the classic five fields of cron:
 * `minute hour day-of-month month day-of-week` (`*\/30 * * * *`: every 30 minutes;
 * `0 3 * * 1`: Mondays at 3:00). Each field takes `*`, a number, a range `a-b`, a step `*\/n` or
 * `a-b/n`, and lists of those separated by commas. Day of week: 0 or 7 for Sunday. As in cron,
 * when both the day of month and the day of week are restricted, either one matching is enough.
 *
 * Times are those of the server's time zone (`TZ`): set it to the club's (`Europe/Paris`) for a
 * job meant to run at 3:00 local time.
 */

export interface CronSchedule {
  readonly expression: string;
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly days: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  /** 0 (Sunday) to 6. */
  readonly weekdays: ReadonlySet<number>;
  readonly daysRestricted: boolean;
  readonly weekdaysRestricted: boolean;
}

export type CronParse =
  | { readonly ok: true; readonly schedule: CronSchedule }
  | { readonly ok: false; readonly error: string };

const FIELDS = [
  { name: "minutes", min: 0, max: 59 },
  { name: "heures", min: 0, max: 23 },
  { name: "jour du mois", min: 1, max: 31 },
  { name: "mois", min: 1, max: 12 },
  { name: "jour de la semaine", min: 0, max: 7 },
] as const;

/** The values of one field, or the French reason it is invalid. */
function parseField(text: string, min: number, max: number): Set<number> | string {
  const values = new Set<number>();
  for (const part of text.split(",")) {
    const match = /^(\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(part);
    if (match === null) {
      return `« ${part} » n'est pas une valeur reconnue`;
    }
    const [, range, start, end, step] = match;
    const from = range === "*" ? min : Number(start);
    const to =
      range === "*" ? max : end === undefined ? (step === undefined ? from : max) : Number(end);
    const by = step === undefined ? 1 : Number(step);
    if (from < min || to > max || from > to) {
      return `« ${part} » sort de l'intervalle ${min}-${max}`;
    }
    if (by < 1) {
      return `le pas de « ${part} » doit être au moins 1`;
    }
    for (let value = from; value <= to; value += by) {
      values.add(value);
    }
  }
  return values;
}

/** Searching further than this finds nothing: the schedule never fires (`0 0 30 2 *`). */
const SEARCH_YEARS = 5;

/** Reads a cron expression; the error is in French, for the module's author. */
export function parseCron(expression: string): CronParse {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return {
      ok: false,
      error: `La planification « ${expression} » doit compter 5 champs (minute heure jour mois jour-de-la-semaine).`,
    };
  }
  const sets: Set<number>[] = [];
  for (const [index, field] of FIELDS.entries()) {
    const parsed = parseField(parts[index] ?? "", field.min, field.max);
    if (typeof parsed === "string") {
      return { ok: false, error: `Planification « ${expression} », ${field.name} : ${parsed}.` };
    }
    sets.push(parsed);
  }
  const [minutes, hours, days, months, rawWeekdays] = sets as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  const weekdays = new Set([...rawWeekdays].map((day) => day % 7));
  const schedule: CronSchedule = {
    expression,
    minutes,
    hours,
    days,
    months,
    weekdays,
    daysRestricted: !(parts[2] ?? "").startsWith("*"),
    weekdaysRestricted: !(parts[4] ?? "").startsWith("*"),
  };
  if (nextOccurrence(schedule, new Date(2000, 0, 1)) === undefined) {
    return { ok: false, error: `La planification « ${expression} » ne se déclenche jamais.` };
  }
  return { ok: true, schedule };
}

function dayMatches(schedule: CronSchedule, date: Date): boolean {
  const day = schedule.days.has(date.getDate());
  const weekday = schedule.weekdays.has(date.getDay());
  if (schedule.daysRestricted && schedule.weekdaysRestricted) {
    return day || weekday;
  }
  if (schedule.daysRestricted) {
    return day;
  }
  return schedule.weekdaysRestricted ? weekday : true;
}

/**
 * First minute strictly after `after` at which the schedule fires (seconds at zero), in the
 * local time of the server; `undefined` when it never does.
 */
export function nextOccurrence(schedule: CronSchedule, after: Date): Date | undefined {
  const date = new Date(after.getTime());
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);
  const limit = new Date(after.getTime());
  limit.setFullYear(limit.getFullYear() + SEARCH_YEARS);
  while (date <= limit) {
    if (!schedule.months.has(date.getMonth() + 1)) {
      date.setMonth(date.getMonth() + 1, 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!dayMatches(schedule, date)) {
      date.setDate(date.getDate() + 1);
      date.setHours(0, 0, 0, 0);
      continue;
    }
    if (!schedule.hours.has(date.getHours())) {
      date.setHours(date.getHours() + 1, 0, 0, 0);
      continue;
    }
    if (!schedule.minutes.has(date.getMinutes())) {
      date.setMinutes(date.getMinutes() + 1, 0, 0);
      continue;
    }
    return date;
  }
  return undefined;
}
