import type { ReactNode } from "react";
import type { BlockRegistry } from "../registry.js";
import type { BlockProps, BlockRenderProps, SlotComponent, SlotProps } from "../types.js";
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

export interface RenderOptions {
  /** Blocks that can be rendered; any other type is left out. */
  readonly registry: BlockRegistry;
  /**
   * Called when the `render` function of a block throws: that block is left out and the rest of
   * the page renders. Only errors thrown by `render` itself are caught this way; an error thrown
   * later by a component it returns fails the whole rendering.
   */
  readonly onBlockError?: (error: unknown, block: BlockErrorContext) => void;
}

interface BlockEntry {
  /** React key, unique within its list even when stored ids are missing or repeated. */
  readonly key: string;
  readonly type: string;
  readonly id: string;
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
    <BlockItem key={entry.key} entry={entry} depth={depth} options={options} />
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

function BlockItem({ entry, depth, options }: BlockItemProps): ReactNode {
  const definition = options.registry.get(entry.type);
  if (definition === undefined) {
    return null;
  }
  try {
    const props = resolveProps(definition.fields, entry.props, definition.defaultProps, {
      slot: (items) => slotComponent(items, depth + 1, options),
      richtext: richTextNode,
    });
    return definition.render({ ...props, id: entry.id } as BlockRenderProps<BlockProps>);
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
 * - a block whose `render` function throws is left out and reported to `onBlockError` (an error
 *   thrown later, by a component that `render` returned, is not caught here).
 *
 * Content that is not page data renders nothing. `root` and `zones` are not rendered: the page
 * layout belongs to the server, and the core blocks nest through slots, not drop zones.
 */
export function renderPageContent(data: unknown, options: RenderOptions): ReactNode {
  const content = isRecord(data) && Array.isArray(data.content) ? data.content : [];
  return <BlockList items={content} depth={0} options={options} />;
}
