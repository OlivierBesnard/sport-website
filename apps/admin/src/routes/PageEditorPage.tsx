import "@puckeditor/core/puck.css";
import { Puck, type Data as PuckData, type Viewport } from "@puckeditor/core";
import type { PageData } from "@sport-cms/blocks";
import { buildThemeCss, defaultTheme } from "@sport-cms/themes";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  apiContentReader,
  apiSportReader,
  fetchReferences,
  NO_REFERENCES,
  type ReferenceOptions,
} from "../api/block-data";
import { ApiError } from "../api/errors";
import {
  fetchPage,
  listVersions,
  type PageDraft,
  type PageVersion,
  publishPage,
  restoreVersion,
  saveDraft,
} from "../api/pages";
import { Button, FormError } from "../components/ui";
import {
  BlockDataContext,
  buildEditorConfig,
  CanvasStylesheetContext,
  EditorRegistryContext,
  fromPuckData,
  toPuckData,
  unavailableBlockTypes,
} from "../editor/puck-config";
import { useModules } from "../modules/context";

/**
 * Editor of one page: the same block definitions the public site renders, the draft saved on
 * demand, the publication in one step, and the history of the versions with restoration. The
 * preview runs in the Puck canvas, in a mobile or a desktop viewport, styled by the stylesheet of
 * the public site — the default theme, the one the instance serves until the theme of the club
 * becomes configurable (the editor will then read it from the instance).
 *
 * The blocks are those of the core and of the enabled modules (`useModules`, the same set the
 * server renders); a block of the page whose module is disabled or absent shows as a notice.
 */
const siteStylesheet = buildThemeCss(defaultTheme);

/** The viewports of the preview: a phone and a laptop, the sizes the club thinks in. */
const VIEWPORTS: Viewport[] = [
  { width: 390, height: "auto", icon: "Smartphone", label: "Mobile" },
  { width: 1280, height: "auto", icon: "Monitor", label: "Ordinateur" },
];

/** Asked before an action that would drop the unsaved changes of the editor. */
const DISCARD_CHANGES =
  "Des modifications ne sont pas enregistrées et seront perdues. Continuer quand même ?";

export function PageEditorPage() {
  const [search] = useSearchParams();
  const path = search.get("chemin") ?? "";

  const modules = useModules();
  const { registry } = modules;
  const [page, setPage] = useState<PageDraft>();
  const [loadError, setLoadError] = useState<string>();
  const [actionError, setActionError] = useState<string>();
  const [actionFields, setActionFields] = useState<Record<string, string>>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [versions, setVersions] = useState<PageVersion[]>();
  const [historyError, setHistoryError] = useState<string>();
  /** Choices of the `reference` fields of the blocks (teams, sections, venues). */
  const [references, setReferences] = useState<ReferenceOptions>();
  /** Bumped when the editor must be remounted with other data (a restoration). */
  const [revision, setRevision] = useState(0);
  /** Latest data of the editor, kept outside the render loop. */
  const dataRef = useRef<PuckData>({ root: {}, content: [] });
  /**
   * A save or a publication is under way. A ref, not the state: two clicks in the same frame
   * both see the state of the last render, and a second publication would create a second
   * version.
   */
  const busyRef = useRef(false);

  // Leaving the page (reload, closing the tab, another site) with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) {
      return undefined;
    }
    const warn = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const reload = useCallback(async (): Promise<void> => {
    if (path === "") {
      setLoadError("Aucune page à éditer : revenez à la liste des pages.");
      return;
    }
    try {
      const draft = await fetchPage(path);
      dataRef.current = toPuckData(draft.draftData);
      setPage(draft);
      setLoadError(undefined);
      setDirty(false);
      setMessage(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Impossible de charger la page.");
    }
  }, [path]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    let current = true;
    fetchReferences().then(
      (options) => {
        if (current) {
          setReferences(options);
        }
      },
      // Without them, the lists of the blocks stay empty: the rest of the editor works.
      () => {
        if (current) {
          setReferences(NO_REFERENCES);
        }
      },
    );
    return () => {
      current = false;
    };
  }, []);
  const blockData = useMemo(
    () => ({ sport: apiSportReader, content: apiContentReader, references }),
    [references],
  );

  /**
   * Configuration of Puck: the registry, plus a stand-in for each block type of the saved draft
   * it does not know. Rebuilt when the registry changes (a module enabled meanwhile) or the
   * stand-ins of the loaded draft do, not on every keystroke nor on every save.
   */
  const draftData = page?.draftData;
  const loaded = draftData !== undefined;
  // A key, not the list: saving the draft gives a new object with the same stand-ins, and a new
  // configuration would make Puck redo its work for nothing.
  const unavailableKey = loaded ? unavailableBlockTypes(draftData, registry).join(" ") : "";
  const editor = useMemo(
    () =>
      loaded
        ? buildEditorConfig(registry, unavailableKey === "" ? [] : unavailableKey.split(" "))
        : undefined,
    [registry, loaded, unavailableKey],
  );

  const firstFieldMessage = (): string => {
    const first = Object.values(actionFields ?? {})[0];
    return first === undefined ? (actionError ?? "L'action a échoué. Réessayez.") : first;
  };

  async function handleSave(): Promise<void> {
    if (page === undefined || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setSaving(true);
    setActionError(undefined);
    setActionFields(undefined);
    setMessage(undefined);
    try {
      const saved = await saveDraft(page.path, {
        data: fromPuckData(dataRef.current) as PageData,
      });
      setPage(saved);
      setDirty(false);
      setMessage("Brouillon enregistré.");
    } catch (error) {
      if (error instanceof ApiError) {
        setActionError(error.message);
        setActionFields(error.fields);
      } else {
        setActionError("L'enregistrement du brouillon a échoué. Réessayez.");
      }
    } finally {
      busyRef.current = false;
      setSaving(false);
    }
  }

  async function handlePublish(): Promise<void> {
    if (page === undefined || busyRef.current) {
      return;
    }
    busyRef.current = true;
    setPublishing(true);
    setActionError(undefined);
    setActionFields(undefined);
    setMessage(undefined);
    try {
      await saveDraft(page.path, { data: fromPuckData(dataRef.current) as PageData });
      const published = await publishPage(page.path);
      setPage({ ...published, draftData: page.draftData });
      setDirty(false);
      setMessage("Page publiée : elle est visible sur le site public.");
    } catch (error) {
      if (error instanceof ApiError) {
        setActionError(error.message);
        setActionFields(error.fields);
      } else {
        setActionError("La publication a échoué. Réessayez.");
      }
    } finally {
      busyRef.current = false;
      setPublishing(false);
    }
  }

  async function openHistory(): Promise<void> {
    setHistoryOpen(true);
    setHistoryError(undefined);
    try {
      setVersions(await listVersions(path));
    } catch (error) {
      setHistoryError(
        error instanceof Error ? error.message : "Impossible de charger l'historique.",
      );
    }
  }

  async function handleRestore(version: number): Promise<void> {
    if (dirty && !window.confirm(DISCARD_CHANGES)) {
      return;
    }
    try {
      const restored = await restoreVersion(path, version);
      dataRef.current = toPuckData(restored.draftData);
      setPage(restored);
      setRevision((value) => value + 1);
      setHistoryOpen(false);
      setDirty(false);
      setMessage(`Version ${version} restaurée comme brouillon.`);
    } catch (error) {
      setHistoryError(error instanceof Error ? error.message : "La restauration a échoué.");
    }
  }

  if (loadError !== undefined) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-100 p-8">
        <FormError message={loadError} />
        <Link to="/pages" className="text-sm font-medium text-slate-700 underline">
          Revenir à la liste des pages
        </Link>
      </div>
    );
  }

  // The blocks of the modules must be known before Puck reads the page.
  if (page === undefined || modules.status === "loading" || editor === undefined) {
    return <div className="min-h-dvh bg-slate-100" />;
  }
  const { config, overrides } = editor;
  const modulesProblem =
    modules.error ??
    (modules.problems.length === 0
      ? undefined
      : `Des blocs de modules manquent dans l'éditeur : ${modules.problems
          .map((problem) => `${problem.name} — ${problem.message}`)
          .join(" ")}`);

  return (
    <div className="flex h-dvh flex-col bg-slate-100">
      <header className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-4 py-2">
        <Link
          to="/pages"
          onClick={(event) => {
            if (dirty && !window.confirm(DISCARD_CHANGES)) {
              event.preventDefault();
            }
          }}
          className="rounded-md px-2 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
        >
          ← Pages
        </Link>
        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
          {page.title}
          <span className="ml-2 font-normal text-slate-500">{page.path}</span>
        </span>
        {message !== undefined && (
          <span role="status" className="text-sm text-emerald-700">
            {message}
          </span>
        )}
        {dirty && <span className="text-xs text-slate-500">Modifications non enregistrées</span>}
        <Button
          variant="outline"
          className="px-3 py-1.5 text-xs"
          disabled={saving || publishing}
          onClick={() => void handleSave()}
        >
          Enregistrer le brouillon
        </Button>
        <Button
          variant="outline"
          className="px-3 py-1.5 text-xs"
          onClick={() => void (historyOpen ? setHistoryOpen(false) : openHistory())}
        >
          Historique
        </Button>
      </header>
      {modulesProblem !== undefined && (
        <p
          role="status"
          className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900"
        >
          {modulesProblem}
        </p>
      )}
      {(actionError !== undefined || actionFields !== undefined) && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2">
          <FormError message={firstFieldMessage()} />
        </div>
      )}
      {historyOpen && (
        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-900">Historique des versions</h2>
          {historyError !== undefined && <FormError message={historyError} />}
          {versions !== undefined && versions.length === 0 && (
            <p className="mt-1 text-sm text-slate-600">
              Aucune version : la page n'a jamais été publiée.
            </p>
          )}
          <ul className="mt-2 space-y-1">
            {(versions ?? []).map((version) => (
              <li key={version.version} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">
                  Version {version.version} — {version.title} —{" "}
                  {new Intl.DateTimeFormat("fr-FR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(version.createdAt))}
                </span>
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => void handleRestore(version.version)}
                >
                  Restaurer
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="min-h-0 flex-1">
        <EditorRegistryContext value={registry}>
          <BlockDataContext value={blockData}>
            <CanvasStylesheetContext value={siteStylesheet}>
              <Puck
                key={revision}
                config={config}
                data={dataRef.current}
                onChange={(data) => {
                  dataRef.current = data;
                  setDirty(true);
                }}
                onPublish={(data) => {
                  dataRef.current = data;
                  void handlePublish();
                }}
                viewports={VIEWPORTS}
                overrides={overrides}
                headerTitle={page.title}
                headerPath={page.path}
                iframe={{ syncHostStyles: false }}
                dictionary={{ "header-publish": publishing ? "Publication…" : "Publier" }}
                height="100%"
              />
            </CanvasStylesheetContext>
          </BlockDataContext>
        </EditorRegistryContext>
      </div>
    </div>
  );
}
