import { defineBlock } from "../types.js";
import { safeImageUrl } from "../url.js";

export type ImageProps = {
  src: string;
  alt: string;
  caption: string;
};

/** An image with its alternative text and an optional caption. */
export const imageBlock = defineBlock<ImageProps>({
  type: "Image",
  label: "Image",
  fields: {
    src: { type: "text", label: "Adresse de l'image" },
    alt: {
      type: "text",
      label: "Texte alternatif (ce que montre l'image, pour qui ne la voit pas)",
    },
    caption: { type: "text", label: "Légende" },
  },
  defaultProps: { src: "", alt: "", caption: "" },
  render: ({ src, alt, caption }) => {
    const url = safeImageUrl(src);
    if (url === undefined) {
      return null;
    }
    return (
      <figure className="cms-image">
        <img src={url} alt={alt.trim()} loading="lazy" decoding="async" />
        {caption.trim() !== "" && <figcaption>{caption}</figcaption>}
      </figure>
    );
  },
});
