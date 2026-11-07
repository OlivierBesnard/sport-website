import type { SlotField } from "./types.js";

/**
 * Whether a slot accepts a block of type `type`: listed in `allow` when the slot restricts the
 * types, and absent from `disallow`. The editor applies it when it adds a block, the server when
 * it validates stored content: both read the same rule from the block definitions.
 */
export function slotAccepts(field: SlotField, type: string): boolean {
  if (field.allow !== undefined && !field.allow.includes(type)) {
    return false;
  }
  return field.disallow === undefined || !field.disallow.includes(type);
}
