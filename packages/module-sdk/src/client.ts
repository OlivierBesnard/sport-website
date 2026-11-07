import type { BlockDefinition } from "@sport-cms/blocks";
import type { ComponentType } from "react";
import { z } from "zod";
import {
  blockSchema,
  checkBlockTypes,
  FRENCH,
  fn,
  issuesOf,
  MODULE_ID_PATTERN,
  type ModuleCheck,
} from "./manifest.js";

/**
 * Client entry of a module (`client.js`): what the back-office loads, in the browser, for each
 * enabled module. It never runs on the server and must not import Node.js built-ins.
 *
 * - `blocks`: the same block definitions as the server entry's (the editor shows exactly what the
 *   public site renders); the back-office keeps only the types the server also declares.
 * - `adminPages`: screens of the back-office, under `/admin/modules/<id>/<path>`.
 *
 * Bare imports resolve to the copies of the back-office (import map): `react`,
 * `react/jsx-runtime`, `react-dom`, `zod` and `@sport-cms/module-sdk`. Anything else is bundled
 * into the module's files, imported relatively.
 */

/** What a page of a module receives from the back-office. */
export interface AdminPageProps {
  readonly module: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
}

/** A screen of the back-office added by a module. */
export interface AdminPageDefinition {
  /** Path under `/admin/modules/<id>/`, in lowercase words (`campagnes`, `journal/ecritures`). */
  readonly path: string;
  /** Title in the menu and the page, in French. */
  readonly title: string;
  /**
   * Permission needed to see the page in the menu (`finance.manage`…); everyone signed in by
   * default. Only the interface: the data the page reads is guarded by the API.
   */
  readonly permission?: string;
  readonly component: ComponentType<AdminPageProps>;
}

/** Default export of the client entry of a module. */
export interface ModuleClientDefinition {
  /** Identifier of the module, the same as its server entry's. */
  readonly id: string;
  readonly blocks?: readonly BlockDefinition[];
  readonly adminPages?: readonly AdminPageDefinition[];
}

/** Declares the client entry of a module. */
export function defineModuleClient(definition: ModuleClientDefinition): ModuleClientDefinition {
  return definition;
}

/** Path of a page of a module: lowercase words joined by `-`, segments by `/`. */
export const ADMIN_PAGE_PATH_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\/[a-z0-9]+(?:-[a-z0-9]+)*)*$/;

const adminPageSchema = z.looseObject({
  path: z
    .string({ error: "Le chemin de la page (path) doit être un texte." })
    .max(100, "Le chemin de la page est trop long (100 caractères maximum).")
    .regex(
      ADMIN_PAGE_PATH_PATTERN,
      "Le chemin de la page s'écrit en minuscules, chiffres et tirets (ex. « campagnes »).",
    ),
  title: z
    .string({ error: "Le titre de la page doit être un texte." })
    .trim()
    .min(1, "Le titre de la page est requis.")
    .max(60, "Le titre de la page est trop long (60 caractères maximum)."),
  permission: z
    .string({ error: "La permission de la page doit être un texte." })
    .max(100, "La permission de la page est trop longue (100 caractères maximum).")
    .optional(),
  component: fn("Le composant de la page (component) doit être une fonction."),
});

const clientSchema = z
  .looseObject({
    id: z
      .string({ error: "L'identifiant du module doit être un texte." })
      .regex(MODULE_ID_PATTERN, "L'identifiant du module est invalide."),
    blocks: z
      .array(blockSchema, { error: "Les blocs (blocks) doivent être une liste." })
      .max(100, "Un module déclare au plus 100 blocs.")
      .default([]),
    adminPages: z
      .array(adminPageSchema, { error: "Les pages (adminPages) doivent être une liste." })
      .max(20, "Un module déclare au plus 20 pages.")
      .default([]),
  })
  .superRefine((client, context) => {
    checkBlockTypes(client.id, client.blocks, context);
    const paths = new Set<string>();
    for (const [index, page] of client.adminPages.entries()) {
      if (paths.has(page.path)) {
        context.addIssue({
          code: "custom",
          path: ["adminPages", index, "path"],
          message: `La page « ${page.path} » est déclarée deux fois.`,
        });
      }
      paths.add(page.path);
    }
  });

/**
 * Checks what the client entry of module `id` exports by default (`defineModuleClient`). On
 * success the value is the definition itself, its lists defaulted to empty ones.
 */
export function checkModuleClient(
  value: unknown,
  id: string,
): ModuleCheck<Required<ModuleClientDefinition>> {
  if (typeof value !== "object" || value === null) {
    return {
      success: false,
      issues: ["L'export par défaut doit être le client du module (defineModuleClient)."],
    };
  }
  const result = clientSchema.safeParse(value, FRENCH);
  if (!result.success) {
    return { success: false, issues: issuesOf(result.error) };
  }
  const client = value as ModuleClientDefinition;
  if (client.id !== id) {
    return {
      success: false,
      issues: [`Le client déclare le module « ${client.id} » au lieu de « ${id} ».`],
    };
  }
  return {
    success: true,
    value: { id, blocks: client.blocks ?? [], adminPages: client.adminPages ?? [] },
  };
}
