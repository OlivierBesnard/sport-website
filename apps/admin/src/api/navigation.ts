import { requestJson } from "./client";

/** Typed client of the admin API of the navigation (`/api/navigation`). */

/** One entry of a menu, with the page path resolved when it points at a page. */
export interface NavigationItem {
  readonly id: number;
  readonly label: string;
  readonly pageId: number | null;
  readonly path: string | null;
  readonly url: string | null;
}

/** What a new or reordered item carries: a label and one target. */
export interface NavigationItemInput {
  readonly label: string;
  readonly pageId?: number;
  readonly url?: string;
}

/** The menu and its entries, in order. */
export async function fetchNavigation(menu = "main"): Promise<NavigationItem[]> {
  const body = await requestJson<{ menu: string; items: NavigationItem[] }>(
    `/api/navigation?menu=${encodeURIComponent(menu)}`,
    { fallback: "Impossible de charger le menu. Réessayez." },
  );
  return body.items;
}

/** Replaces the whole menu with the entries given, in order. */
export async function saveNavigation(
  menu: string,
  items: NavigationItemInput[],
): Promise<NavigationItem[]> {
  const body = await requestJson<{ menu: string; items: NavigationItem[] }>("/api/navigation", {
    method: "PUT",
    body: { menu, items },
    fallback: "L'enregistrement du menu a échoué. Réessayez.",
  });
  return body.items;
}
