import type { ElementType, ReactNode } from "react";

/*
 * Block contract, aligned on the Puck editor (`@puckeditor/core`): a block is the configuration
 * of one Puck component (label, fields, default props, render), plus its `type`, the key Puck
 * uses in `config.components` and stores in page data. The editor (E06) builds its Puck
 * configuration from the same definitions the public renderer uses.
 *
 * Field types are a subset of Puck's, with the same names and shapes.
 */

/** A choice of a `select` or `radio` field. */
export interface FieldOption {
  readonly label: string;
  readonly value: string | number | boolean;
}

interface BaseField {
  /** Label shown in the editor, in French. */
  readonly label?: string;
}

export interface TextField extends BaseField {
  readonly type: "text";
  readonly placeholder?: string;
}

export interface TextareaField extends BaseField {
  readonly type: "textarea";
  readonly placeholder?: string;
}

/** Formatted text, stored as an HTML string; sanitized before it reaches a visitor. */
export interface RichtextField extends BaseField {
  readonly type: "richtext";
}

export interface NumberField extends BaseField {
  readonly type: "number";
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}

/** A single on/off value, shown as a checkbox in the editor. */
export interface BooleanField extends BaseField {
  readonly type: "boolean";
}

export interface SelectField extends BaseField {
  readonly type: "select";
  readonly options: readonly FieldOption[];
}

export interface RadioField extends BaseField {
  readonly type: "radio";
  readonly options: readonly FieldOption[];
}

/** Nested blocks, stored as a list of {@link ComponentData}. */
export interface SlotField extends BaseField {
  readonly type: "slot";
  /** Block types the editor accepts in the slot (all when absent). */
  readonly allow?: string[];
  /** Block types the editor refuses in the slot. */
  readonly disallow?: string[];
}

/** List of items, each an object described by `arrayFields`. */
export interface ArrayField extends BaseField {
  readonly type: "array";
  readonly arrayFields: Readonly<Record<string, Field>>;
  /** Props of an item added in the editor. */
  readonly defaultItemProps?: Readonly<Record<string, unknown>>;
  readonly min?: number;
  readonly max?: number;
}

export interface ObjectField extends BaseField {
  readonly type: "object";
  readonly objectFields: Readonly<Record<string, Field>>;
}

export type Field =
  | TextField
  | TextareaField
  | RichtextField
  | NumberField
  | BooleanField
  | SelectField
  | RadioField
  | SlotField
  | ArrayField
  | ObjectField;

/** One block of a page as stored: Puck's `ComponentData`. */
export interface ComponentData {
  /** Block type, the key of the block definition (`Heading`, `helloasso.membership-button`). */
  readonly type: string;
  /** Values of the block's fields, plus its `id`, unique within the page. */
  readonly props: Readonly<Record<string, unknown>> & { readonly id: string };
  readonly readOnly?: Readonly<Record<string, boolean>>;
}

/**
 * Content of a page as stored in `pages.draft_data` and `pages.published_data`: Puck's `Data`.
 * Nested blocks live in the props of their parent (slot fields); `zones` belongs to Puck's
 * former drop zones, which the core blocks do not use.
 */
export interface PageData {
  readonly root: { readonly props?: Readonly<Record<string, unknown>> };
  readonly content: readonly ComponentData[];
  readonly zones?: Readonly<Record<string, readonly ComponentData[]>>;
}

/** Stored value of a slot field: the nested blocks. */
export type Slot = ComponentData[];

/** Value of a rich text field: an HTML string in the data, a sanitized node when rendered. */
export type RichText = string | ReactNode;

/** Options a block may pass when it renders one of its slots, as with Puck. */
export interface SlotProps {
  readonly className?: string;
  /** Element wrapping the nested blocks (`div` by default). */
  readonly as?: ElementType;
}

/** A slot as received by `render`: a component that renders the nested blocks. */
export type SlotComponent = (props?: SlotProps) => ReactNode;

/** Props of a block, as stored: one value per field. */
export type BlockProps = Record<string, unknown>;

/** Replaces each slot, even inside arrays and objects, by the component that renders it. */
export type WithSlots<T> = T extends Slot
  ? SlotComponent
  : T extends readonly (infer Item)[]
    ? WithSlots<Item>[]
    : T extends Record<string, unknown>
      ? { [Key in keyof T]: WithSlots<T[Key]> }
      : T;

/** Props received by `render`: the field values with slots ready to render, plus the block id. */
export type BlockRenderProps<Props extends BlockProps> = WithSlots<Props> & { readonly id: string };

/** One field per prop. */
export type Fields<Props extends BlockProps> = { readonly [Key in keyof Props]-?: Field };

/** Definition of a block type, shared by the editor and the public renderer. */
export interface BlockDefinition<Props extends BlockProps = BlockProps> {
  /**
   * Unique type stored in page data: PascalCase for core blocks (`Heading`), prefixed with the
   * module identifier for module blocks (`helloasso.membership-button`). Never renamed: pages
   * written with the old name would lose the block.
   */
  readonly type: string;
  /** Name shown in the editor, in French. */
  readonly label: string;
  readonly fields: Fields<Props>;
  /**
   * Props of a new block; also used for any prop missing from, or invalid in, stored data. They
   * can therefore reach visitors and must be fit for the public site: an empty text (the block
   * then shows nothing) rather than an instruction such as « Saisissez un titre ». Help for the
   * person editing goes in the field's `placeholder`.
   */
  readonly defaultProps: Props;
  /** Renders the block; must stay a pure function of its props (rendered on the server). */
  render(props: BlockRenderProps<Props>): ReactNode;
}

/** Declares a block, keeping its props type. */
export function defineBlock<Props extends BlockProps>(
  definition: BlockDefinition<Props>,
): BlockDefinition<Props> {
  return definition;
}
