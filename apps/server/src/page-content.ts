import {
  type BlockRegistry,
  type Field,
  type SlotField,
  safeImageUrl,
  slotAccepts,
} from "@sport-cms/blocks";

/**
 * Checks run on page data before it is saved or published, mirroring what the public renderer
 * does: only well-formed blocks (`{ type, props }`) count, slot fields are walked wherever they
 * sit (a top-level prop, inside an array item or an object field, as `resolveProps` does), and
 * props are read the way `resolveProps` would resolve them (a non-boolean is `false`, a
 * non-string is empty).
 */

/** One problem found in the content, with the data path of the block it concerns. */
export interface ContentIssue {
  /** Path in the page data, e.g. `content.2.alt` or `content.0.first[].1` (a nested block). */
  readonly path: string;
  /** Message in French, shown as is in the back-office. */
  readonly message: string;
}

interface BlockNode {
  /** Path of the block in the page data, for the messages. */
  readonly path: string;
  readonly type: string;
  readonly props: Record<string, unknown>;
  /** The slot the block sits in, with the type of its parent; absent at the root of the page. */
  readonly slot?: { readonly field: SlotField; readonly parentType: string };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** The well-formed blocks of a stored list, with the data path of each one. */
function toNodes(items: readonly unknown[], prefix: string, slot?: BlockNode["slot"]): BlockNode[] {
  const nodes: BlockNode[] = [];
  for (const [index, item] of items.entries()) {
    if (!isRecord(item) || typeof item.type !== "string" || !isRecord(item.props)) {
      continue;
    }
    nodes.push({
      path: `${prefix}${index}`,
      type: item.type,
      props: item.props,
      ...(slot === undefined ? {} : { slot }),
    });
  }
  return nodes;
}

/**
 * Where the slots of a block definition sit in its props: a top-level prop (`name`), a slot of
 * each item of an array field (`name[].sub`) or a slot of an object field (`name.sub`).
 */
function slotPaths(
  fields: Readonly<Record<string, Field>>,
): Array<{ readonly path: string; readonly field: SlotField }> {
  const paths: Array<{ readonly path: string; readonly field: SlotField }> = [];
  for (const [name, field] of Object.entries(fields)) {
    if (field.type === "slot") {
      paths.push({ path: name, field });
    } else if (field.type === "array") {
      for (const [sub, subField] of Object.entries(field.arrayFields)) {
        if (subField.type === "slot") {
          paths.push({ path: `${name}[].${sub}`, field: subField });
        }
      }
    } else if (field.type === "object") {
      for (const [sub, subField] of Object.entries(field.objectFields)) {
        if (subField.type === "slot") {
          paths.push({ path: `${name}.${sub}`, field: subField });
        }
      }
    }
  }
  return paths;
}

/** The lists of nested blocks one slot path points at, in the props of one block. */
function slotLists(props: Record<string, unknown>, slotPath: string): readonly unknown[][] {
  const arrayMarker = slotPath.indexOf("[].");
  if (arrayMarker >= 0) {
    // `name[].sub`: one list per item of the array stored in `props.name`.
    const name = slotPath.slice(0, arrayMarker);
    const sub = slotPath.slice(arrayMarker + 3);
    const items = props[name];
    if (!Array.isArray(items)) {
      return [];
    }
    return items.filter(isRecord).map((item) => (Array.isArray(item[sub]) ? item[sub] : []));
  }
  const dot = slotPath.indexOf(".");
  if (dot < 0) {
    // `name`: the slot itself.
    const value = props[slotPath];
    return [Array.isArray(value) ? value : []];
  }
  // `name.sub`: the slot of the object stored in `props.name`.
  const name = slotPath.slice(0, dot);
  const sub = slotPath.slice(dot + 1);
  const container = props[name];
  return [isRecord(container) && Array.isArray(container[sub]) ? container[sub] : []];
}

/** Path prefix of the blocks nested in `listIndex`-th list of a slot. */
function nestedPrefix(nodePath: string, slotPath: string, listIndex: number): string {
  const arrayMarker = slotPath.indexOf("[].");
  if (arrayMarker >= 0) {
    const name = slotPath.slice(0, arrayMarker);
    const sub = slotPath.slice(arrayMarker + 3);
    return `${nodePath}.${name}.${listIndex}.${sub}.`;
  }
  return `${nodePath}.${slotPath}.`;
}

/** Every block of the data, the top-level ones first, then the nested ones with their path. */
export function walkBlocks(data: unknown, registry: BlockRegistry): BlockNode[] {
  const content = isRecord(data) && Array.isArray(data.content) ? data.content : [];
  const nodes: BlockNode[] = [];
  const queue: BlockNode[] = toNodes(content, "content.");
  while (queue.length > 0) {
    const node = queue.shift();
    if (node === undefined) {
      continue;
    }
    nodes.push(node);
    const definition = registry.get(node.type);
    if (definition === undefined) {
      continue;
    }
    for (const { path: slotPath, field } of slotPaths(definition.fields)) {
      slotLists(node.props, slotPath).forEach((items, listIndex) => {
        queue.push(
          ...toNodes(items, nestedPrefix(node.path, slotPath, listIndex), {
            field,
            parentType: node.type,
          }),
        );
      });
    }
  }
  return nodes;
}

const ROOT_BLOCK_TYPES = new Set(["Hero", "Section"]);

/**
 * Problems that make the content unfit for the public site, whatever the publication:
 * - a block that is neither a Hero nor a Section at the root of the page (the page layout is a
 *   stack of full-width bands; anything else belongs inside a Section or Columns);
 * - a nested block that its slot refuses (`allow` / `disallow` of the slot field: no Section in a
 *   Section, no Columns in Columns…), the rule the editor applies when it adds a block;
 * - an informative image (an Image, or the image of a Hero) without alternative text, unless the
 *   person editing marked it as decorative.
 */
export function findContentIssues(data: unknown, registry: BlockRegistry): ContentIssue[] {
  const issues: ContentIssue[] = [];
  const content = isRecord(data) && Array.isArray(data.content) ? data.content : [];
  for (const node of toNodes(content, "content.")) {
    if (!ROOT_BLOCK_TYPES.has(node.type)) {
      const label = registry.get(node.type)?.label ?? node.type;
      issues.push({
        path: node.path,
        message:
          `Seuls les blocs « Bannière d'accueil » et « Section » peuvent être posés à la racine ` +
          `de la page : placez « ${label} » dans une section.`,
      });
    }
  }
  for (const node of walkBlocks(data, registry)) {
    if (node.slot !== undefined && !slotAccepts(node.slot.field, node.type)) {
      const label = registry.get(node.type)?.label ?? node.type;
      const parent = registry.get(node.slot.parentType)?.label ?? node.slot.parentType;
      issues.push({
        path: node.path,
        message:
          `Le bloc « ${label} » ne peut pas être placé dans un bloc « ${parent} » : ` +
          "déplacez-le ailleurs dans la page.",
      });
    }
    if (node.type === "Image") {
      const { src, alt, decorative } = node.props;
      if (safeImageUrl(src) !== undefined && decorative !== true && !isNonEmptyString(alt)) {
        issues.push({
          path: `${node.path}.alt`,
          message:
            "Cette image a besoin d'un texte alternatif : décrivez ce qu'elle montre, " +
            "ou cochez « image décorative » si elle n'apporte aucune information.",
        });
      }
    }
    if (node.type === "Hero") {
      const { imageSrc, imageAlt, decorative } = node.props;
      if (
        safeImageUrl(imageSrc) !== undefined &&
        decorative !== true &&
        !isNonEmptyString(imageAlt)
      ) {
        issues.push({
          path: `${node.path}.imageAlt`,
          message:
            "L'image de cette bannière a besoin d'un texte alternatif : décrivez ce qu'elle " +
            "montre, ou cochez « image décorative » si elle n'apporte aucune information.",
        });
      }
    }
  }
  return issues;
}

/**
 * How many level 1 headings the page would show: a Heading block at level 1 with a text, plus
 * every Hero with a title (a Hero renders its title as an `h1`).
 */
export function countLevel1Headings(data: unknown, registry: BlockRegistry): number {
  let count = 0;
  for (const node of walkBlocks(data, registry)) {
    if (node.type === "Heading" && node.props.level === 1 && isNonEmptyString(node.props.text)) {
      count += 1;
    }
    if (node.type === "Hero" && isNonEmptyString(node.props.title)) {
      count += 1;
    }
  }
  return count;
}
