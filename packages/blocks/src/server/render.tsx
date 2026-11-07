import { type ReactNode, Suspense } from "react";
import type { BlockRegistry } from "../registry.js";
import type {
  BlockDefinition,
  BlockProps,
  BlockRenderProps,
  SlotComponent,
  SlotProps,
} from "../types.js";
import type { LoadedBlocks } from "./load.js";
import { isRecord, resolveProps } from "./props.js";
import { sanitizeRichText } from "./sanitize.js";

/**
 * Deepest level of nested blocks rendered (0 for the blocks of the page itself). Real pages stay
 * a few levels deep; the limit only stops runaway data from exhausting the stack.
 */
export const MAX_NESTING_DEPTH = 16;

/** Block that failed to render. */
export interface BlockErrorContext {
  readonly type: string;
  readonly id: string;
}

/**
 * Reported for a block when a component it returned failed during the server rendering. React's
 * synchronous server renderer does not hand over the original error: only the block is known.
 */
export class BlockComponentError extends Error {
  constructor(block: BlockErrorContext) {
    super(
      `Un composant du bloc « ${block.type} » (${block.id}) a échoué pendant le rendu ` +
        "(ou attend des données, ce que le rendu serveur ne prend pas en charge).",
    );
    this.name = "BlockComponentError";
  }
}

export interface RenderOptions {
  /** Blocks that can be rendered; any other type is left out. */
  readonly registry: BlockRegistry;
  /**
   * Called when a block fails: that block (with its nested blocks) is left out and the rest of
   * the page renders. Either its `render` function threw (`error` is what it threw), or a
   * component it returned threw while React rendered it (`error` is a
   * {@link BlockComponentError}: the original error is not available).
   */
  readonly onBlockError?: (error: unknown, block: BlockErrorContext) => void;
  /**
   * Called for each block of the registry about to render, nested ones included: the server
   * collects their `dependsOn` to know which events make the page out of date.
   */
  readonly onBlockRendered?: (definition: BlockDefinition) => void;
  /**
   * Data of the blocks with a `loader`, from {@link loadPageBlocks} on the same page data. A block
   * with a loader but no data (its loader failed, already reported) is left out; without
   * `loaded` at all, every such block is left out and reported.
   */
  readonly loaded?: LoadedBlocks;
}

/** Reported for a block with a `loader` rendered without {@link RenderOptions.loaded}. */
export class BlockDataMissingError extends Error {
  constructor(block: BlockErrorContext) {
    super(`Les données du bloc « ${block.type} » (${block.id}) n'ont pas été chargées.`);
    this.name = "BlockDataMissingError";
  }
}

interface BlockEntry {
  /** React key, unique within its list even when stored ids are missing or repeated. */
  readonly key: string;
  readonly type: string;
  readonly id: string;
  /** As stored: the key of the block in {@link RenderOptions.loaded}. */
  readonly props: Readonly<Record<string, unknown>>;
}

/** The well-formed blocks of a stored list (`{ type, props }` objects); others are skipped. */
function toEntries(items: readonly unknown[]): BlockEntry[] {
  const entries: BlockEntry[] = [];
  const keys = new Set<string>();
  for (const item of items) {
    if (!isRecord(item) || typeof item.type !== "string" || !isRecord(item.props)) {
      continue;
    }
    const storedId = item.props.id;
    const id =
      typeof storedId === "string" && storedId !== "" ? storedId : `${item.type}-${entries.length}`;
    let key = id;
    for (let suffix = 1; keys.has(key); suffix++) {
      key = `${id}#${suffix}`;
    }
    keys.add(key);
    entries.push({ key, type: item.type, id, props: item.props });
  }
  return entries;
}

interface BlockListProps {
  readonly items: readonly unknown[];
  readonly depth: number;
  readonly options: RenderOptions;
}

function BlockList({ items, depth, options }: BlockListProps): ReactNode {
  if (depth > MAX_NESTING_DEPTH) {
    return null;
  }
  return toEntries(items).map((entry) => (
    <IsolatedBlock key={entry.key} entry={entry} depth={depth} options={options} />
  ));
}

interface SlotRenderProps extends BlockListProps, SlotProps {}

/** Nested blocks of a slot inside their wrapper, a `div` by default, as with Puck. */
function SlotRender({ className, as: Wrapper = "div", ...list }: SlotRenderProps): ReactNode {
  return (
    <Wrapper className={className}>
      <BlockList {...list} />
    </Wrapper>
  );
}

/** What a block receives for a slot: renders the slot's blocks one level deeper. */
function slotComponent(items: readonly unknown[], depth: number, options: RenderOptions) {
  const render: SlotComponent = (props) => (
    <SlotRender {...props} items={items} depth={depth} options={options} />
  );
  return render;
}

function richTextNode(html: string): ReactNode {
  const sanitized = sanitizeRichText(html);
  if (sanitized.trim() === "") {
    return null;
  }
  // The only place page data reaches the page as raw HTML.
  // biome-ignore lint/security/noDangerouslySetInnerHtml: `sanitized` comes from sanitizeRichText just above (sanitize-html, allow-list of elements and attributes, link addresses filtered by safeLinkUrl), and React cannot render an HTML string otherwise.
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

interface BlockItemProps {
  readonly entry: BlockEntry;
  readonly depth: number;
  readonly options: RenderOptions;
}

/**
 * Rendered by React in place of a block whose components failed: the Suspense boundary around
 * each block catches the error during the server rendering and renders this fallback instead
 * (only then), which reports the block and shows nothing.
 */
function BlockFailure({ entry, options }: Omit<BlockItemProps, "depth">): ReactNode {
  const block = { type: entry.type, id: entry.id };
  options.onBlockError?.(new BlockComponentError(block), block);
  return null;
}

/**
 * One block inside its own boundary: an error thrown by any component it renders, at any depth,
 * leaves out this block only (a nested block that fails leaves out itself, not its parent).
 */
function IsolatedBlock(props: BlockItemProps): ReactNode {
  return (
    <Suspense fallback={<BlockFailure entry={props.entry} options={props.options} />}>
      <BlockItem {...props} />
    </Suspense>
  );
}

function BlockItem({ entry, depth, options }: BlockItemProps): ReactNode {
  const definition = options.registry.get(entry.type);
  if (definition === undefined) {
    return null;
  }
  options.onBlockRendered?.(definition);
  let data: unknown;
  if (definition.loader !== undefined) {
    const loaded = options.loaded?.get(entry.props);
    if (loaded === undefined) {
      if (options.loaded === undefined) {
        const block = { type: entry.type, id: entry.id };
        options.onBlockError?.(new BlockDataMissingError(block), block);
      }
      return null;
    }
    data = loaded.data;
  }
  try {
    const props = resolveProps(definition.fields, entry.props, definition.defaultProps, {
      slot: (items) => slotComponent(items, depth + 1, options),
      richtext: richTextNode,
    });
    return definition.render({ ...props, id: entry.id, data } as BlockRenderProps<
      BlockProps,
      unknown
    >);
  } catch (error) {
    options.onBlockError?.(error, { type: entry.type, id: entry.id });
    return null;
  }
}

/**
 * Renders the blocks of page data in Puck's format (`{ root, content, zones }`), walking the
 * page content and the slots of each block, the way Puck's `<Render>` does but without Puck:
 * - a block whose type is not in the registry (written by a newer version, or by a module that
 *   is disabled) is left out, and so is an item that is not a `{ type, props }` object;
 * - props are checked against the block fields, falling back to the block defaults;
 * - rich text fields are sanitized and reach `render` as nodes, slots as components;
 * - a block that fails is left out and reported to `onBlockError`, whether its `render` function
 *   threw or a component it returned did (each block renders inside its own Suspense boundary,
 *   which React's server renderer turns into its fallback on error). Rendered with
 *   `renderToStaticMarkup`, the boundaries leave no marker in the HTML.
 *
 * Content that is not page data renders nothing. `root` and `zones` are not rendered: the page
 * layout belongs to the server, and the core blocks nest through slots, not drop zones.
 */
export function renderPageContent(data: unknown, options: RenderOptions): ReactNode {
  const content = isRecord(data) && Array.isArray(data.content) ? data.content : [];
  return <BlockList items={content} depth={0} options={options} />;
}
