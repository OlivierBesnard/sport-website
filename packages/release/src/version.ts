import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import semver from "semver";
import { ReleaseError } from "./exec.js";

/**
 * The version of the CMS lives in one place, `CMS_VERSION` of `@sport-cms/core`: the server
 * reports it on `/health`, which the supervisor compares with the release it installed. The
 * release script writes it, so the package and the code it contains always agree.
 */

/** Path of the file that declares `CMS_VERSION`, from the repository root (as Git writes it). */
export const VERSION_FILE = "packages/core/src/version.ts";

const DECLARATION = /^export const CMS_VERSION = "([^"]*)";$/m;

/** `CMS_VERSION` as declared in the source of `version.ts`. */
export function readDeclaredVersion(source: string): string {
  const match = DECLARATION.exec(source);
  if (match?.[1] === undefined) {
    throw new ReleaseError(`Déclaration de CMS_VERSION introuvable dans ${VERSION_FILE}.`);
  }
  return match[1];
}

/** The source of `version.ts` with another `CMS_VERSION`. */
export function withDeclaredVersion(source: string, version: string): string {
  readDeclaredVersion(source);
  return source.replace(DECLARATION, `export const CMS_VERSION = "${version}";`);
}

export async function readVersion(root: string): Promise<string> {
  return readDeclaredVersion(await readFile(join(root, VERSION_FILE), "utf8"));
}

export async function writeVersion(root: string, version: string): Promise<void> {
  const file = join(root, VERSION_FILE);
  await writeFile(file, withDeclaredVersion(await readFile(file, "utf8"), version));
}

/**
 * Checks the version to publish: strict semver (no `v`, no build metadata, which semver ignores
 * when comparing), newer than the current one (the last version released from `main`, which
 * is linear), and not already in the manifest (or withdrawn from it).
 *
 * @throws {ReleaseError} in French.
 */
export function checkNewVersion(
  version: string,
  current: string,
  published: readonly string[],
): void {
  if (semver.valid(version) !== version || version.includes("+")) {
    throw new ReleaseError(
      `« ${version} » n'est pas un numéro de version valide (attendu : 1.4.0 ou 1.5.0-beta.1).`,
    );
  }
  if (!semver.gt(version, current)) {
    throw new ReleaseError(
      `La version ${version} doit être plus récente que la version actuelle (${current}).`,
    );
  }
  if (published.includes(version)) {
    throw new ReleaseError(`La version ${version} est déjà publiée.`);
  }
}
