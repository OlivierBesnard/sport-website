import { describe, expect, it } from "vitest";
import { defineBlock, type RichText, type Slot } from "./types.js";

/*
 * The props type of a block decides which fields it may declare (`FieldFor`). The checks are made
 * by the type checker (`pnpm typecheck` covers the test files): each `@ts-expect-error` below
 * fails the type check if the mismatched field were ever accepted.
 */

const render = () => null;

describe("field types tied to prop types", () => {
  it("accepts the fields that can edit each prop", () => {
    const block = defineBlock<{
      title: string;
      body: RichText;
      content: Slot;
      count: number;
      visible: boolean;
      align: "left" | "center";
      level: 1 | 2;
      note?: string;
      links: { label: string; inner: Slot }[];
      author: { name: string };
    }>({
      type: "Typed",
      label: "Typé",
      fields: {
        title: { type: "textarea" },
        body: { type: "richtext" },
        content: { type: "slot" },
        count: { type: "number", min: 0 },
        visible: { type: "boolean" },
        align: {
          type: "radio",
          options: [
            { label: "Gauche", value: "left" },
            { label: "Centre", value: "center" },
          ],
        },
        level: { type: "select", options: [{ label: "Un", value: 1 }] },
        note: { type: "text" },
        links: {
          type: "array",
          arrayFields: { label: { type: "text" }, inner: { type: "slot" } },
          defaultItemProps: { label: "" },
        },
        author: { type: "object", objectFields: { name: { type: "text" } } },
      },
      defaultProps: {
        title: "",
        body: "",
        content: [],
        count: 0,
        visible: false,
        align: "left",
        level: 1,
        links: [],
        author: { name: "" },
      },
      render,
    });
    expect(block.type).toBe("Typed");
  });

  it("refuses a field that cannot edit its prop", () => {
    defineBlock<{ content: Slot; title: string; body: RichText; align: "left" | "center" }>({
      type: "Mismatched",
      label: "Incohérent",
      fields: {
        // @ts-expect-error a slot prop needs a slot field
        content: { type: "text" },
        // @ts-expect-error a plain string prop cannot be rich text: `render` would get a node
        title: { type: "richtext" },
        // @ts-expect-error a rich text prop needs a richtext field
        body: { type: "text" },
        align: {
          type: "select",
          // @ts-expect-error an option outside the prop's values
          options: [{ label: "Droite", value: "right" }],
        },
      },
      defaultProps: { content: [], title: "", body: "", align: "left" },
      render,
    });
    defineBlock<{ count: number; items: { label: string }[] }>({
      type: "Mismatched2",
      label: "Incohérent",
      fields: {
        // @ts-expect-error a number prop cannot be a slot
        count: { type: "slot" },
        // @ts-expect-error the fields of the items must match the item type
        items: { type: "array", arrayFields: { label: { type: "number" } } },
      },
      defaultProps: { count: 0, items: [] },
      render,
    });
    expect(true).toBe(true);
  });
});
