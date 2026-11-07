import type { JsonSchema, JsonValue } from "../api/modules";

/**
 * Form generated from the JSON Schema of a module's settings or credentials (the server's
 * `settingsSchema`, from the module's zod schema). The common shapes get a field each: text,
 * number, yes/no, choice in a list. A property of another shape (nested object, list…) has no
 * field: its saved value is kept as is. The schema itself is checked by the server: the form only
 * helps to fill it, the server's French messages say what is wrong.
 *
 * Labels come from the schema (`.meta({ title, description })` in zod), the property name
 * otherwise.
 */

export type FormFieldKind = "text" | "number" | "integer" | "boolean" | "choice";

export interface FormField {
  readonly name: string;
  readonly label: string;
  readonly description: string | undefined;
  readonly kind: FormFieldKind;
  readonly required: boolean;
  /** Choices of a `choice` field; each value is a JSON value. */
  readonly options: readonly { readonly label: string; readonly value: JsonValue }[];
  readonly maxLength: number | undefined;
  readonly defaultValue: JsonValue | undefined;
}

export interface SchemaForm {
  readonly fields: readonly FormField[];
  /** Properties without a field of their own: their values are kept. */
  readonly unsupported: readonly string[];
}

/** What a field of the form holds: the text of an input, or the choice of a yes/no field. */
export type FormValues = Record<string, string | boolean>;

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

/** Label of a choice: the value itself, written plainly. */
function optionLabel(value: JsonValue): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function kindOf(property: { readonly [key: string]: JsonValue }): FormFieldKind | undefined {
  if (Array.isArray(property.enum) && property.enum.length > 0) {
    return "choice";
  }
  switch (property.type) {
    case "string":
      return "text";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    default:
      return undefined;
  }
}

/** The fields of a schema of a JSON object (`null`: no settings, no field). */
export function schemaForm(schema: JsonSchema | null): SchemaForm {
  if (schema === null || !isRecord(schema.properties)) {
    return { fields: [], unsupported: [] };
  }
  const required = new Set(
    Array.isArray(schema.required)
      ? schema.required.filter((name): name is string => typeof name === "string")
      : [],
  );
  const fields: FormField[] = [];
  const unsupported: string[] = [];
  for (const [name, property] of Object.entries(schema.properties)) {
    const kind = isRecord(property) ? kindOf(property) : undefined;
    if (kind === undefined || !isRecord(property)) {
      unsupported.push(name);
      continue;
    }
    fields.push({
      name,
      label: text(property.title) ?? name,
      description: text(property.description),
      kind,
      required: required.has(name),
      options:
        kind === "choice" && Array.isArray(property.enum)
          ? property.enum.map((value) => ({ label: optionLabel(value), value }))
          : [],
      maxLength: typeof property.maxLength === "number" ? property.maxLength : undefined,
      defaultValue: property.default,
    });
  }
  return { fields, unsupported };
}

/** Value of a `choice` field in a `<select>`: the JSON of the option. */
export function choiceKey(value: JsonValue): string {
  return JSON.stringify(value);
}

/**
 * Initial values of the form: the saved value, else the schema's default, else empty. Secret
 * forms (credentials) start empty: their values are never sent back by the server.
 */
export function initialValues(
  form: SchemaForm,
  saved: { readonly [key: string]: JsonValue },
): FormValues {
  const values: FormValues = {};
  for (const field of form.fields) {
    const value = saved[field.name] ?? field.defaultValue;
    if (field.kind === "boolean") {
      values[field.name] = value === true;
    } else if (field.kind === "choice") {
      values[field.name] = value === undefined ? "" : choiceKey(value);
    } else {
      values[field.name] =
        value === undefined || value === null
          ? ""
          : typeof value === "string"
            ? value
            : JSON.stringify(value);
    }
  }
  return values;
}

/**
 * The object to send: each field's value in its JSON type, the properties without a field kept
 * from `saved`. An empty optional field is left out (the module's default applies); an empty
 * required one is sent empty, for the server to say it is required. A number that does not read
 * as one is sent as typed, for the server to refuse it.
 */
export function formOutput(
  form: SchemaForm,
  values: FormValues,
  saved: { readonly [key: string]: JsonValue } = {},
): Record<string, JsonValue> {
  const output: Record<string, JsonValue> = {};
  for (const name of form.unsupported) {
    const kept = saved[name];
    if (kept !== undefined) {
      output[name] = kept;
    }
  }
  for (const field of form.fields) {
    const value = values[field.name];
    if (field.kind === "boolean") {
      output[field.name] = value === true;
      continue;
    }
    const raw = typeof value === "string" ? value : "";
    if (raw === "") {
      if (field.required) {
        output[field.name] = "";
      }
      continue;
    }
    if (field.kind === "choice") {
      const option = field.options.find((candidate) => choiceKey(candidate.value) === raw);
      output[field.name] = option === undefined ? raw : option.value;
    } else if (field.kind === "number" || field.kind === "integer") {
      const number = Number(raw.replace(",", "."));
      output[field.name] = Number.isFinite(number) ? number : raw;
    } else {
      output[field.name] = raw;
    }
  }
  return output;
}
