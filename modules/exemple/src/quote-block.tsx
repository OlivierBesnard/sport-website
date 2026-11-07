import { defineBlock } from "@sport-cms/module-sdk";

export type QuoteProps = {
  text: string;
  author: string;
  align: "left" | "center";
};

/**
 * A quotation with its author. Styled by the classes of the theme only (`cms-*`): the public site
 * allows no other stylesheet.
 */
export const quoteBlock = defineBlock<QuoteProps>({
  type: "exemple.citation",
  label: "Citation",
  fields: {
    text: { type: "textarea", label: "Citation", placeholder: "Le sport, c'est la vie." },
    author: { type: "text", label: "Auteur", placeholder: "La présidente" },
    align: {
      type: "radio",
      label: "Alignement",
      options: [
        { label: "À gauche", value: "left" },
        { label: "Centré", value: "center" },
      ],
    },
  },
  defaultProps: { text: "", author: "", align: "left" },
  render: ({ text, author, align }) => {
    if (text.trim() === "") {
      return null;
    }
    return (
      <figure className={align === "center" ? "cms-rich-text cms-text-center" : "cms-rich-text"}>
        <blockquote>
          <p>{text}</p>
        </blockquote>
        {author.trim() !== "" && <figcaption>{author}</figcaption>}
      </figure>
    );
  },
});
