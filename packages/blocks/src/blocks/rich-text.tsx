import { defineBlock, type RichText } from "../types.js";

export type RichTextProps = {
  body: RichText;
};

/**
 * Formatted text (paragraphs, lists, links…). `body` is stored as HTML and reaches `render`
 * already sanitized, as a node (`@sport-cms/blocks/server`, or Puck in the editor).
 */
export const richTextBlock = defineBlock<RichTextProps>({
  type: "RichText",
  label: "Texte riche",
  fields: {
    body: { type: "richtext", label: "Texte" },
  },
  defaultProps: { body: "" },
  render: ({ body }) => (body == null ? null : <div className="cms-rich-text">{body}</div>),
});
