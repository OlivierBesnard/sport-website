import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ApiError } from "../api/errors";
import {
  createPage,
  deletePage,
  listPages,
  type PageSummary,
  publishPage,
  renamePage,
  unpublishPage,
} from "../api/pages";
import { Button, Card, Field, FormError, Input } from "../components/ui";

/**
 * List of the pages of the site: create, rename, publish or unpublish, delete, open the
 * editor. The public path is shown as the visitors will type it; the dates are formatted in
 * French for the people of the club.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatDate(ms: number | null): string {
  return ms === null ? "—" : DATE_FORMAT.format(new Date(ms));
}

/** Status of a page, as a readable French label. */
function statusLabel(page: PageSummary): string {
  return page.published ? "Publiée" : "Brouillon";
}

export function PagesPage() {
  const navigate = useNavigate();
  const [pages, setPages] = useState<PageSummary[]>();
  const [loadError, setLoadError] = useState<string>();
  const [newPath, setNewPath] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [createFields, setCreateFields] = useState<Record<string, string>>();
  const [createError, setCreateError] = useState<string>();
  const [creating, setCreating] = useState(false);
  /** The path of the page being renamed, with the value typed so far. */
  const [renaming, setRenaming] = useState<{ path: string; value: string }>();
  const [rowError, setRowError] = useState<{ path: string; message: string }>();
  /** The only page allowed to be deleted: the button must be clicked twice. */
  const [confirmingDelete, setConfirmingDelete] = useState<string>();

  const reload = useCallback(async (): Promise<void> => {
    try {
      setPages(await listPages());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Impossible de charger les pages.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function handleCreate(): Promise<void> {
    setCreating(true);
    setCreateError(undefined);
    setCreateFields(undefined);
    try {
      const page = await createPage({ path: newPath, title: newTitle });
      setNewPath("");
      setNewTitle("");
      await reload();
      navigate(`/pages/edition?chemin=${encodeURIComponent(page.path)}`);
    } catch (error) {
      if (error instanceof ApiError) {
        setCreateError(error.message);
        setCreateFields(error.fields);
      } else {
        setCreateError("La création de la page a échoué. Réessayez.");
      }
    } finally {
      setCreating(false);
    }
  }

  /** Runs an action on the page at `path`; whether it succeeded (the error is shown otherwise). */
  async function runFor(path: string, action: () => Promise<unknown>): Promise<boolean> {
    setRowError(undefined);
    try {
      await action();
    } catch (error) {
      setRowError({
        path,
        message: error instanceof Error ? error.message : "L'action a échoué. Réessayez.",
      });
      return false;
    }
    await reload();
    return true;
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold text-slate-900">Pages</h1>
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
        <h1 className="text-2xl font-semibold text-slate-900">Pages</h1>
        <p className="text-sm text-slate-600">
          Les pages du site public. Une page n'est visible qu'une fois publiée : le brouillon, lui,
          peut être modifié librement.
        </p>
      </header>

      <Card>
        <form
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <div className="flex-1 space-y-2">
            <Field label="Chemin de la page" htmlFor="new-page-path" error={createFields?.path}>
              <Input
                id="new-page-path"
                placeholder="/le-club"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                aria-invalid={createFields?.path !== undefined}
              />
            </Field>
          </div>
          <div className="flex-1 space-y-2">
            <Field label="Titre de la page" htmlFor="new-page-title" error={createFields?.title}>
              <Input
                id="new-page-title"
                placeholder="Le club"
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                aria-invalid={createFields?.title !== undefined}
              />
            </Field>
          </div>
          <Button type="submit" disabled={creating}>
            Créer la page
          </Button>
        </form>
        <div className="mt-2">
          <FormError message={createError} />
        </div>
      </Card>

      {pages !== undefined && pages.length === 0 && (
        <Card className="text-sm text-slate-600">
          Aucune page pour l'instant : créez la première ci-dessus.
        </Card>
      )}

      {pages !== undefined && pages.length > 0 && (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs uppercase text-slate-500">
                <th scope="col" className="px-4 py-3 font-semibold">
                  Page
                </th>
                <th scope="col" className="px-4 py-3 font-semibold">
                  Statut
                </th>
                <th scope="col" className="hidden px-4 py-3 font-semibold md:table-cell">
                  Modifiée
                </th>
                <th scope="col" className="px-4 py-3 text-right font-semibold">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {pages.map((page) => (
                <tr key={page.path} className="border-b border-slate-100 last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{page.title}</div>
                    <div className="text-slate-500">{page.path}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={
                        page.published
                          ? "rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800"
                          : "rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600"
                      }
                    >
                      {statusLabel(page)}
                    </span>
                  </td>
                  <td className="hidden px-4 py-3 text-slate-600 md:table-cell">
                    {formatDate(page.updatedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap justify-end gap-2">
                      <Link
                        to={`/pages/edition?chemin=${encodeURIComponent(page.path)}`}
                        className="inline-flex items-center rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                      >
                        Éditer
                      </Link>
                      {page.published ? (
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => void runFor(page.path, () => unpublishPage(page.path))}
                        >
                          Dépublier
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => void runFor(page.path, () => publishPage(page.path))}
                        >
                          Publier
                        </Button>
                      )}
                      <Button
                        variant="outline"
                        className="px-3 py-1.5 text-xs"
                        onClick={() => setRenaming({ path: page.path, value: page.path })}
                      >
                        Renommer
                      </Button>
                      {confirmingDelete === page.path ? (
                        <Button
                          className="bg-red-700 px-3 py-1.5 text-xs hover:bg-red-800 focus-visible:outline-red-700"
                          onClick={() => {
                            setConfirmingDelete(undefined);
                            void runFor(page.path, () => deletePage(page.path));
                          }}
                        >
                          Confirmer la suppression
                        </Button>
                      ) : (
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setConfirmingDelete(page.path)}
                        >
                          Supprimer
                        </Button>
                      )}
                    </div>
                    {renaming?.path === page.path && (
                      <form
                        className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end"
                        onSubmit={(event) => {
                          event.preventDefault();
                          const target = renaming.value;
                          // The form stays open on a failure: the path can be corrected in place.
                          void runFor(page.path, () => renamePage(page.path, target)).then(
                            (succeeded) => {
                              if (succeeded) {
                                setRenaming(undefined);
                              }
                            },
                          );
                        }}
                      >
                        <div className="flex-1">
                          <Field label="Nouveau chemin" htmlFor={`rename-${page.path}`}>
                            <Input
                              id={`rename-${page.path}`}
                              value={renaming.value}
                              onChange={(event) =>
                                setRenaming({ path: page.path, value: event.target.value })
                              }
                            />
                          </Field>
                        </div>
                        <Button type="submit" className="px-3 py-1.5 text-xs">
                          Déplacer
                        </Button>
                        <Button
                          variant="outline"
                          className="px-3 py-1.5 text-xs"
                          onClick={() => setRenaming(undefined)}
                        >
                          Annuler
                        </Button>
                      </form>
                    )}
                    {rowError?.path === page.path && (
                      <div className="mt-2 text-left">
                        <FormError message={rowError.message} />
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </section>
  );
}
