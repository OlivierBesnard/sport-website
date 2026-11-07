import type { z } from "zod";

/**
 * Maps the issues of a failed validation to `{ "club.name": "message" }` in French: the first
 * message of each field wins, and a missing or wrongly typed value gets a plain message.
 */
export function fieldsOf(error: z.ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of error.issues) {
    const path = issue.path.map(String).join(".");
    if (fields[path] !== undefined) {
      continue;
    }
    fields[path] =
      issue.code === "invalid_type"
        ? issue.input === undefined
          ? "Ce champ est requis."
          : "Ce champ est invalide."
        : issue.message;
  }
  return fields;
}
