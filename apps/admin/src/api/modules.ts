import { requestJson } from "./client";

/** Typed client of the admin API of the modules (`/api/modules`, `/api/client-modules`). */

/** JSON value, as the API sends it. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/** A JSON Schema of the settings or credentials of a module (zod's `toJSONSchema`). */
export type JsonSchema = { readonly [key: string]: JsonValue };

/** A processing of personal data declared by a module (GDPR register). */
export interface DataProcessing {
  readonly purpose: string;
  readonly data: readonly string[];
  readonly processors?: readonly string[];
  readonly retention: string;
}

/** A module of the instance, as `GET /api/modules` shows it (`ModuleView` of the server). */
export interface ModuleSummary {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly source: "official" | "installed" | null;
  /** `unavailable`: known to the database, but its code is not loaded at this start. */
  readonly status: "available" | "unavailable";
  readonly enabled: boolean;
  readonly permissions: readonly string[];
  readonly dataProcessing: readonly DataProcessing[];
  readonly blocks: readonly { readonly type: string; readonly label: string }[];
  readonly settings: { readonly [key: string]: JsonValue };
  readonly settingsSchema: JsonSchema | null;
  readonly credentials: {
    readonly declared: boolean;
    readonly configured: boolean;
    readonly fields: readonly string[];
    readonly schema: JsonSchema | null;
    /** Milliseconds since the Unix epoch. */
    readonly updatedAt: number | null;
  };
  /** Why the module could not be loaded at this start. */
  readonly failure: readonly string[] | null;
}

/** A module refused at this start (manifest, code, compatibility…). */
export interface ModuleFailure {
  readonly id: string;
  readonly source: "official" | "installed";
  readonly reasons: readonly string[];
}

/** An enabled module, as the back-office loads it (`GET /api/client-modules`). */
export interface ClientModuleEntry {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Block types the server renders for the module. */
  readonly blocks: readonly string[];
  /** URL of its client entry, `null` without one. */
  readonly client: string | null;
}

/** Path of a module's route; the identifier is checked by the server. */
function moduleUrl(id: string, action?: string): string {
  const base = `/api/modules/${encodeURIComponent(id)}`;
  return action === undefined ? base : `${base}/${action}`;
}

export async function fetchModules(): Promise<{
  modules: ModuleSummary[];
  failures: ModuleFailure[];
}> {
  return requestJson("/api/modules", { fallback: "Impossible de charger les modules. Réessayez." });
}

/** Enables a module: its blocks join the editor and the public site. */
export async function enableModule(id: string): Promise<ModuleSummary> {
  const body = await requestJson<{ module: ModuleSummary }>(moduleUrl(id, "enable"), {
    method: "POST",
    body: {},
    fallback: "L'activation du module a échoué. Réessayez.",
  });
  return body.module;
}

/** Disables a module: its blocks leave the site; its data is kept. */
export async function disableModule(id: string): Promise<ModuleSummary> {
  const body = await requestJson<{ module: ModuleSummary }>(moduleUrl(id, "disable"), {
    method: "POST",
    body: {},
    fallback: "La désactivation du module a échoué. Réessayez.",
  });
  return body.module;
}

export async function saveModuleSettings(
  id: string,
  settings: Record<string, JsonValue>,
): Promise<ModuleSummary> {
  const body = await requestJson<{ module: ModuleSummary }>(moduleUrl(id, "settings"), {
    method: "PUT",
    body: settings,
    fallback: "L'enregistrement des réglages a échoué. Réessayez.",
  });
  return body.module;
}

/** Saves the credentials (encrypted by the server, never sent back). */
export async function saveModuleCredentials(
  id: string,
  credentials: Record<string, JsonValue>,
): Promise<ModuleSummary> {
  const body = await requestJson<{ module: ModuleSummary }>(moduleUrl(id, "credentials"), {
    method: "PUT",
    body: credentials,
    fallback: "L'enregistrement des identifiants a échoué. Réessayez.",
  });
  return body.module;
}

export async function deleteModuleCredentials(id: string): Promise<ModuleSummary> {
  const body = await requestJson<{ module: ModuleSummary }>(moduleUrl(id, "credentials"), {
    method: "DELETE",
    fallback: "La suppression des identifiants a échoué. Réessayez.",
  });
  return body.module;
}

/** The enabled modules, for the editor and the menu (any signed-in user). */
export async function fetchClientModules(): Promise<ClientModuleEntry[]> {
  const body = await requestJson<{ modules: ClientModuleEntry[] }>("/api/client-modules", {
    fallback: "Impossible de charger les modules activés.",
  });
  return body.modules;
}
