import { useCallback, useEffect, useState } from "react";
import { ApiError } from "../api/errors";
import {
  fetchNavigation,
  type NavigationItem,
  type NavigationItemInput,
  saveNavigation,
} from "../api/navigation";
import { listPages, type PageSummary } from "../api/pages";
import { Button, Card, Field, FormError, Input, Select } from "../components/ui";

/**
 * Editing of the main menu of the site: add entries pointing at a page or at an external
 * link, reorder them, delete them, then save. The order sent is the order rendered.
 */

/** One row of the form, before it is saved. */
interface DraftItem {
  /** Absent while the row has never been saved. */
  readonly id?: number;
  readonly label: string;
  readonly kind: "page" | "url";
  readonly pageId: string;
  readonly url: string;
  /** The page the entry pointed at was deleted: the entry has no target left. */
  readonly orphan?: boolean;
}

/** Shown under the page field of an entry whose page was deleted. */
export const ORPHAN_MESSAGE =
  "La page de cette entrée a été supprimée : choisissez-en une autre ou retirez l'entrée.";

/** Shown when an entry pointing at a page has no page chosen. */
export const CHOOSE_PAGE_MESSAGE = "Choisissez une page.";

export function toDraft(item: NavigationItem): DraftItem {
  // Neither a page nor a link: the page was deleted (the entry loses its page, not its place).
  const orphan = item.pageId === null && item.url === null;
  return {
    id: item.id,
    label: item.label,
    kind: item.pageId === null && !orphan ? "url" : "page",
    pageId: item.pageId === null ? "" : String(item.pageId),
    url: item.url ?? "",
    ...(orphan ? { orphan: true } : {}),
  };
}

/** Errors the form finds itself before sending, keyed like the errors of the API. */
export function validateDrafts(items: readonly DraftItem[]): Record<string, string> {
  const fields: Record<string, string> = {};
  items.forEach((item, index) => {
    if (item.kind === "page" && item.pageId === "") {
      fields[`items.${index}.pageId`] = CHOOSE_PAGE_MESSAGE;
    }
  });
  return fields;
}

export function toInput(item: DraftItem): NavigationItemInput {
  return item.kind === "page" && item.pageId !== ""
    ? { label: item.label, pageId: Number(item.pageId) }
    : { label: item.label, url: item.url };
}

export function NavigationPage() {
  const [items, setItems] = useState<DraftItem[]>();
  const [pages, setPages] = useState<PageSummary[]>();
  const [loadError, setLoadError] = useState<string>();
  const [saveError, setSaveError] = useState<string>();
  const [saveFields, setSaveFields] = useState<Record<string, string>>();
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      const [navigation, pageList] = await Promise.all([fetchNavigation(), listPages()]);
      setItems(navigation.map(toDraft));
      setPages(pageList);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Impossible de charger le menu.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function update(index: number, changes: Partial<DraftItem>): void {
    setItems((current) =>
      (current ?? []).map((item, i) => (i === index ? { ...item, ...changes } : item)),
    );
  }

  function move(index: number, offset: -1 | 1): void {
    setItems((current) => {
      const list = [...(current ?? [])];
      const target = index + offset;
      if (target < 0 || target >= list.length) {
        return list;
      }
      const [item] = list.splice(index, 1);
      list.splice(target, 0, item ?? { label: "", kind: "page", pageId: "", url: "" });
      return list;
    });
    setSaved(false);
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setSaveError(undefined);
    setSaveFields(undefined);
    setSaved(false);
    const invalid = validateDrafts(items ?? []);
    if (Object.keys(invalid).length > 0) {
      setSaveFields(invalid);
      setSaveError("Le menu contient des entrées à compléter.");
      setSaving(false);
      return;
    }
    try {
      const stored = await saveNavigation("main", (items ?? []).map(toInput));
      setItems(stored.map(toDraft));
      setSaved(true);
    } catch (error) {
      if (error instanceof ApiError) {
        setSaveError(error.message);
        setSaveFields(error.fields);
      } else {
        setSaveError("L'enregistrement du menu a échoué. Réessayez.");
      }
    } finally {
      setSaving(false);
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Navigation</h1>
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Navigation</h1>
        <p className="text-sm text-slate-600">
          Le menu affiché en haut de chaque page du site. L'ordre de la liste est l'ordre du menu.
        </p>
      </header>

      <Card className="space-y-3">
        {(items ?? []).map((item, index) => (
          <div
            key={item.id ?? `new-${index}`}
            className="space-y-2 rounded-md border border-slate-200 p-3"
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-40 flex-1">
                <Field
                  label="Libellé"
                  htmlFor={`label-${index}`}
                  error={saveFields?.[`items.${index}.label`]}
                >
                  <Input
                    id={`label-${index}`}
                    value={item.label}
                    onChange={(event) => {
                      update(index, { label: event.target.value });
                      setSaved(false);
                    }}
                  />
                </Field>
              </div>
              <div className="w-40">
                <Field label="Cible" htmlFor={`kind-${index}`}>
                  <Select
                    id={`kind-${index}`}
                    value={item.kind}
                    onChange={(event) =>
                      update(index, { kind: event.target.value === "url" ? "url" : "page" })
                    }
                  >
                    <option value="page">Une page du site</option>
                    <option value="url">Un lien externe</option>
                  </Select>
                </Field>
              </div>
              <div className="min-w-40 flex-1">
                {item.kind === "page" ? (
                  <Field
                    label="Page"
                    htmlFor={`page-${index}`}
                    // The API reports a page entry without a page on its `url` (the entry was
                    // sent as a link): both errors belong under the page field.
                    error={
                      saveFields?.[`items.${index}.pageId`] ??
                      saveFields?.[`items.${index}.url`] ??
                      (item.orphan === true && item.pageId === "" ? ORPHAN_MESSAGE : undefined)
                    }
                  >
                    <Select
                      id={`page-${index}`}
                      value={item.pageId}
                      onChange={(event) => {
                        update(index, { pageId: event.target.value, orphan: false });
                        setSaved(false);
                      }}
                    >
                      <option value="">Choisir une page…</option>
                      {(pages ?? []).map((page) => (
                        <option key={page.path} value={page.id}>
                          {page.title} ({page.path})
                        </option>
                      ))}
                    </Select>
                  </Field>
                ) : (
                  <Field
                    label="Adresse du lien"
                    htmlFor={`url-${index}`}
                    error={saveFields?.[`items.${index}.url`]}
                  >
                    <Input
                      id={`url-${index}`}
                      placeholder="https://… ou /contact"
                      value={item.url}
                      onChange={(event) => {
                        update(index, { url: event.target.value });
                        setSaved(false);
                      }}
                    />
                  </Field>
                )}
              </div>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  className="px-2 py-1.5 text-xs"
                  aria-label={`Monter « ${item.label || "l'entrée"} »`}
                  disabled={index === 0}
                  onClick={() => move(index, -1)}
                >
                  ↑
                </Button>
                <Button
                  variant="outline"
                  className="px-2 py-1.5 text-xs"
                  aria-label={`Descendre « ${item.label || "l'entrée"} »`}
                  disabled={index === (items ?? []).length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </Button>
                <Button
                  variant="outline"
                  className="px-2 py-1.5 text-xs"
                  onClick={() => {
                    setItems((current) => (current ?? []).filter((_, i) => i !== index));
                    setSaved(false);
                  }}
                >
                  Retirer
                </Button>
              </div>
            </div>
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              setItems((current) => [
                ...(current ?? []),
                { label: "", kind: "page", pageId: "", url: "" },
              ]);
              setSaved(false);
            }}
          >
            Ajouter une entrée
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            Enregistrer le menu
          </Button>
          {saved && (
            <span role="status" className="text-sm text-emerald-700">
              Menu enregistré : il est visible sur le site public.
            </span>
          )}
        </div>
        <FormError message={saveError} />
      </Card>
    </section>
  );
}
