import { defineBlock } from "../types.js";
import { safeLinkUrl } from "../url.js";
import { type Alignment, alignmentClass, alignmentField, classNames } from "./shared.js";

export type ButtonProps = {
  label: string;
  href: string;
  variant: "primary" | "secondary";
  align: Alignment;
};

/** A link styled as a button (call to action). */
export const buttonBlock = defineBlock<ButtonProps>({
  type: "Button",
  label: "Bouton",
  fields: {
    label: { type: "text", label: "Texte du bouton", placeholder: "Nous rejoindre" },
    href: {
      type: "text",
      label: "Lien (adresse d'une page, d'un site, mailto: ou tel:)",
      placeholder: "/inscription",
    },
    variant: {
      type: "radio",
      label: "Style",
      options: [
        { label: "Principal", value: "primary" },
        { label: "Secondaire", value: "secondary" },
      ],
    },
    align: alignmentField,
  },
  defaultProps: { label: "", href: "", variant: "primary", align: "left" },
  render: ({ label, href, variant, align }) => {
    const url = safeLinkUrl(href);
    if (url === undefined || label.trim() === "") {
      return null;
    }
    return (
      <div className={classNames("cms-actions", alignmentClass(align))}>
        <a className={`cms-button cms-button--${variant}`} href={url}>
          {label}
        </a>
      </div>
    );
  },
});
