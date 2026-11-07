import exemple from "@sport-cms/module-exemple";
import { type ModuleClientFiles, officialClientFiles } from "./module-clients.js";

/**
 * Official modules, shipped with the CMS (`modules/*`): present on every instance, disabled
 * until the owner enables them. A new official module is added here, to
 * {@link officialModuleClients} when it has a client entry, and to the dependencies of
 * `@sport-cms/server`.
 */
export const officialModules: readonly unknown[] = [exemple];

/** Client entries of the official modules (their `dist/client.js`), by id. */
export const officialModuleClients: Readonly<Record<string, ModuleClientFiles>> = {
  exemple: officialClientFiles("@sport-cms/module-exemple"),
};
