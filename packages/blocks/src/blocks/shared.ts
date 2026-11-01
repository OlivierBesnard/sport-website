import type { RadioField } from "../types.js";

export type Alignment = "left" | "center";

export const alignmentField: RadioField = {
  type: "radio",
  label: "Alignement",
  options: [
    { label: "À gauche", value: "left" },
    { label: "Centré", value: "center" },
  ],
};

/** Utility class aligning text and inline content (styled by `@sport-cms/themes`). */
export function alignmentClass(alignment: Alignment): string | undefined {
  return alignment === "center" ? "cms-text-center" : undefined;
}

/** Joins the class names that are set. */
export function classNames(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}
