/** A value that survives `JSON.stringify` then `JSON.parse` unchanged. */
export type JsonValue = string | number | boolean | null | JsonValue[] | JsonObject;

export type JsonObject = { [key: string]: JsonValue };
