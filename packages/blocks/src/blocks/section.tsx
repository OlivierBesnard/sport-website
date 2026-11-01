import { defineBlock, type Slot } from "../types.js";
import { classNames } from "./shared.js";

export type SectionProps = {
  content: Slot;
  background: "default" | "muted" | "primary";
};

/** A full-width band of the page holding other blocks, on a light, tinted or club-color background. */
export const sectionBlock = defineBlock<SectionProps>({
  type: "Section",
  label: "Section",
  fields: {
    content: { type: "slot", label: "Contenu", disallow: ["Section", "Hero"] },
    background: {
      type: "select",
      label: "Fond",
      options: [
        { label: "Clair", value: "default" },
        { label: "Teinté", value: "muted" },
        { label: "Couleur du club", value: "primary" },
      ],
    },
  },
  defaultProps: { content: [], background: "default" },
  render: ({ content: Content, background }) => (
    <section
      className={classNames(
        "cms-section",
        background === "muted" && "cms-section--muted",
        background === "primary" && "cms-inverse",
      )}
    >
      <Content className="cms-container cms-stack" />
    </section>
  ),
});
