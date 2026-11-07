// Root entry, usable on the server and in the browser (back-office, E08): no Node.js built-ins.
// The block contract is the one of `@sport-cms/blocks`, re-exported: module blocks are rendered
// and edited exactly like the core blocks.
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
  type RadioField,
  type RichText,
  type RichtextField,
  type SelectField,
  type Slot,
  type SlotComponent,
  type SlotField,
  type SlotProps,
  safeImageUrl,
  safeLinkUrl,
  type TextareaField,
  type TextField,
} from "@sport-cms/blocks";
export type { ModuleContext, ModuleKv, ModuleLogger } from "./context.js";
export {
  type DataProcessing,
  defineModule,
  type ModuleDefinition,
  type ModuleLifecycle,
} from "./define.js";
export type { JsonObject, JsonValue } from "./json.js";
export {
  checkModuleDefinition,
  MODULE_ID_PATTERN,
  type ModuleCheck,
  type ModuleManifest,
  moduleManifestSchema,
  parseModuleManifest,
} from "./manifest.js";
