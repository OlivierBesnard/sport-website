import { defineBlock } from "../types.js";
import { type Alignment, alignmentClass, alignmentField, classNames } from "./shared.js";

export type HeadingProps = {
  text: string;
  level: 1 | 2 | 3 | 4;
  align: Alignment;
};

/**
 * A heading at the chosen level. Nothing here prevents a second level 1 heading on a page: the
 * editor is in charge of keeping the outline right.
 */
export const headingBlock = defineBlock<HeadingProps>({
  type: "Heading",
  label: "Titre",
  fields: {
    text: { type: "text", label: "Texte", placeholder: "Nos équipes" },
    level: {
      type: "select",
      label: "Niveau",
      options: [
        { label: "Titre de la page (niveau 1)", value: 1 },
        { label: "Titre de section (niveau 2)", value: 2 },
        { label: "Sous-titre (niveau 3)", value: 3 },
        { label: "Petit titre (niveau 4)", value: 4 },
      ],
    },
    align: alignmentField,
  },
  defaultProps: { text: "", level: 2, align: "left" },
  render: ({ text, level, align }) => {
    if (text.trim() === "") {
      return null;
    }
    const Tag = `h${level}` as const;
    return <Tag className={classNames("cms-heading", alignmentClass(align))}>{text}</Tag>;
  },
});
