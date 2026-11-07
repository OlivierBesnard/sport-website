import type { ReferenceSource } from "@sport-cms/blocks";
import type { ContentReader, SportReader } from "@sport-cms/core";
import { requestJson } from "./client";

/**
 * Client of `/api/block-data`: what the editor needs to show the blocks bound to the data of
 * the instance — the choices of their `reference` fields and the readers of their loaders.
 */

/** A choice of a `reference` field of the blocks. */
export interface ReferenceOption {
  readonly value: number;
  readonly label: string;
}

export type ReferenceOptions = Readonly<Record<ReferenceSource, readonly ReferenceOption[]>>;

/** No choice at all, when the choices cannot be loaded. */
export const NO_REFERENCES: ReferenceOptions = {
  teams: [],
  sections: [],
  venues: [],
  postCategories: [],
  media: [],
};

/** The choices of the `reference` fields of the editor. */
export async function fetchReferences(): Promise<ReferenceOptions> {
  return {
    ...NO_REFERENCES,
    ...(await requestJson<Partial<ReferenceOptions>>("/api/block-data/references", {
      fallback: "Impossible de charger les équipes, catégories, images…",
    })),
  };
}

async function read<T>(method: string, query: unknown): Promise<T> {
  const body = await requestJson<{ result: T }>(
    `/api/block-data/read?method=${method}&query=${encodeURIComponent(JSON.stringify(query))}`,
    { fallback: "Impossible de charger les données du bloc." },
  );
  return body.result;
}

/** The sports content of the instance, for the preview of the blocks bound to it. */
export const apiSportReader: SportReader = {
  matches: (query) => read("matches", query),
  teams: (query) => read("teams", query),
  team: (id) => read("team", { id }),
  trainingSlots: (query) => read("trainingSlots", query),
  venues: (query) => read("venues", query),
};

/** The news, partners and media of the instance, for the preview of the blocks. */
export const apiContentReader: ContentReader = {
  posts: (query) => read("posts", query),
  post: (slug) => read("post", { slug }),
  partners: (query) => read("partners", query),
  media: (ids) => read("media", { ids }),
};
