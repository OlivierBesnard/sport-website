import { describe, expect, it } from "vitest";
import type { Field } from "../types.js";
import { type PropResolvers, resolveProps } from "./props.js";

/** Marks resolved slots and rich text so tests can see the resolvers were used. */
const resolvers: PropResolvers = {
  slot: (items) => ({ slot: items }),
  richtext: (html) => ({ html }),
};

const FIELDS: Readonly<Record<string, Field>> = {
  title: { type: "text" },
  body: { type: "textarea" },
  text: { type: "richtext" },
  count: { type: "number", min: 1, max: 10 },
  level: {
    type: "select",
    options: [
      { label: "2", value: 2 },
      { label: "3", value: 3 },
    ],
  },
  variant: {
    type: "radio",
    options: [
      { label: "A", value: "a" },
      { label: "B", value: "b" },
    ],
  },
  content: { type: "slot" },
  items: {
    type: "array",
    arrayFields: { name: { type: "text" }, inner: { type: "slot" } },
    defaultItemProps: { name: "Sans nom", inner: [] },
    max: 2,
  },
  link: { type: "object", objectFields: { href: { type: "text" }, label: { type: "text" } } },
};

const DEFAULTS = {
  title: "Titre",
  body: "",
  text: "<p>Texte</p>",
  count: 3,
  level: 2,
  variant: "a",
  content: [],
  items: [],
  link: { href: "/", label: "Accueil" },
};

describe("resolveProps", () => {
  it("keeps valid stored values", () => {
    const stored = {
      title: "Bonjour",
      body: "Ligne",
      text: "<p>Riche</p>",
      count: 7,
      level: 3,
      variant: "b",
      content: [{ type: "Heading", props: { id: "h" } }],
      items: [{ name: "Un", inner: [] }],
      link: { href: "/club", label: "Club" },
    };
    expect(resolveProps(FIELDS, stored, DEFAULTS, resolvers)).toEqual({
      title: "Bonjour",
      body: "Ligne",
      text: { html: "<p>Riche</p>" },
      count: 7,
      level: 3,
      variant: "b",
      content: { slot: [{ type: "Heading", props: { id: "h" } }] },
      items: [{ name: "Un", inner: { slot: [] } }],
      link: { href: "/club", label: "Club" },
    });
  });

  it("uses the defaults for missing props", () => {
    expect(resolveProps(FIELDS, {}, DEFAULTS, resolvers)).toEqual({
      title: "Titre",
      body: "",
      text: { html: "<p>Texte</p>" },
      count: 3,
      level: 2,
      variant: "a",
      content: { slot: [] },
      items: [],
      link: { href: "/", label: "Accueil" },
    });
  });

  it("replaces values of the wrong type or out of range by the defaults", () => {
    const stored = {
      title: 42,
      body: null,
      text: { html: "<script>" },
      count: 99,
      level: "2",
      variant: "c",
      content: "pas une liste",
      items: { name: "pas une liste" },
      link: "/club",
    };
    expect(resolveProps(FIELDS, stored, DEFAULTS, resolvers)).toEqual(
      resolveProps(FIELDS, {}, DEFAULTS, resolvers),
    );
  });

  it("refuses non-finite numbers", () => {
    for (const count of [Number.NaN, Number.POSITIVE_INFINITY, 0]) {
      expect(resolveProps(FIELDS, { count }, DEFAULTS, resolvers).count).toBe(3);
    }
  });

  it("falls back to empty values when the defaults are invalid too", () => {
    expect(resolveProps(FIELDS, {}, {}, resolvers)).toEqual({
      title: "",
      body: "",
      text: { html: "" },
      count: 1,
      level: 2,
      variant: "a",
      content: { slot: [] },
      items: [],
      link: { href: "", label: "" },
    });
  });

  it("completes array items with the default item props and keeps at most `max` of them", () => {
    const stored = { items: [{ name: "Un" }, "pas un objet", {}, { name: "Trois" }] };
    expect(resolveProps(FIELDS, stored, DEFAULTS, resolvers).items).toEqual([
      { name: "Un", inner: { slot: [] } },
    ]);
    const twoValid = { items: [{ name: "Un" }, { inner: [{ type: "X", props: {} }] }] };
    expect(resolveProps(FIELDS, twoValid, DEFAULTS, resolvers).items).toEqual([
      { name: "Un", inner: { slot: [] } },
      { name: "Sans nom", inner: { slot: [{ type: "X", props: {} }] } },
    ]);
  });

  it("drops undeclared props and ignores inherited ones", () => {
    const stored = Object.assign(Object.create({ title: "hérité" }), { extra: "<b>x</b>" });
    const props = resolveProps(FIELDS, stored, DEFAULTS, resolvers);
    expect(props).not.toHaveProperty("extra");
    expect(props.title).toBe("Titre");
  });
});
