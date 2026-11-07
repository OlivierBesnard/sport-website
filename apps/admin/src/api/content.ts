import type { MediaRights, PartnerLevel } from "@sport-cms/core";
import { requestJson } from "./client";
import { ApiError, toApiError } from "./errors";

/** Typed client of the admin API of the media, news and partners. */

export interface Medium {
  readonly id: number;
  readonly originalName: string;
  readonly mimeType: string;
  readonly size: number;
  readonly width: number;
  readonly height: number;
  readonly alt: string;
  readonly rights: MediaRights;
  /** Largest size, `/media/<file>.webp`. */
  readonly url: string;
  readonly thumbnailUrl: string;
  readonly createdAt: number;
}

export interface Category {
  readonly id: number;
  readonly name: string;
  readonly position: number;
}

export interface Post {
  readonly id: number;
  readonly slug: string;
  readonly path: string;
  readonly title: string;
  readonly excerpt: string;
  readonly body: string;
  readonly categoryId: number | null;
  readonly imageId: number | null;
  readonly teamId: number | null;
  readonly matchId: number | null;
  readonly featured: boolean;
  readonly status: "draft" | "published";
  readonly publishedAt: number | null;
  readonly updatedAt: number;
}

export type PostInput = Omit<Post, "id" | "path" | "status" | "publishedAt" | "updatedAt">;

export interface Partner {
  readonly id: number;
  readonly name: string;
  readonly url: string;
  readonly logoId: number | null;
  readonly level: PartnerLevel;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly position: number;
}

export type PartnerInput = Omit<Partner, "id" | "startsOn" | "endsOn"> & {
  readonly startsOn: string;
  readonly endsOn: string;
};

const LOAD = "Impossible de charger les contenus. Réessayez.";
const SAVE = "L'enregistrement a échoué. Réessayez.";
const DELETE = "La suppression a échoué. Réessayez.";

export async function listMedia(): Promise<Medium[]> {
  return (await requestJson<{ media: Medium[] }>("/api/media", { fallback: LOAD })).media;
}

/** Sends an image (multipart: the browser sets the boundary and `Origin`). */
export async function uploadMedium(file: File, alt: string, rights: MediaRights): Promise<Medium> {
  const form = new FormData();
  form.set("file", file);
  form.set("alt", alt);
  form.set("rights", rights);
  const fallback = "Le téléversement a échoué. Réessayez.";
  let response: Response;
  try {
    response = await fetch("/api/media", {
      method: "POST",
      body: form,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, fallback);
  }
  if (!response.ok) {
    throw await toApiError(response, fallback);
  }
  try {
    return ((await response.json()) as { media: Medium }).media;
  } catch {
    throw new ApiError(response.status, fallback);
  }
}

export async function updateMedium(
  id: number,
  input: { alt: string; rights: MediaRights },
): Promise<Medium> {
  return (
    await requestJson<{ media: Medium }>(`/api/media/${id}`, {
      method: "PUT",
      body: input,
      fallback: SAVE,
    })
  ).media;
}

export async function deleteMedium(id: number): Promise<void> {
  await requestJson<unknown>(`/api/media/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listCategories(): Promise<Category[]> {
  return (await requestJson<{ categories: Category[] }>("/api/post-categories", { fallback: LOAD }))
    .categories;
}

export async function saveCategory(
  id: number | undefined,
  input: { name: string; position: number },
): Promise<Category> {
  return (
    await requestJson<{ category: Category }>(
      id === undefined ? "/api/post-categories" : `/api/post-categories/${id}`,
      { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
    )
  ).category;
}

export async function deleteCategory(id: number): Promise<void> {
  await requestJson<unknown>(`/api/post-categories/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listPosts(): Promise<Post[]> {
  return (await requestJson<{ posts: Post[] }>("/api/posts", { fallback: LOAD })).posts;
}

export async function savePost(id: number | undefined, input: PostInput): Promise<Post> {
  return (
    await requestJson<{ post: Post }>(id === undefined ? "/api/posts" : `/api/posts/${id}`, {
      method: id === undefined ? "POST" : "PUT",
      body: input,
      fallback: SAVE,
    })
  ).post;
}

export async function setPostPublished(id: number, published: boolean): Promise<Post> {
  return (
    await requestJson<{ post: Post }>(`/api/posts/${id}/${published ? "publish" : "unpublish"}`, {
      method: "POST",
      body: {},
      fallback: published ? "La publication a échoué. Réessayez." : SAVE,
    })
  ).post;
}

export async function deletePost(id: number): Promise<void> {
  await requestJson<unknown>(`/api/posts/${id}`, { method: "DELETE", fallback: DELETE });
}

export async function listPartners(): Promise<Partner[]> {
  return (await requestJson<{ partners: Partner[] }>("/api/partners", { fallback: LOAD })).partners;
}

export async function savePartner(id: number | undefined, input: PartnerInput): Promise<Partner> {
  return (
    await requestJson<{ partner: Partner }>(
      id === undefined ? "/api/partners" : `/api/partners/${id}`,
      { method: id === undefined ? "POST" : "PUT", body: input, fallback: SAVE },
    )
  ).partner;
}

export async function deletePartner(id: number): Promise<void> {
  await requestJson<unknown>(`/api/partners/${id}`, { method: "DELETE", fallback: DELETE });
}
