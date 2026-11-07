import type { BlockRegistry } from "../registry.js";
import type { BlockLoaderContext } from "../types.js";
import { isRecord, resolveProps } from "./props.js";
import { type BlockErrorContext, MAX_NESTING_DEPTH } from "./render.js";

/** Longest a block `loader` may take; beyond it the block is left out of the page. */
export const BLOCK_LOADER_TIMEOUT_MS = 5000;

/**
 * Data loaded for the blocks of a page, by the stored props object of each block (the very
 * object of the page data): {@link renderPageContent} gives each block its own, even when two
 * blocks share an id. A block with a `loader` absent from it failed to load.
 */
export type LoadedBlocks = ReadonlyMap<object, { readonly data: unknown }>;

export interface LoadOptions {
  readonly registry: BlockRegistry;
  readonly context: BlockLoaderContext;
  /** Called for each block whose `loader` failed or timed out: it will be left out. */
  readonly onBlockError?: (error: unknown, block: BlockErrorContext) => void;
  readonly timeoutMs?: number;
}

/** Error of a loader that did not answer in time. */
export class BlockLoaderTimeoutError extends Error {
  constructor(block: BlockErrorContext, timeoutMs: number) {
    super(
      `Les données du bloc « ${block.type} » (${block.id}) n'ont pas été chargées en ` +
        `${timeoutMs} ms.`,
    );
    this.name = "BlockLoaderTimeoutError";
  }
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  block: BlockErrorContext,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BlockLoaderTimeoutError(block, timeoutMs)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the `loader` of every block of page data (Puck format) that has one, nested blocks
 * included, all at once, before the page renders: rendering stays synchronous. Walks the page
 * the way {@link renderPageContent} does (unknown types and malformed items are skipped, with
 * their nested blocks; same depth limit), and gives each loader the props checked against the
 * block's fields (defaults for what is missing or invalid).
 */
export async function loadPageBlocks(data: unknown, options: LoadOptions): Promise<LoadedBlocks> {
  const loaded = new Map<object, { data: unknown }>();
  const pending: Promise<void>[] = [];
  const timeoutMs = options.timeoutMs ?? BLOCK_LOADER_TIMEOUT_MS;

  const visit = (items: readonly unknown[], depth: number): void => {
    if (depth > MAX_NESTING_DEPTH) {
      return;
    }
    items.forEach((item, index) => {
      if (!isRecord(item) || typeof item.type !== "string" || !isRecord(item.props)) {
        return;
      }
      const definition = options.registry.get(item.type);
      if (definition === undefined) {
        return;
      }
      const nested: (readonly unknown[])[] = [];
      let props: Record<string, unknown>;
      try {
        props = resolveProps(definition.fields, item.props, definition.defaultProps, {
          slot: (list) => {
            nested.push(list);
            return list;
          },
          richtext: (html) => html,
        });
      } catch {
        // The render will meet the same failure and report it.
        return;
      }
      const storedId = item.props.id;
      const block = {
        type: item.type,
        id: typeof storedId === "string" && storedId !== "" ? storedId : `${item.type}-${index}`,
      };
      const { loader } = definition;
      if (loader !== undefined) {
        const target = item.props;
        pending.push(
          withTimeout(
            Promise.resolve().then(() => loader.call(definition, props, options.context)),
            timeoutMs,
            block,
          ).then(
            (value) => {
              loaded.set(target, { data: value });
            },
            (error: unknown) => {
              options.onBlockError?.(error, block);
            },
          ),
        );
      }
      for (const list of nested) {
        visit(list, depth + 1);
      }
    });
  };

  visit(isRecord(data) && Array.isArray(data.content) ? data.content : [], 0);
  await Promise.all(pending);
  return loaded;
}
