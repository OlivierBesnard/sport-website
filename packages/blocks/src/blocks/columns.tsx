import { defineBlock, type Slot, type SlotField } from "../types.js";

export type ColumnsLayout = "halves" | "thirds" | "quarters" | "one-two" | "two-one";

export type ColumnsProps = {
  layout: ColumnsLayout;
  first: Slot;
  second: Slot;
  third: Slot;
  fourth: Slot;
};

const COLUMN_COUNTS: Readonly<Record<ColumnsLayout, number>> = {
  halves: 2,
  thirds: 3,
  quarters: 4,
  "one-two": 2,
  "two-one": 2,
};

function columnField(label: string): SlotField {
  return { type: "slot", label, disallow: ["Section", "Hero", "Columns"] };
}

/**
 * Two to four columns of blocks, side by side from tablet width, stacked on mobile. The layout
 * only decides how many columns are shown: the content of a hidden column is kept, and comes back
 * if the layout grows again.
 */
export const columnsBlock = defineBlock<ColumnsProps>({
  type: "Columns",
  label: "Colonnes",
  fields: {
    layout: {
      type: "select",
      label: "Disposition",
      options: [
        { label: "2 colonnes égales", value: "halves" },
        { label: "3 colonnes égales", value: "thirds" },
        { label: "4 colonnes égales", value: "quarters" },
        { label: "2 colonnes : étroite puis large", value: "one-two" },
        { label: "2 colonnes : large puis étroite", value: "two-one" },
      ],
    },
    first: columnField("Colonne 1"),
    second: columnField("Colonne 2"),
    third: columnField("Colonne 3"),
    fourth: columnField("Colonne 4"),
  },
  defaultProps: { layout: "halves", first: [], second: [], third: [], fourth: [] },
  render: ({ layout, first: First, second: Second, third: Third, fourth: Fourth }) => {
    const count = COLUMN_COUNTS[layout];
    return (
      <div className={`cms-columns cms-columns--${layout}`}>
        <First className="cms-stack" />
        <Second className="cms-stack" />
        {count >= 3 && <Third className="cms-stack" />}
        {count >= 4 && <Fourth className="cms-stack" />}
      </div>
    );
  },
});
