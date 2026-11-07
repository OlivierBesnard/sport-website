import { defineBlock } from "../types.js";
import { safeImageUrl } from "../url.js";

export type ImageProps = {
  src: string;
  alt: string;
  decorative: boolean;
  caption: string;
};

/** Text the browser reads for an informative image; empty for a decorative one. */
export function imageAlt(props: { alt: string; decorative: boolean }): string {
  return props.decorative ? "" : props.alt.trim();
}

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
    decorative: {
      type: "boolean",
      label: "Image décorative (aucun texte alternatif nécessaire)",
    },
    caption: { type: "text", label: "Légende" },
  },
  defaultProps: { src: "", alt: "", decorative: false, caption: "" },
  render: ({ src, alt, decorative, caption }) => {
    const url = safeImageUrl(src);
    if (url === undefined) {
      return null;
    }
    return (
      <figure className="cms-image">
        <img src={url} alt={imageAlt({ alt, decorative })} loading="lazy" decoding="async" />
        {caption.trim() !== "" && <figcaption>{caption}</figcaption>}
      </figure>
    );
  },
});
