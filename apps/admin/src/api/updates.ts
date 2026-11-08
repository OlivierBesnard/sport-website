import type { SupervisorState, UpdateAction, UpdateRequest, UpdateSettings } from "@sport-cms/core";
import { requestJson } from "./client";

/** Typed client of the admin API of the automatic updates (`/api/updates`). */

export interface UpdatesOverview {
  /** Version of the CMS answering. */
  readonly version: string;
  readonly settings: UpdateSettings;
  /** What the supervisor did; `null` when none runs the instance. */
  readonly state: SupervisorState | null;
  /** Request not yet picked up by the supervisor. */
  readonly request: UpdateRequest | null;
}

export async function fetchUpdates(): Promise<UpdatesOverview> {
  return requestJson<UpdatesOverview>("/api/updates", {
    fallback: "Impossible de charger les mises à jour. Réessayez.",
  });
}

export async function saveUpdateSettings(settings: UpdateSettings): Promise<UpdateSettings> {
  return (
    await requestJson<{ settings: UpdateSettings }>("/api/updates/settings", {
      method: "PUT",
      body: settings,
      fallback: "L'enregistrement des réglages a échoué. Réessayez.",
    })
  ).settings;
}

export async function requestUpdateAction(action: UpdateAction): Promise<void> {
  await requestJson<unknown>("/api/updates/request", {
    method: "POST",
    body: { action },
    fallback: "La demande n'a pas pu être envoyée. Réessayez.",
  });
}
