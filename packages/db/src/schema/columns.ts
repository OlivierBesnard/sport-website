import { integer } from "drizzle-orm/sqlite-core";

/*
 * Storage conventions, shared by every table:
 * - Dates are INTEGER columns holding milliseconds since the Unix epoch (UTC), read and written
 *   as `Date` by Drizzle (`mode: "timestamp_ms"`). They sort and compare as plain numbers.
 *   Automatic dates come from the application clock, through Drizzle: SQLite's clock is coarser
 *   on Windows and could not be mocked in tests. A raw SQL insert must provide them.
 * - JSON is stored as TEXT (`text(name, { mode: "json" })`), typed with `$type<…>()`, so the
 *   SQLite JSON functions can read it.
 * - Booleans are INTEGER 0/1 (`integer(name, { mode: "boolean" })`).
 */

const now = () => new Date();

/** Date column stored as epoch milliseconds. */
export function timestamp(name: string) {
  return integer(name, { mode: "timestamp_ms" });
}

/** Date column set to the current time on insert when no value is given. */
export function timestampDefaultNow(name: string) {
  return timestamp(name).notNull().$defaultFn(now);
}

/** Creation date, set on insert. */
export function createdAt() {
  return timestampDefaultNow("created_at");
}

/** Last modification date, set on insert and on every update. */
export function updatedAt() {
  return timestampDefaultNow("updated_at").$onUpdate(now);
}
