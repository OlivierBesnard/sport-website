import { EVENT_TYPE_PATTERN, parseEventSelector } from "@sport-cms/core";
import { z } from "zod";
import { parseCron } from "./cron.js";
import type { ModuleDefinition } from "./define.js";

/** Identifier of a module: lowercase letters and digits, words joined by `-` (`newsletter-brevo`). */
export const MODULE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Version of a module: semver 2.0.0 (`1.4.0`, `2.0.0-beta.1`). */
const SEMVER_PATTERN =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

/** A permission asked by a module: words separated by `.` or `:` (`members:write`). */
const PERMISSION_PATTERN = /^[a-z][a-z0-9_-]*(?:[.:][a-z][a-z0-9_-]*)+$/;

/** Field types of the block contract (`@sport-cms/blocks`). */
const BLOCK_FIELD_TYPES = [
  "text",
  "textarea",
  "richtext",
  "number",
  "boolean",
  "select",
  "radio",
  "slot",
  "array",
  "object",
  "reference",
] as const;

function text(max: number, label: string) {
  return z
    .string({ error: `${label} doit être un texte.` })
    .trim()
    .min(1, `${label} est requis.`)
    .max(max, `${label} est trop long (${max} caractères maximum).`);
}

const dataProcessingSchema = z.object({
  purpose: text(300, "La finalité du traitement"),
  data: z
    .array(text(100, "Une catégorie de données"))
    .min(1, "Un traitement déclare au moins une catégorie de données."),
  processors: z.array(text(200, "Un sous-traitant")).optional(),
  retention: text(200, "La durée de conservation"),
});

/** Fields shared by `manifest.json` and the module definition. */
const identityShape = {
  id: z
    .string({ error: "L'identifiant du module doit être un texte." })
    .max(50, "L'identifiant du module est trop long (50 caractères maximum).")
    .regex(
      MODULE_ID_PATTERN,
      "L'identifiant du module s'écrit en minuscules, chiffres et tirets (ex. « helloasso »).",
    ),
  name: text(100, "Le nom du module"),
  version: z
    .string({ error: "La version du module doit être un texte." })
    .regex(SEMVER_PATTERN, "La version du module doit suivre semver (ex. « 1.0.0 »)."),
  description: z
    .string({ error: "La description doit être un texte." })
    .max(500, "La description est trop longue (500 caractères maximum).")
    .optional(),
  category: z
    .string({ error: "La catégorie doit être un texte." })
    .max(50, "La catégorie est trop longue (50 caractères maximum).")
    .optional(),
  permissions: z
    .array(
      z
        .string({ error: "Une permission doit être un texte." })
        .max(100, "Une permission est trop longue (100 caractères maximum).")
        .regex(
          PERMISSION_PATTERN,
          "Une permission s'écrit en mots séparés par « . » ou « : » (ex. « members:write »).",
        ),
    )
    .max(50, "Un module demande au plus 50 permissions.")
    .refine((list) => new Set(list).size === list.length, "Une permission est demandée deux fois.")
    .default([]),
  dataProcessing: z
    .array(dataProcessingSchema)
    .max(50, "Un module déclare au plus 50 traitements de données.")
    .default([]),
};

const enginesSchema = z.object(
  { cms: text(200, "La plage de versions du CMS (engines.cms)") },
  { error: "Le manifeste doit déclarer les versions du CMS supportées (engines.cms)." },
);

/**
 * `manifest.json` of a module installed in `DATA_DIR/modules/<id>/`: read and checked before any
 * of its code runs. Unknown keys are ignored (a manifest written for a newer CMS).
 */
export const moduleManifestSchema = z.object({ ...identityShape, engines: enginesSchema });

export type ModuleManifest = z.infer<typeof moduleManifestSchema>;

/**
 * zod's French messages, for the issues without a message of their own (given per parse), and
 * the input in each issue: zod 4 leaves it out by default, and `issuesOf` tells a missing value
 * from a wrong one by it.
 */
export const FRENCH = { error: z.locales.fr().localeError, reportInput: true };

/** Result of a check: the value, or the problems found, in French. */
export type ModuleCheck<Value> =
  | { readonly success: true; readonly value: Value }
  | { readonly success: false; readonly issues: readonly string[] };

/** French messages of a failed validation, each prefixed by the path of the offending value. */
export function issuesOf(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.map(String).join(".");
    const message =
      issue.code === "invalid_type" && issue.input === undefined
        ? "valeur requise manquante."
        : issue.message;
    return path === "" ? message : `${path} : ${message}`;
  });
}

/** Checks the parsed content of a `manifest.json`. */
export function parseModuleManifest(value: unknown): ModuleCheck<ModuleManifest> {
  const result = moduleManifestSchema.safeParse(value, FRENCH);
  return result.success
    ? { success: true, value: result.data }
    : { success: false, issues: issuesOf(result.error) };
}

/**
 * Adds an issue for each block type that does not start with `<id>.` or is declared twice: the
 * types of a module never collide with the core's or another module's.
 */
export function checkBlockTypes(
  id: string,
  blocks: readonly { readonly type: string }[],
  context: z.RefinementCtx,
): void {
  const prefix = `${id}.`;
  const seen = new Set<string>();
  for (const [index, block] of blocks.entries()) {
    if (!block.type.startsWith(prefix) || block.type.length === prefix.length) {
      context.addIssue({
        code: "custom",
        path: ["blocks", index, "type"],
        message: `Le type du bloc « ${block.type} » doit commencer par « ${prefix} ».`,
      });
    }
    if (seen.has(block.type)) {
      context.addIssue({
        code: "custom",
        path: ["blocks", index, "type"],
        message: `Le type de bloc « ${block.type} » est déclaré deux fois.`,
      });
    }
    seen.add(block.type);
  }
}

export function fn(message: string) {
  return z.custom<unknown>((value) => typeof value === "function", { error: message });
}

function zodSchemaLike(label: string) {
  return z.custom<unknown>(
    (value) =>
      typeof value === "object" &&
      value !== null &&
      typeof (value as { safeParse?: unknown }).safeParse === "function",
    { error: `${label} doit être un schéma zod.` },
  );
}

/** One block of a module, as its server or client entry declares it. */
export const blockSchema = z.looseObject({
  // Checked as written (no trim): it is the key stored in page data.
  type: z
    .string({ error: "Le type du bloc doit être un texte." })
    .max(150, "Le type du bloc est trop long (150 caractères maximum).")
    .regex(/^\S+$/, "Le type du bloc ne doit contenir aucune espace."),
  label: text(100, "Le libellé du bloc"),
  fields: z.record(
    z.string(),
    z.looseObject({ type: z.enum(BLOCK_FIELD_TYPES, { error: "Type de champ inconnu." }) }),
    { error: "Les champs du bloc (fields) doivent être un objet." },
  ),
  defaultProps: z.record(z.string(), z.unknown(), {
    error: "Les valeurs par défaut du bloc (defaultProps) doivent être un objet.",
  }),
  dependsOn: z
    .array(
      z
        .string({ error: "Une dépendance du bloc doit être un type d'événement." })
        .regex(
          EVENT_TYPE_PATTERN,
          "Une dépendance du bloc doit être un type d'événement (ex. « match.updated »).",
        ),
      { error: "Les dépendances du bloc (dependsOn) doivent être une liste." },
    )
    .max(20, "Un bloc déclare au plus 20 dépendances.")
    .optional(),
  loader: fn("Le chargement des données du bloc (loader) doit être une fonction.").optional(),
  render: fn("Le rendu du bloc (render) doit être une fonction."),
});

/** Name of a job or of a webhook within its module: lowercase words joined by `-`. */
export const MODULE_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

const jobSchema = z.looseObject({
  id: z
    .string({ error: "L'identifiant de la tâche doit être un texte." })
    .max(50, "L'identifiant de la tâche est trop long (50 caractères maximum).")
    .regex(
      MODULE_NAME_PATTERN,
      "L'identifiant de la tâche s'écrit en minuscules, chiffres et tirets.",
    ),
  schedule: z
    .string({ error: "La planification de la tâche doit être un texte." })
    .superRefine((schedule, context) => {
      const parsed = parseCron(schedule);
      if (!parsed.ok) {
        context.addIssue({ code: "custom", message: parsed.error });
      }
    }),
  run: fn("L'exécution de la tâche (run) doit être une fonction."),
});

const definitionSchema = z
  .looseObject({
    ...identityShape,
    engines: enginesSchema.optional(),
    settings: zodSchemaLike("Le schéma des réglages (settings)").optional(),
    credentials: zodSchemaLike("Le schéma des identifiants (credentials)").optional(),
    blocks: z
      .array(blockSchema, { error: "Les blocs (blocks) doivent être une liste." })
      .max(100, "Un module déclare au plus 100 blocs.")
      .default([]),
    emits: z
      .array(
        z
          .string({ error: "Un événement émis doit être un type d'événement." })
          .regex(
            EVENT_TYPE_PATTERN,
            "Un événement émis s'écrit en mots séparés par des points (ex. « payment.received »).",
          ),
        { error: "Les événements émis (emits) doivent être une liste." },
      )
      .max(100, "Un module émet au plus 100 types d'événements.")
      .refine(
        (list) => new Set(list).size === list.length,
        "Un événement émis est déclaré deux fois.",
      )
      .optional(),
    on: z
      .record(z.string(), fn("Un abonnement (on) doit être une fonction."), {
        error: (issue) =>
          issue.code === "invalid_type" ? "Les abonnements (on) doivent être un objet." : undefined,
      })
      .optional(),
    jobs: z
      .array(jobSchema, { error: "Les tâches (jobs) doivent être une liste." })
      .max(20, "Un module déclare au plus 20 tâches.")
      .refine(
        (list) => new Set(list.map((job) => job.id)).size === list.length,
        "Une tâche est déclarée deux fois.",
      )
      .optional(),
    webhooks: z
      .record(z.string(), fn("Un webhook doit être une fonction."), {
        error: (issue) =>
          issue.code === "invalid_type" ? "Les webhooks doivent être un objet." : undefined,
      })
      .optional(),
    lifecycle: z
      .looseObject({
        onEnable: fn("lifecycle.onEnable doit être une fonction.").optional(),
        onDisable: fn("lifecycle.onDisable doit être une fonction.").optional(),
      })
      .optional(),
  })
  .superRefine((definition, context) => {
    checkBlockTypes(definition.id, definition.blocks, context);
    for (const selector of Object.keys(definition.on ?? {})) {
      if (parseEventSelector(selector) === undefined) {
        context.addIssue({
          code: "custom",
          path: ["on", selector],
          message:
            "Un abonnement (on) porte sur un type d'événement, éventuellement suivi de « @version » (ex. « payment.received@1 »).",
        });
      }
    }
    for (const name of Object.keys(definition.webhooks ?? {})) {
      if (!MODULE_NAME_PATTERN.test(name)) {
        context.addIssue({
          code: "custom",
          path: ["webhooks", name],
          message:
            "Le nom d'un webhook s'écrit en minuscules, chiffres et tirets (ex. « notifications »).",
        });
      }
    }
  });

/**
 * Checks what the server entry of a module exports by default: a {@link ModuleDefinition} (as
 * written with `defineModule`), its blocks, schemas and lifecycle hooks included. On success the
 * value is the definition itself, not a copy: defaults (`permissions`…) are not filled in.
 */
export function checkModuleDefinition(value: unknown): ModuleCheck<ModuleDefinition> {
  if (typeof value !== "object" || value === null) {
    return {
      success: false,
      issues: ["L'export par défaut doit être la définition du module (defineModule)."],
    };
  }
  const result = definitionSchema.safeParse(value, FRENCH);
  return result.success
    ? { success: true, value: value as ModuleDefinition }
    : { success: false, issues: issuesOf(result.error) };
}
