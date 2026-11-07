import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { JsonSchema } from "../api/modules";
import { choiceKey, formOutput, initialValues, schemaForm } from "./schema-form";

/** The schema as the server sends it: zod's JSON Schema of the input. */
function jsonSchema(schema: z.ZodType): JsonSchema {
  return JSON.parse(
    JSON.stringify(z.toJSONSchema(schema, { io: "input", unrepresentable: "any" })),
  ) as JsonSchema;
}

const settings = jsonSchema(
  z.object({
    signature: z
      .string()
      .max(100)
      .default("")
      .meta({ title: "Signature", description: "Sous la citation." }),
    color: z.enum(["rouge", "bleu"]).default("bleu").meta({ title: "Couleur" }),
    count: z.int().min(1),
    ratio: z.number().optional(),
    public: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
  }),
);

describe("schemaForm", () => {
  it("makes a field of each common property, labeled by the schema", () => {
    const form = schemaForm(settings);
    expect(
      form.fields.map((field) => [field.name, field.kind, field.label, field.required]),
    ).toEqual([
      ["signature", "text", "Signature", false],
      ["color", "choice", "Couleur", false],
      ["count", "integer", "count", true],
      ["ratio", "number", "ratio", false],
      ["public", "boolean", "public", false],
    ]);
    expect(form.fields[0]?.description).toBe("Sous la citation.");
    expect(form.fields[0]?.maxLength).toBe(100);
    expect(form.fields[1]?.options).toEqual([
      { label: "rouge", value: "rouge" },
      { label: "bleu", value: "bleu" },
    ]);
    expect(form.unsupported).toEqual(["tags"]);
  });

  it("has no field without a schema", () => {
    expect(schemaForm(null)).toEqual({ fields: [], unsupported: [] });
  });
});

describe("initialValues and formOutput", () => {
  const form = schemaForm(settings);

  it("starts from the saved values, then the defaults", () => {
    expect(initialValues(form, { signature: "Le bureau", count: 3 })).toEqual({
      signature: "Le bureau",
      color: choiceKey("bleu"),
      count: "3",
      ratio: "",
      public: false,
    });
  });

  it("sends each value in its JSON type, keeping the properties without a field", () => {
    const values = {
      signature: "Le bureau",
      color: choiceKey("rouge"),
      count: "4",
      ratio: "0,5",
      public: true,
    };
    expect(formOutput(form, values, { tags: ["a"], removed: 1 })).toEqual({
      tags: ["a"],
      signature: "Le bureau",
      color: "rouge",
      count: 4,
      ratio: 0.5,
      public: true,
    });
  });

  it("leaves out an empty optional field, sends an empty required one for the server to refuse", () => {
    const values = { signature: "", color: "", count: "", ratio: "", public: false };
    expect(formOutput(form, values)).toEqual({ count: "", public: false });
  });

  it("sends a number that does not read as one as typed", () => {
    const values = { signature: "", color: "", count: "trois", ratio: "", public: false };
    expect(formOutput(form, values).count).toBe("trois");
  });

  it("round-trips with the module's schema", () => {
    const schema = z.object({ color: z.enum(["rouge", "bleu"]).default("bleu"), count: z.int() });
    const generated = schemaForm(jsonSchema(schema));
    const output = formOutput(generated, { color: choiceKey("rouge"), count: "2" });
    expect(schema.parse(output)).toEqual({ color: "rouge", count: 2 });
  });
});
