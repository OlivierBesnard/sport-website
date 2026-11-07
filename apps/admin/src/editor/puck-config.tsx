import { type Config, type Overrides, type Data as PuckData, useGetPuck } from "@puckeditor/core";
import {
  type BlockDefinition,
  type Field as BlockField,
  type BlockRegistry,
  type BooleanField,
  type PageData,
  resolveProps,
} from "@sport-cms/blocks";
import { Component, createContext, type ReactNode, useContext, useEffect } from "react";
import { planInsertion, ROOT_ZONE } from "./insertion";

/**
 * The Puck configuration of the editor, built from the same block definitions the public site
 * renders: what the person editing manipulates is exactly what the visitors will see.
 *
 * - A block definition is a Puck component as is (fields, default props, render).
 * - The `boolean` fields of the contract (Puck has no single checkbox) become a two-choice
 *   radio group, still storing a boolean.
 * - The root of the page carries the metadata of the published version (`root.props`): its
 *   title, its description and its sharing image.
 * - A click on a component of the drawer adds it where it belongs (`planInsertion`): drag and
 *   drop stays possible, but a click is what a volunteer will try first.
 * - Each block renders from props normalized like the public renderer does (`resolveProps`:
 *   defaults for missing or invalid values), inside an error boundary: one broken block shows a
 *   message in the preview instead of blanking the whole editor.
 */

/** The two choices of a boolean field, as Puck renders them. */
const BOOLEAN_CHOICES = [
  { label: "Oui", value: true },
  { label: "Non", value: false },
] as const;

/** Turns one field of the contract into the field Puck expects. */
function toPuckField(field: BlockField): Record<string, unknown> {
  if (field.type === "boolean") {
    const boolean: BooleanField = field;
    return { type: "radio", label: boolean.label, options: BOOLEAN_CHOICES };
  }
  // The other fields share their shape with Puck's: they pass as they are.
  return field as unknown as Record<string, unknown>;
}

function toPuckFields(
  fields: Readonly<Record<string, BlockField>>,
): Record<string, Record<string, unknown>> {
  const puck: Record<string, Record<string, unknown>> = {};
  for (const [name, field] of Object.entries(fields)) {
    puck[name] = toPuckField(field);
  }
  return puck;
}

/**
 * The drawer item of the editor: a click adds the component where `planInsertion` says — inside
 * the selected container when one of its slots accepts it, right after the selected block when
 * its zone accepts it, at the end of the page otherwise — and selects it. The drag and drop of
 * Puck keeps working (the drag handle is the item itself, outside this button). A click is what
 * a volunteer will try first; a real `button` keeps it accessible.
 */
function ClickableDrawerItem(props: { name: string; children: ReactNode }): ReactNode {
  const getPuck = useGetPuck();
  const registry = useContext(EditorRegistryContext);
  const add = (): void => {
    const puck = getPuck();
    const selected = puck.selectedItem;
    const rootLength = puck.appState.data.content.length;
    const { zone, index } =
      registry === undefined
        ? { zone: ROOT_ZONE, index: rootLength }
        : planInsertion(
            props.name,
            {
              selected:
                selected === null
                  ? null
                  : {
                      type: String(selected.type),
                      props: selected.props as Record<string, unknown>,
                    },
              selector: puck.appState.ui.itemSelector ?? null,
              typeOf: (id) => {
                const item = puck.getItemById(id);
                return item === undefined ? undefined : String(item.type);
              },
              rootLength,
            },
            registry,
          );
    // The raw `insert` action does not select the new block: select it so the fields pane
    // shows it — an empty block often shows nothing in the canvas, and its fields are the
    // next step.
    puck.dispatch({
      type: "insert",
      componentType: props.name,
      destinationZone: zone,
      destinationIndex: index,
    });
    puck.dispatch({ type: "setUi", ui: { itemSelector: { index, zone } } });
  };
  return (
    <button
      type="button"
      // Full width: the wrapper of Puck's drawer item spans the whole column, and a click
      // anywhere on the item must add the block.
      className="w-full cursor-pointer text-left"
      title="Cliquer pour ajouter : dans le bloc sélectionné, juste après lui, ou à la fin de la page (ou glisser-déposer)"
      onClick={add}
    >
      {props.children}
    </button>
  );
}

/** The fields of the root of the page: the metadata of the published version. */
const ROOT_FIELDS = {
  title: { type: "text", label: "Titre de la page (affiché dans l'onglet et les partages)" },
  description: { type: "textarea", label: "Description (moteurs de recherche, partages)" },
  image: { type: "text", label: "Image de partage (adresse https:// ou /media/…)" },
} as const;

/** Marks the style element of the theme in the canvas, to find it again. */
export const THEME_STYLE_ATTRIBUTE = "data-cms-theme";

/**
 * Puts the stylesheet of the public site into the document of the canvas (or replaces the one
 * already there) and returns what takes it out again. An inline `<style>`: the CSP of the
 * back-office allows it (`style-src 'self' 'unsafe-inline'`) and the canvas has no URL of its own.
 */
export function injectStylesheet(document: Document, css: string): () => void {
  for (const previous of document.head.querySelectorAll(`style[${THEME_STYLE_ATTRIBUTE}]`)) {
    previous.remove();
  }
  const style = document.createElement("style");
  style.setAttribute(THEME_STYLE_ATTRIBUTE, "");
  style.textContent = css;
  document.head.appendChild(style);
  return () => {
    style.remove();
  };
}

/**
 * Stylesheet of the public site (`buildThemeCss` of `@sport-cms/themes`) for the canvas: the
 * editor page provides it around `<Puck>`; React passes it on into the iframe, a portal.
 */
export const CanvasStylesheetContext = createContext<string | undefined>(undefined);

/** The `iframe` override of Puck: the canvas, with the stylesheet of the site in its head. */
function ThemedCanvas(props: { children: ReactNode; document?: Document }): ReactNode {
  const { document } = props;
  const css = useContext(CanvasStylesheetContext);
  useEffect(
    () =>
      document === undefined || css === undefined ? undefined : injectStylesheet(document, css),
    [document, css],
  );
  // Last resort: an error outside of any block (the blocks have their own boundary).
  return (
    <PreviewBoundary
      fallback={
        <p role="alert">
          L'aperçu ne peut pas être affiché. Enregistrez votre travail et rechargez la page.
        </p>
      }
    >
      {props.children}
    </PreviewBoundary>
  );
}

/**
 * Registry of the editor, for the drawer items (rules of the slots). The editor page provides it
 * around `<Puck>`, with the registry the configuration was built from.
 */
export const EditorRegistryContext = createContext<BlockRegistry | undefined>(undefined);

/** Catches a rendering error of its children and shows `fallback` instead. */
class PreviewBoundary extends Component<
  { readonly fallback: ReactNode; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/** Message shown in the preview in place of a block that cannot render. */
function BrokenBlock(props: { label: string }): ReactNode {
  return (
    <p role="alert" className="cms-container">
      Le bloc « {props.label} » ne peut pas être affiché dans l'aperçu : vérifiez ses champs.
    </p>
  );
}

/**
 * Props for the `render` of a block in the editor: the values Puck holds, normalized like the
 * public renderer normalizes stored values (`resolveProps`: the default for a missing or invalid
 * value), except the slots and the rich texts, which Puck hands over ready to render (a
 * component, an editable node) and which stay as they are.
 */
export function editorProps(
  definition: BlockDefinition,
  puckProps: Record<string, unknown>,
): Record<string, unknown> {
  const plainFields: Record<string, BlockField> = {};
  for (const [name, field] of Object.entries(definition.fields)) {
    if (field.type !== "slot" && field.type !== "richtext") {
      plainFields[name] = field;
    }
  }
  const resolved = resolveProps(plainFields, puckProps, definition.defaultProps, {
    slot: (items) => items,
    richtext: (html) => html,
  });
  return { ...puckProps, ...resolved };
}

/** The `render` of a block in the editor: normalized props, behind an error boundary. */
function editorRender(definition: BlockDefinition) {
  return (puckProps: Record<string, unknown>): ReactNode => (
    <PreviewBoundary fallback={<BrokenBlock label={definition.label} />}>
      <BlockPreview definition={definition} puckProps={puckProps} />
    </PreviewBoundary>
  );
}

/** One block of the preview: a component of its own, so that its errors reach the boundary. */
function BlockPreview(props: {
  definition: BlockDefinition;
  puckProps: Record<string, unknown>;
}): ReactNode {
  return props.definition.render(editorProps(props.definition, props.puckProps) as never);
}

/**
 * Stand-in of a block whose type the registry does not know: a block of a module disabled or
 * removed since the page was written. The public site leaves it out; the editor says so, in
 * French, instead of Puck's English message, and the block can still be moved or deleted.
 */
function UnavailableBlock(props: { type: string }): ReactNode {
  return (
    <p role="note" className="cms-container">
      Bloc indisponible (« {props.type} ») : il vient d'un module désactivé ou absent et n'est pas
      affiché sur le site. Réactivez le module ou supprimez ce bloc.
    </p>
  );
}

/** Types of the blocks of `data` (content, zones and slots, at any depth) unknown to `registry`. */
export function unavailableBlockTypes(data: unknown, registry: BlockRegistry): string[] {
  const unknown = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) {
        visit(item);
      }
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    const record = value as { type?: unknown; props?: unknown };
    if (typeof record.type === "string" && typeof record.props === "object") {
      if (!registry.has(record.type)) {
        unknown.add(record.type);
      }
      for (const prop of Object.values(record.props ?? {})) {
        visit(prop);
      }
      return;
    }
    for (const nested of Object.values(record)) {
      visit(nested);
    }
  };
  const page = typeof data === "object" && data !== null ? data : {};
  visit((page as { content?: unknown }).content);
  visit((page as { zones?: unknown }).zones);
  return [...unknown].sort();
}

export interface EditorConfig {
  readonly config: Config;
  readonly overrides: Overrides;
}

/**
 * Builds the Puck configuration of a block registry, once per registry. `unavailable`: block
 * types of the page the registry does not know ({@link unavailableBlockTypes}), shown as a
 * notice in the canvas and hidden from the drawer.
 */
export function buildEditorConfig(
  registry: BlockRegistry,
  unavailable: readonly string[] = [],
): EditorConfig {
  const components: Record<string, unknown> = {};
  for (const [type, definition] of registry) {
    components[type] = {
      label: definition.label,
      fields: toPuckFields(definition.fields),
      render: editorRender(definition),
      defaultProps: { ...definition.defaultProps },
    };
  }
  const missing = unavailable.filter((type) => !registry.has(type));
  for (const type of missing) {
    components[type] = {
      label: `Bloc indisponible (${type})`,
      fields: {},
      render: () => <UnavailableBlock type={type} />,
    };
  }
  const config = {
    components,
    // Without stand-ins, no category: the drawer stays a plain list of the blocks.
    ...(missing.length === 0
      ? {}
      : {
          categories: {
            unavailable: { components: missing, visible: false },
            other: { title: "Blocs" },
          },
        }),
    root: {
      fields: ROOT_FIELDS,
      render: ({ children }: { children?: ReactNode }) => children ?? null,
    },
  };
  const overrides = { drawerItem: ClickableDrawerItem, iframe: ThemedCanvas };
  return { config: config as unknown as Config, overrides: overrides as unknown as Overrides };
}

/** The stored data of a page, as Puck expects it (unknown shapes fall back to an empty page). */
export function toPuckData(data: unknown): PuckData {
  const record = typeof data === "object" && data !== null && !Array.isArray(data) ? data : {};
  const root =
    typeof (record as { root?: unknown }).root === "object" &&
    (record as { root?: object }).root !== null
      ? (record as { root: object }).root
      : { props: {} };
  const content = Array.isArray((record as { content?: unknown }).content)
    ? (record as { content: unknown[] }).content
    : [];
  const zones =
    typeof (record as { zones?: unknown }).zones === "object" &&
    (record as { zones?: object }).zones !== null
      ? (record as { zones: object }).zones
      : {};
  return { root, content, zones } as unknown as PuckData;
}

/** The data of the editor, as the API stores it. */
export function fromPuckData(data: PuckData): PageData {
  return {
    root: { props: (data.root as { props?: Record<string, unknown> }).props ?? {} },
    content: data.content,
    zones: data.zones ?? {},
  } as unknown as PageData;
}
