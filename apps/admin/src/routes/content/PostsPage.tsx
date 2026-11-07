import { useCallback, useEffect, useState } from "react";
import { fetchReferences, NO_REFERENCES, type ReferenceOptions } from "../../api/block-data";
import {
  type Category,
  deleteCategory,
  deletePost,
  listCategories,
  listPosts,
  type Post,
  saveCategory,
  savePost,
  setPostPublished,
} from "../../api/content";
import { type CalendarEvent, listEvents } from "../../api/sport";
import { Button, Card, Field, FormError, Input, Select } from "../../components/ui";
import {
  DeleteButton,
  dateTimeFormat,
  type FormErrors,
  formErrors,
  PageHeader,
  Saved,
  TEXTAREA_CLASS,
} from "../sport/shared";

/**
 * The news of the club: written as drafts, published in one click, each with its own page on
 * the site (`/actualites/<adresse>`); categories, an image of the library, a team or a match.
 */

interface PostDraft {
  readonly id?: number;
  readonly title: string;
  readonly slug: string;
  readonly excerpt: string;
  readonly body: string;
  readonly categoryId: string;
  readonly imageId: string;
  readonly teamId: string;
  readonly matchId: string;
  readonly featured: boolean;
}

const EMPTY: PostDraft = {
  title: "",
  slug: "",
  excerpt: "",
  body: "",
  categoryId: "",
  imageId: "",
  teamId: "",
  matchId: "",
  featured: false,
};

const idOf = (value: number | null) => (value === null ? "" : String(value));
const idOrNull = (value: string) => (value === "" ? null : Number(value));

function toDraft(post: Post): PostDraft {
  return {
    id: post.id,
    title: post.title,
    slug: post.slug,
    excerpt: post.excerpt,
    body: post.body,
    categoryId: idOf(post.categoryId),
    imageId: idOf(post.imageId),
    teamId: idOf(post.teamId),
    matchId: idOf(post.matchId),
    featured: post.featured,
  };
}

export function PostsPage() {
  const [posts, setPosts] = useState<Post[]>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [references, setReferences] = useState<ReferenceOptions>(NO_REFERENCES);
  const [matches, setMatches] = useState<CalendarEvent[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<PostDraft>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [category, setCategory] = useState<{ id?: number; name: string }>();
  const [categoryErrors, setCategoryErrors] = useState<FormErrors>({});

  const reload = useCallback(async () => {
    try {
      const [postList, categoryList, options] = await Promise.all([
        listPosts(),
        listCategories(),
        fetchReferences(),
      ]);
      setPosts(postList);
      setCategories(categoryList);
      setReferences(options);
      setLoadError(undefined);
      // The matches need the sports permissions: without them, no match to link.
      setMatches((await listEvents().catch(() => [])).filter((event) => event.kind === "match"));
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function update(changes: Partial<PostDraft>): void {
    setDraft((current) => (current === undefined ? current : { ...current, ...changes }));
  }

  async function submit(): Promise<void> {
    if (draft === undefined) {
      return;
    }
    setErrors({});
    try {
      const stored = await savePost(draft.id, {
        title: draft.title,
        slug: draft.slug,
        excerpt: draft.excerpt,
        body: draft.body,
        categoryId: idOrNull(draft.categoryId),
        imageId: idOrNull(draft.imageId),
        teamId: idOrNull(draft.teamId),
        matchId: idOrNull(draft.matchId),
        featured: draft.featured,
      });
      setSaved(
        stored.status === "published"
          ? `« ${stored.title} » enregistrée : le site est mis à jour.`
          : `« ${stored.title} » enregistrée comme brouillon.`,
      );
      setDraft(undefined);
      await reload();
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement de l'actualité a échoué."));
    }
  }

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    setListError(undefined);
    setSaved(undefined);
    try {
      await action();
      setSaved(done);
      await reload();
    } catch (error) {
      setListError(error instanceof Error ? error.message : "L'opération a échoué.");
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Actualités" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  const fieldError = (name: string) => errors.fields?.[name];
  const categoryName = (id: number | null) => categories.find((row) => row.id === id)?.name ?? "";
  const matchLabel = (event: CalendarEvent) =>
    `${dateTimeFormat.format(new Date(event.startsAt))} — ${event.match?.opponent ?? ""}`;

  return (
    <section className="space-y-6">
      <PageHeader title="Actualités">
        Chaque actualité publiée a sa propre page sur le site et apparaît dans les blocs « Liste
        d'actualités ».
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />
      <Card className="space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setDraft(EMPTY);
              setErrors({});
            }}
          >
            Écrire une actualité
          </Button>
        </div>
        {posts?.length === 0 && (
          <p className="text-sm text-slate-600">Aucune actualité pour l'instant.</p>
        )}
        <ul className="divide-y divide-slate-200">
          {(posts ?? []).map((post) => (
            <li key={post.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-slate-800">
                <strong>{post.title}</strong>
                {post.categoryId !== null && (
                  <span className="text-slate-500"> · {categoryName(post.categoryId)}</span>
                )}
                <span
                  className={
                    post.status === "published"
                      ? "ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800"
                      : "ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-semibold text-slate-600"
                  }
                >
                  {post.status === "published" ? "publiée" : "brouillon"}
                </span>
                {post.status === "published" && (
                  <a
                    className="ml-2 text-xs text-slate-600 underline"
                    href={post.path}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Voir sur le site
                  </a>
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    setDraft(toDraft(post));
                    setErrors({});
                  }}
                >
                  Modifier
                </Button>
                <Button
                  className="px-3 py-1 text-xs"
                  onClick={() =>
                    void run(
                      () => setPostPublished(post.id, post.status !== "published"),
                      post.status === "published"
                        ? `« ${post.title} » est retirée du site.`
                        : `« ${post.title} » est publiée : elle est visible sur le site.`,
                    )
                  }
                >
                  {post.status === "published" ? "Dépublier" : "Publier"}
                </Button>
                <DeleteButton
                  label={`l'actualité ${post.title}`}
                  onConfirm={() => run(() => deletePost(post.id), `« ${post.title} » supprimée.`)}
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {draft !== undefined && (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {draft.id === undefined ? "Nouvelle actualité" : `Modifier « ${draft.title} »`}
            </h2>
            <Field label="Titre" htmlFor="post-title" error={fieldError("title")}>
              <Input
                id="post-title"
                value={draft.title}
                onChange={(event) => update({ title: event.target.value })}
              />
            </Field>
            <Field
              label="Adresse de la page"
              htmlFor="post-slug"
              hint="Après /actualites/ ; laissée vide, elle est tirée du titre. La changer casse les liens déjà partagés."
              error={fieldError("slug")}
            >
              <Input
                id="post-slug"
                value={draft.slug}
                onChange={(event) => update({ slug: event.target.value })}
              />
            </Field>
            <Field
              label="Résumé"
              htmlFor="post-excerpt"
              hint="Une ou deux phrases, montrées dans les listes."
              error={fieldError("excerpt")}
            >
              <textarea
                id="post-excerpt"
                rows={2}
                className={TEXTAREA_CLASS}
                value={draft.excerpt}
                onChange={(event) => update({ excerpt: event.target.value })}
              />
            </Field>
            <Field
              label="Texte"
              htmlFor="post-body"
              hint="Séparez les paragraphes par une ligne vide."
              error={fieldError("body")}
            >
              <textarea
                id="post-body"
                rows={10}
                className={TEXTAREA_CLASS}
                value={draft.body}
                onChange={(event) => update({ body: event.target.value })}
              />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Image" htmlFor="post-image" error={fieldError("imageId")}>
                <Select
                  id="post-image"
                  value={draft.imageId}
                  onChange={(event) => update({ imageId: event.target.value })}
                >
                  <option value="">Aucune</option>
                  {references.media.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Catégorie" htmlFor="post-category" error={fieldError("categoryId")}>
                <Select
                  id="post-category"
                  value={draft.categoryId}
                  onChange={(event) => update({ categoryId: event.target.value })}
                >
                  <option value="">Aucune</option>
                  {categories.map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Équipe" htmlFor="post-team" error={fieldError("teamId")}>
                <Select
                  id="post-team"
                  value={draft.teamId}
                  onChange={(event) => update({ teamId: event.target.value })}
                >
                  <option value="">Aucune</option>
                  {references.teams.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {matches.length > 0 && (
                <Field label="Match" htmlFor="post-match" error={fieldError("matchId")}>
                  <Select
                    id="post-match"
                    value={draft.matchId}
                    onChange={(event) => update({ matchId: event.target.value })}
                  >
                    <option value="">Aucun</option>
                    {matches.map((event) => (
                      <option key={event.id} value={event.id}>
                        {matchLabel(event)}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-800">
              <input
                type="checkbox"
                checked={draft.featured}
                onChange={(event) => update({ featured: event.target.checked })}
              />
              Mettre en avant
            </label>
            <FormError message={errors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer</Button>
              <Button variant="outline" onClick={() => setDraft(undefined)}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Catégories</h2>
          <Button
            variant="outline"
            onClick={() => {
              setCategory({ name: "" });
              setCategoryErrors({});
            }}
          >
            Ajouter une catégorie
          </Button>
        </div>
        <ul className="divide-y divide-slate-200">
          {categories.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
            >
              <strong>{row.name}</strong>
              <span className="flex gap-1">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => setCategory(row)}
                >
                  Renommer
                </Button>
                <DeleteButton
                  label={`la catégorie ${row.name}`}
                  onConfirm={() =>
                    run(() => deleteCategory(row.id), `Catégorie ${row.name} supprimée.`)
                  }
                />
              </span>
            </li>
          ))}
        </ul>
        {category !== undefined && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={async (event) => {
              event.preventDefault();
              setCategoryErrors({});
              try {
                await saveCategory(category.id, {
                  name: category.name,
                  position:
                    categories.find((row) => row.id === category.id)?.position ?? categories.length,
                });
                setSaved(`Catégorie « ${category.name} » enregistrée.`);
                setCategory(undefined);
                await reload();
              } catch (error) {
                setCategoryErrors(formErrors(error, "L'enregistrement de la catégorie a échoué."));
              }
            }}
          >
            <div className="min-w-48 flex-1">
              <Field
                label="Nom de la catégorie"
                htmlFor="category-name"
                error={categoryErrors.fields?.name}
              >
                <Input
                  id="category-name"
                  value={category.name}
                  onChange={(event) => setCategory({ ...category, name: event.target.value })}
                />
              </Field>
            </div>
            <Button type="submit">Enregistrer</Button>
            <Button variant="outline" onClick={() => setCategory(undefined)}>
              Annuler
            </Button>
            <FormError message={categoryErrors.message} />
          </form>
        )}
      </Card>
    </section>
  );
}
