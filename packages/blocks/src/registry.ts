import type { BlockDefinition } from "./types.js";

/** Block definitions by type: what the editor offers and what the public renderer knows. */
export type BlockRegistry = ReadonlyMap<string, BlockDefinition>;

/**
 * Indexes block definitions by type.
 *
 * @throws {Error} when two definitions share a type: one of them could never be rendered.
 */
export function createBlockRegistry(blocks: Iterable<BlockDefinition>): BlockRegistry {
  const registry = new Map<string, BlockDefinition>();
  for (const block of blocks) {
    if (registry.has(block.type)) {
      throw new Error(`Duplicate block type: ${block.type}`);
    }
    registry.set(block.type, block);
  }
  return registry;
}
