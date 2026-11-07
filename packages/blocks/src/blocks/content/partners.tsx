import {
  PARTNER_LEVEL_LABELS,
  PARTNER_LEVELS,
  type PartnerLevel,
  type PartnerView,
} from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import { safeLinkUrl } from "../../url.js";
import { BlockTitle } from "../sport/shared.js";
import { MEDIA_EVENTS, MediaImage } from "./shared.js";

export type PartnersProps = {
  title: string;
  level: "all" | PartnerLevel;
};

/**
 * The partners of the club whose period includes today, grouped by level: their logo (or their
 * name), linked to their site. The page is rendered again when a period starts or ends.
 */
export const partnersBlock = defineBlock<PartnersProps, readonly PartnerView[]>({
  type: "Partners",
  label: "Partenaires",
  fields: {
    title: { type: "text", label: "Titre" },
    level: {
      type: "select",
      label: "Niveau",
      options: [
        { label: "Tous les niveaux", value: "all" },
        ...PARTNER_LEVELS.map((level) => ({ label: PARTNER_LEVEL_LABELS[level], value: level })),
      ],
    },
  },
  defaultProps: { title: "Nos partenaires", level: "all" },
  dependsOn: ["partner.updated", ...MEDIA_EVENTS],
  loader: async ({ level }, { content, expiresAt }) => {
    const { partners, nextChange } = await content.partners(level === "all" ? {} : { level });
    if (nextChange !== null) {
      expiresAt(new Date(nextChange));
    }
    return partners;
  },
  render: ({ title, data }) => {
    if (data.length === 0) {
      return null;
    }
    const levels = PARTNER_LEVELS.filter((level) =>
      data.some((partner) => partner.level === level),
    );
    return (
      <div className="cms-stack">
        <BlockTitle title={title} />
        {levels.map((level) => (
          <section key={level} className="cms-stack">
            {levels.length > 1 && <h3>{PARTNER_LEVEL_LABELS[level]}</h3>}
            <ul className={`cms-partners cms-partners--${level}`}>
              {data
                .filter((partner) => partner.level === level)
                .map((partner) => {
                  const href = partner.url === "" ? undefined : safeLinkUrl(partner.url);
                  const content =
                    partner.logo === null ? (
                      <span className="cms-partner__name">{partner.name}</span>
                    ) : (
                      <MediaImage
                        className="cms-partner__logo"
                        media={{ ...partner.logo, alt: partner.name }}
                        sizes="12rem"
                      />
                    );
                  return (
                    <li key={partner.id} className="cms-partner">
                      {href === undefined ? (
                        content
                      ) : (
                        <a href={href} rel="sponsored noopener noreferrer">
                          {content}
                        </a>
                      )}
                    </li>
                  );
                })}
            </ul>
          </section>
        ))}
      </div>
    );
  },
});
