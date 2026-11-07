// Root entry, usable in the browser (editor) and on the server: block contract, core blocks and
// registry. Rendering page data for visitors, which sanitizes rich text, is server-only:
// `@sport-cms/blocks/server`.
export * from "./blocks/index.js";
export { type BlockRegistry, createBlockRegistry } from "./registry.js";
// Pure functions (no Node, no sanitizer): the editor normalizes the props of its preview with
// the same rules as the public renderer.
export { type PropResolvers, resolveProps } from "./server/props.js";
export { slotAccepts } from "./slots.js";
export {
  type ArrayField,
  type BlockDefinition,
  type BlockProps,
  type BlockRenderProps,
  type BooleanField,
  type ChoiceField,
  type ComponentData,
  defineBlock,
  type Field,
  type FieldFor,
  type FieldOption,
  type Fields,
  type NumberField,
  type ObjectField,
  type OptionValue,
  type PageData,
  type RadioField,
  type RichText,
  type RichtextField,
  type SelectField,
  type Slot,
  type SlotComponent,
  type SlotField,
  type SlotProps,
  type TextareaField,
  type TextField,
  type WithSlots,
} from "./types.js";
export { safeImageUrl, safeLinkUrl } from "./url.js";
