import type { PageData } from "@sport-cms/blocks";
import { requestJson } from "./client";

/**
 * Typed client of the admin API of the pages (`/api/pages`). Every failure comes back as an
 * {@link ApiError} with a French message; a 400 carries the fields the API refused.
 */

/** Metadata of a page as the API returns it (dates in epoch milliseconds). */
export interface PageSummary {
  readonly id: number;
  readonly path: string;
  readonly title: string;
  readonly seo: { title?: string; description?: string; image?: string };
  readonly status: "draft" | "published";
  readonly published: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly publishedAt: number | null;
}

/** A page and its draft, as the editor needs it. */
export interface PageDraft extends PageSummary {
  readonly draftData: PageData;
}

/** Answer of a publication, with the version it created. */
export interface PublishedPage extends PageSummary {
  readonly version: number;
}

/** One version of a page, newest first in the list. */
export interface PageVersion {
  readonly version: number;
  readonly title: string;
  readonly createdAt: number;
}

/** Lists the pages, ordered by path. */
export async function listPages(): Promise<PageSummary[]> {
  const body = await requestJson<{ pages: PageSummary[] }>("/api/pages", {
    fallback: "Impossible de charger les pages. Réessayez.",
  });
  return body.pages;
}

/** Creates a page; the path is normalized by the API. */
export async function createPage(input: { path: string; title: string }): Promise<PageDraft> {
  return requestJson<PageDraft>("/api/pages", {
    method: "POST",
    body: input,
    fallback: "La création de la page a échoué. Réessayez.",
  });
}

/** Fetches a page and its draft. */
export async function fetchPage(path: string): Promise<PageDraft> {
  return requestJson<PageDraft>(pageUrl("page", path), {
    fallback: "Impossible de charger la page. Réessayez.",
  });
}

/** Saves the draft (and optionally the name and the SEO columns). */
export async function saveDraft(
  path: string,
  input: {
    data: PageData;
    title?: string;
    seo?: { title?: string; description?: string; image?: string };
  },
): Promise<PageDraft> {
  return requestJson<PageDraft>(pageUrl("page", path), {
    method: "PUT",
    body: input,
    fallback: "L'enregistrement du brouillon a échoué. Réessayez.",
  });
}

/** Publishes the draft: the public site then serves it. */
export async function publishPage(path: string): Promise<PublishedPage> {
  return requestJson<PublishedPage>(pageUrl("publish", path), {
    method: "POST",
    fallback: "La publication a échoué. Réessayez.",
  });
}

/** Takes the page off the public site, keeping its content. */
export async function unpublishPage(path: string): Promise<PageSummary> {
  return requestJson<PageSummary>(pageUrl("unpublish", path), {
    method: "POST",
    fallback: "La dépublication a échoué. Réessayez.",
  });
}

/** Lists the versions of a page, newest first. */
export async function listVersions(path: string): Promise<PageVersion[]> {
  const body = await requestJson<{ versions: PageVersion[] }>(pageUrl("versions", path), {
    fallback: "Impossible de charger l'historique. Réessayez.",
  });
  return body.versions;
}

/** Restores a version as the draft of the page. */
export async function restoreVersion(path: string, version: number): Promise<PageDraft> {
  return requestJson<PageDraft>(pageUrl("restore", path), {
    method: "POST",
    body: { version },
    fallback: "La restauration a échoué. Réessayez.",
  });
}

/** Moves a page to another path. */
export async function renamePage(path: string, newPath: string): Promise<PageSummary> {
  return requestJson<PageSummary>(pageUrl("rename", path), {
    method: "POST",
    body: { path: newPath },
    fallback: "Le renommage a échoué. Réessayez.",
  });
}

/** Deletes a page, its versions included. */
export async function deletePage(path: string): Promise<void> {
  await requestJson<unknown>(pageUrl("page", path), {
    method: "DELETE",
    fallback: "La suppression a échoué. Réessayez.",
  });
}

/**
 * URL of an action of the API on the page at `path`. The action is the URL path, the page goes in
 * the `path` query parameter: a page may be called `/publish` or be the home page `/` without any
 * ambiguity.
 */
export function pageUrl(
  action: "page" | "publish" | "unpublish" | "versions" | "restore" | "rename",
  path: string,
): string {
  return `/api/pages/${action}?path=${encodeURIComponent(path)}`;
}
