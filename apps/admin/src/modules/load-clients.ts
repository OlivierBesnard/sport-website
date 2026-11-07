import type { BlockDefinition } from "@sport-cms/blocks";
import { type AdminPageDefinition, checkModuleClient } from "@sport-cms/module-sdk";
import type { ClientModuleEntry } from "../api/modules";
import { type SessionUser, userCan } from "../api/session";

/**
 * Loading of the client entries of the enabled modules (`client.js`), in the browser: their
 * blocks join the editor, their pages the back-office. Each module is loaded on its own: one
 * that fails (network, broken code, invalid export) is reported and left out, the others and the
 * back-office keep working.
 */

/** A page of a module, with the module it belongs to. */
export interface LoadedModulePage extends AdminPageDefinition {
  readonly module: { readonly id: string; readonly name: string; readonly version: string };
}

/** Whether `user` may see the page (its `permission`, if any; only the interface). */
export function canSeePage(user: SessionUser, page: LoadedModulePage): boolean {
  return page.permission === undefined || userCan(user, page.permission);
}

/** A problem with a module's client, in French, for the person. */
export interface ModuleClientProblem {
  readonly id: string;
  readonly name: string;
  readonly message: string;
}

export interface ModuleClients {
  /** Blocks of the modules the server also renders, in the order of the modules. */
  readonly blocks: readonly BlockDefinition[];
  readonly pages: readonly LoadedModulePage[];
  readonly problems: readonly ModuleClientProblem[];
}

/** Imports one client entry (the browser's `import()` by default; a fake one in the tests). */
export type ClientImporter = (url: string) => Promise<unknown>;

const browserImport: ClientImporter = (url) => import(/* @vite-ignore */ url);

/** The client of one module, or the problems that leave it out. */
async function loadOne(
  entry: ClientModuleEntry,
  importer: ClientImporter,
): Promise<{
  blocks: BlockDefinition[];
  pages: LoadedModulePage[];
  problems: ModuleClientProblem[];
}> {
  const problem = (message: string): ModuleClientProblem => ({
    id: entry.id,
    name: entry.name,
    message,
  });
  if (entry.client === null) {
    return {
      blocks: [],
      pages: [],
      problems:
        entry.blocks.length === 0
          ? []
          : [
              problem(
                "Ce module n'a pas de client pour le back-office : ses blocs ne peuvent pas être ajoutés depuis l'éditeur.",
              ),
            ],
    };
  }
  let exported: unknown;
  try {
    exported = ((await importer(entry.client)) as { default?: unknown }).default;
  } catch (error) {
    // The raw error (often in English) goes to the console, for the module's author.
    console.error(`Client du module « ${entry.id} » :`, error);
    return {
      blocks: [],
      pages: [],
      problems: [problem("Le module n'a pas pu être chargé dans le back-office.")],
    };
  }
  const checked = checkModuleClient(exported, entry.id);
  if (!checked.success) {
    return {
      blocks: [],
      pages: [],
      problems: [problem(`Client du module invalide : ${checked.issues.join(" ")}`)],
    };
  }
  const rendered = new Set(entry.blocks);
  const problems: ModuleClientProblem[] = [];
  const blocks = checked.value.blocks.filter((block) => {
    if (!rendered.has(block.type)) {
      problems.push(
        problem(`Le bloc « ${block.type} » n'est pas déclaré par le serveur : il est ignoré.`),
      );
      return false;
    }
    return true;
  });
  const declared = new Set(blocks.map((block) => block.type));
  for (const type of entry.blocks) {
    if (!declared.has(type)) {
      problems.push(
        problem(
          `Le bloc « ${type} » est rendu sur le site, mais son client ne le déclare pas : il ne peut pas être ajouté depuis l'éditeur.`,
        ),
      );
    }
  }
  const module = { id: entry.id, name: entry.name, version: entry.version };
  return {
    blocks,
    pages: checked.value.adminPages.map((page) => ({ ...page, module })),
    problems,
  };
}

/** Loads the clients of `entries` (the enabled modules), in parallel. */
export async function loadModuleClients(
  entries: readonly ClientModuleEntry[],
  importer: ClientImporter = browserImport,
): Promise<ModuleClients> {
  const loaded = await Promise.all(entries.map((entry) => loadOne(entry, importer)));
  return {
    blocks: loaded.flatMap((one) => one.blocks),
    pages: loaded.flatMap((one) => one.pages),
    problems: loaded.flatMap((one) => one.problems),
  };
}
