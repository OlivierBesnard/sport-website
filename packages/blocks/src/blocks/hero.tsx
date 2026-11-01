import { defineBlock } from "../types.js";
import { safeImageUrl, safeLinkUrl } from "../url.js";
import { classNames } from "./shared.js";

export type HeroProps = {
  title: string;
  subtitle: string;
  imageSrc: string;
  imageAlt: string;
  ctaLabel: string;
  ctaHref: string;
};

/**
 * Opening banner of a page, in the club's color: the page title (level 1 heading), a short
 * text, a call to action and an optional image beside the text (below it on mobile). The text
 * sits on a plain background, never over the image, so its contrast does not depend on the photo.
 */
export const heroBlock = defineBlock<HeroProps>({
  type: "Hero",
  label: "Bannière d'accueil",
  fields: {
    title: { type: "text", label: "Titre", placeholder: "Nom du club" },
    subtitle: { type: "textarea", label: "Texte" },
    imageSrc: { type: "text", label: "Adresse de l'image" },
    imageAlt: { type: "text", label: "Texte alternatif de l'image" },
    ctaLabel: { type: "text", label: "Texte du bouton" },
    ctaHref: { type: "text", label: "Lien du bouton" },
  },
  defaultProps: {
    title: "",
    subtitle: "",
    imageSrc: "",
    imageAlt: "",
    ctaLabel: "",
    ctaHref: "",
  },
  render: ({ title, subtitle, imageSrc, imageAlt, ctaLabel, ctaHref }) => {
    const image = safeImageUrl(imageSrc);
    const ctaUrl = ctaLabel.trim() === "" ? undefined : safeLinkUrl(ctaHref);
    if (
      title.trim() === "" &&
      subtitle.trim() === "" &&
      ctaUrl === undefined &&
      image === undefined
    ) {
      return null;
    }
    return (
      <section
        className={classNames(
          "cms-hero",
          "cms-inverse",
          image !== undefined && "cms-hero--with-image",
        )}
      >
        <div className="cms-container cms-hero__inner">
          <div className="cms-stack">
            {title.trim() !== "" && <h1 className="cms-hero__title">{title}</h1>}
            {subtitle.trim() !== "" && <p className="cms-hero__subtitle">{subtitle}</p>}
            {ctaUrl !== undefined && (
              <div className="cms-actions">
                <a className="cms-button cms-button--primary" href={ctaUrl}>
                  {ctaLabel}
                </a>
              </div>
            )}
          </div>
          {image !== undefined && (
            <img className="cms-hero__image" src={image} alt={imageAlt.trim()} />
          )}
        </div>
      </section>
    );
  },
});
