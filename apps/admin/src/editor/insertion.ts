import { type BlockRegistry, type SlotField, slotAccepts } from "@sport-cms/blocks";

/**
 * Where a click on a component of the drawer adds the block. The rules mirror what the server
 * accepts (`findContentIssues`): the root of the page takes Heroes and Sections only, a slot
 * takes what its `allow` / `disallow` lists let in.
 */

/** The droppable root of Puck's data. */
export const ROOT_ZONE = "root:default-zone";

/** Blocks the root of a page accepts (mirrors the server rule of `page-content.ts`). */
export const ROOT_BLOCK_TYPES: ReadonlySet<string> = new Set(["Hero", "Section"]);

export interface InsertionTarget {
  /** Zone of Puck: `root:default-zone`, or `<id of the parent>:<name of the slot>`. */
  readonly zone: string;
  readonly index: number;
}

export interface EditorSelection {
  /** The selected block, if any. */
  readonly selected: { readonly type: string; readonly props: Record<string, unknown> } | null;
  /** Where the selected block sits (Puck's `itemSelector`; no zone means the root). */
  readonly selector: { readonly index: number; readonly zone?: string } | null;
  /** Type of the block of the given id, to read the rules of the slot it holds. */
  readonly typeOf: (id: string) => string | undefined;
  /** Number of blocks at the root of the page. */
  readonly rootLength: number;
}

/** The slot field of a zone `<parent id>:<slot name>`, when the parent is a known block. */
function slotOfZone(
  zone: string,
  registry: BlockRegistry,
  typeOf: (id: string) => string | undefined,
): SlotField | undefined {
  const separator = zone.lastIndexOf(":");
  if (separator <= 0) {
    return undefined;
  }
  const parentType = typeOf(zone.slice(0, separator));
  const field =
    parentType === undefined
      ? undefined
      : registry.get(parentType)?.fields[zone.slice(separator + 1)];
  return field?.type === "slot" ? field : undefined;
}

/** Whether a block of `type` may sit in `zone`. */
export function zoneAccepts(
  zone: string,
  type: string,
  registry: BlockRegistry,
  typeOf: (id: string) => string | undefined,
): boolean {
  if (zone === ROOT_ZONE) {
    return ROOT_BLOCK_TYPES.has(type);
  }
  const slot = slotOfZone(zone, registry, typeOf);
  return slot !== undefined && slotAccepts(slot, type);
}

/**
 * Where to add a block of `type`, in this order:
 * 1. inside the selected block, at the end of its first slot that accepts the type (a Text
 *    added while a Section is selected lands in the Section);
 * 2. right after the selected block, in its own zone, when that zone accepts the type (a Text
 *    added while a Heading inside a column is selected lands just below the Heading);
 * 3. at the end of the page. For a block the root refuses, the server then reports it at the
 *    next save, with the path of the block: the person editing moves it into a Section.
 */
export function planInsertion(
  type: string,
  selection: EditorSelection,
  registry: BlockRegistry,
): InsertionTarget {
  const { selected, selector, typeOf } = selection;
  if (selected !== null) {
    const id = selected.props.id;
    const definition = registry.get(selected.type);
    if (typeof id === "string" && definition !== undefined) {
      for (const [name, field] of Object.entries(definition.fields)) {
        if (field.type === "slot" && slotAccepts(field, type)) {
          const items = selected.props[name];
          return { zone: `${id}:${name}`, index: Array.isArray(items) ? items.length : 0 };
        }
      }
    }
    if (selector !== null) {
      const zone = selector.zone ?? ROOT_ZONE;
      if (zoneAccepts(zone, type, registry, typeOf)) {
        return { zone, index: selector.index + 1 };
      }
    }
  }
  return { zone: ROOT_ZONE, index: selection.rootLength };
}
