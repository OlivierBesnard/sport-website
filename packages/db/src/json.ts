/** A value that survives `JSON.stringify` then `JSON.parse` unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON value accepted by a `NOT NULL` JSON column. A top-level `null` is excluded: Drizzle
 * writes a JavaScript `null` as SQL `NULL`, not as the JSON text `null`.
 */
export type StoredJson = Exclude<JsonValue, null>;
