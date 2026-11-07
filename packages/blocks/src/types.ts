import type { ContentReader, SportReader } from "@sport-cms/core";
import type { ElementType, ReactNode } from "react";

/*
 * Block contract, aligned on the Puck editor (`@puckeditor/core`): a block is the configuration
 * of one Puck component (label, fields, default props, render), plus its `type`, the key Puck
 * uses in `config.components` and stores in page data. The editor (E06) builds its Puck
 * configuration from the same definitions the public renderer uses.
 *
 * Field types are a subset of Puck's, with the same names and shapes.
 */

/** Value a `select` or `radio` field can store. */
export type OptionValue = string | number | boolean;

/** A choice of a `select` or `radio` field. */
export interface FieldOption<Value extends OptionValue = OptionValue> {
  readonly label: string;
  readonly value: Value;
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

export interface SelectField<Value extends OptionValue = OptionValue> extends BaseField {
  readonly type: "select";
  readonly options: readonly FieldOption<Value>[];
}

export interface RadioField<Value extends OptionValue = OptionValue> extends BaseField {
  readonly type: "radio";
  readonly options: readonly FieldOption<Value>[];
}

/** Kinds of rows a {@link ReferenceField} can point at. */
export const REFERENCE_SOURCES = [
  "teams",
  "sections",
  "venues",
  "postCategories",
  "media",
] as const;
export type ReferenceSource = (typeof REFERENCE_SOURCES)[number];

/**
 * The id of a row of the instance (a team, a section, a venue, a news category, an image), chosen
 * in a list the editor fills from the instance; stored as a number, `0` for none. A block shows
 * nothing, or all rows, for `0`, and must expect an id whose row was deleted since.
 */
export interface ReferenceField extends BaseField {
  readonly type: "reference";
  readonly source: ReferenceSource;
  /** Label of the `0` choice (« Toutes les équipes »); without it, a row must be chosen. */
  readonly emptyLabel?: string;
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
export interface ArrayField<Item extends BlockProps = BlockProps> extends BaseField {
  readonly type: "array";
  readonly arrayFields: Fields<Item>;
  /** Props of an item added in the editor. */
  readonly defaultItemProps?: Readonly<Partial<Item>>;
  readonly min?: number;
  readonly max?: number;
}

export interface ObjectField<Props extends BlockProps = BlockProps> extends BaseField {
  readonly type: "object";
  readonly objectFields: Fields<Props>;
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
  | ObjectField
  | ReferenceField;

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

/**
 * Props received by `render`: the field values with slots ready to render, plus the block id and,
 * for a block with a `loader`, the data it loaded.
 */
export type BlockRenderProps<Props extends BlockProps, Data = undefined> = WithSlots<Props> & {
  readonly id: string;
} & (undefined extends Data ? { readonly data?: Data } : { readonly data: Data });

/** What a block `loader` receives besides the props of the block. */
export interface BlockLoaderContext {
  /** Sports content of the instance (public data only). */
  readonly sport: SportReader;
  /** News, partners and media of the instance (public data only). */
  readonly content: ContentReader;
  /** Time of the rendering: what is "upcoming" is relative to it. */
  readonly now: Date;
  /**
   * The loaded data stays right until `date` at most (the first upcoming match starts…): the
   * server renders the page again after it, even if no event made it out of date.
   */
  expiresAt(date: Date): void;
}

/** A `select` or `radio` field whose options store values of type `Value`. */
export type ChoiceField<Value extends OptionValue> = SelectField<Value> | RadioField<Value>;

/**
 * The fields that can edit a prop of type `Value`, so that a block's `fields` and its props type
 * cannot disagree (a `Slot` prop needs a `slot` field, a `RichText` prop a `richtext` field…):
 * - `Slot` → `slot`;
 * - `string` → `text`, `textarea`, `select` or `radio`; a union of string literals (`"left" |
 *   "center"`) → `select` or `radio` with options of those values only;
 * - `number` → `number`, `select`, `radio` or `reference`; a union of number literals →
 *   `select` or `radio`;
 * - `boolean` → `boolean`, `select` or `radio`;
 * - `RichText` → `richtext` (the stored HTML reaches `render` as a node, not a string);
 * - a list of objects → `array` whose `arrayFields` match the item type;
 * - an object → `object` whose `objectFields` match it.
 * A prop typed `unknown` accepts any field.
 */
export type FieldFor<Value> = unknown extends Value
  ? Field
  : [ReactNode] extends [Value]
    ? RichtextField
    : DefinedFieldFor<Exclude<Value, undefined>>;

/** {@link FieldFor} of a prop that is set (an optional prop is edited like a required one). */
type DefinedFieldFor<Value> = [Value] extends [Slot]
  ? SlotField
  : [Value] extends [string]
    ? string extends Value
      ? TextField | TextareaField | ChoiceField<Value>
      : ChoiceField<Value>
    : [Value] extends [number]
      ? number extends Value
        ? NumberField | ChoiceField<Value> | ReferenceField
        : ChoiceField<Value>
      : [Value] extends [boolean]
        ? BooleanField | ChoiceField<Value>
        : [Value] extends [readonly (infer Item)[]]
          ? Item extends BlockProps
            ? ArrayField<Item>
            : never
          : Value extends BlockProps
            ? ObjectField<Value>
            : never;

/**
 * One field per prop, of a type that can edit it ({@link FieldFor}). Without a precise props
 * type (`BlockProps`, whose props are `unknown`), any field fits any prop.
 */
export type Fields<Props extends BlockProps> = {
  readonly [Key in keyof Props]-?: FieldFor<Props[Key]>;
};

/** Definition of a block type, shared by the editor and the public renderer. */
export interface BlockDefinition<Props extends BlockProps = BlockProps, Data = unknown> {
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
  /**
   * Events after which a page showing this block is out of date (`match.result_published`…):
   * the server forgets the cached HTML of every page rendered with the block when one of them
   * is emitted. For blocks showing data that changes without the page being published again.
   */
  readonly dependsOn?: readonly string[];
  /**
   * Loads what the block shows from the instance (upcoming matches…), before it renders: on the
   * server for the public site, through the API in the editor. It receives the props as stored
   * once checked against the fields (slots as lists of blocks, rich text as HTML), and what it
   * returns reaches `render` as `data`. When it fails, or takes longer than a few seconds, the
   * block is left out of the page (like a block whose `render` throws).
   */
  loader?(props: Props, context: BlockLoaderContext): Promise<Data>;
  /**
   * Renders the block; must stay a pure function of its props and of the data of its `loader`
   * (rendered synchronously on the server).
   */
  render(props: BlockRenderProps<Props, Data>): ReactNode;
}

/** Declares a block, keeping its props type (and the type of the data of its `loader`). */
export function defineBlock<Props extends BlockProps, Data = undefined>(
  definition: BlockDefinition<Props, Data>,
): BlockDefinition<Props, Data> {
  return definition;
}
