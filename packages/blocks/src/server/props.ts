import type { Field, FieldOption } from "../types.js";

/** Turn stored values into what `render` receives, for the fields that need it. */
export interface PropResolvers {
  /** Nested blocks of a slot field (the raw list, not validated yet). */
  slot(items: readonly unknown[]): unknown;
  /** HTML of a rich text field. */
  richtext(html: string): unknown;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringOr(value: unknown, fallback: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return typeof fallback === "string" ? fallback : "";
}

function listOr(value: unknown, fallback: unknown): readonly unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(fallback) ? fallback : [];
}

function isNumberWithin(value: unknown, field: { min?: number; max?: number }): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    (field.min === undefined || value >= field.min) &&
    (field.max === undefined || value <= field.max)
  );
}

function optionOr(options: readonly FieldOption[], value: unknown, fallback: unknown): unknown {
  const isOption = (candidate: unknown) => options.some((option) => option.value === candidate);
  if (isOption(value)) {
    return value;
  }
  return isOption(fallback) ? fallback : options[0]?.value;
}

function resolveField(
  field: Field,
  value: unknown,
  fallback: unknown,
  resolvers: PropResolvers,
): unknown {
  switch (field.type) {
    case "text":
    case "textarea":
      return stringOr(value, fallback);
    case "richtext":
      return resolvers.richtext(stringOr(value, fallback));
    case "number":
      if (isNumberWithin(value, field)) {
        return value;
      }
      return isNumberWithin(fallback, field) ? fallback : (field.min ?? 0);
    case "boolean":
      return typeof value === "boolean" ? value : fallback === true;
    case "select":
    case "radio":
      return optionOr(field.options, value, fallback);
    case "slot":
      return resolvers.slot(listOr(value, fallback));
    case "array": {
      const items = listOr(value, fallback);
      return (field.max === undefined ? items : items.slice(0, field.max))
        .filter(isRecord)
        .map((item) =>
          resolveProps(field.arrayFields, item, field.defaultItemProps ?? {}, resolvers),
        );
    }
    case "object":
      return resolveProps(
        field.objectFields,
        isRecord(value) ? value : {},
        isRecord(fallback) ? fallback : {},
        resolvers,
      );
  }
}

/**
 * Props of a block (or of an array item, or an object field) ready for `render`, from stored
 * values that may be missing or wrong: data written by an older or newer version of the block,
 * or edited by hand. Each declared field gets a value of its type: the stored one when valid,
 * else the default one, else an empty value (`""`, the first option, `[]`…). Values of undeclared
 * props are dropped.
 */
export function resolveProps(
  fields: Readonly<Record<string, Field>>,
  stored: Readonly<Record<string, unknown>>,
  defaults: Readonly<Record<string, unknown>>,
  resolvers: PropResolvers,
): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  for (const [name, field] of Object.entries(fields)) {
    const value = Object.hasOwn(stored, name) ? stored[name] : undefined;
    const fallback = Object.hasOwn(defaults, name) ? defaults[name] : undefined;
    props[name] = resolveField(field, value, fallback, resolvers);
  }
  return props;
}
