import { ManifestError, parseManifest } from "@sport-cms/supervisor";
import semver from "semver";
import { ReleaseError } from "./exec.js";

/**
 * Edits of the manifest (`manifest.json` on GitHub Pages), in the format the supervisor reads
 * (`apps/supervisor/src/manifest.ts`). The file is kept as written (dates as ISO text); every
 * edit is checked with the supervisor's own parser before it is published.
 */

export interface RawPackage {
  readonly url: string;
  readonly size: number;
  readonly sha256: string;
  readonly signature: string;
}

export interface RawRelease {
  readonly version: string;
  readonly publishedAt: string;
  readonly notes: string;
  readonly urgent: boolean;
  readonly rollout: number;
  readonly minEnvironment: number;
  readonly minFrom?: string;
  readonly packages: Readonly<Record<string, RawPackage>>;
}

export interface RawManifest {
  readonly schema: 1;
  readonly releases: readonly RawRelease[];
  readonly withdrawn: readonly string[];
}

export function emptyManifest(): RawManifest {
  return { schema: 1, releases: [], withdrawn: [] };
}

/** Checks a manifest with the supervisor's parser; returns it unchanged. */
export function checkManifest(value: unknown): RawManifest {
  try {
    parseManifest(value);
  } catch (error) {
    if (error instanceof ManifestError) {
      throw new ReleaseError(error.message);
    }
    throw error;
  }
  const manifest = value as RawManifest;
  return { ...manifest, withdrawn: manifest.withdrawn ?? [] };
}

export function parseManifestText(text: string): RawManifest {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ReleaseError("Le manifeste publié n'est pas du JSON valide.");
  }
  return checkManifest(json);
}

export function serializeManifest(manifest: RawManifest): string {
  return `${JSON.stringify(checkManifest(manifest), null, 2)}\n`;
}

/** Versions the manifest knows, withdrawn ones included: none may be published again. */
export function knownVersions(manifest: RawManifest): string[] {
  return [
    ...new Set([...manifest.releases.map((release) => release.version), ...manifest.withdrawn]),
  ];
}

/** The manifest with one more release, newest first. */
export function addRelease(manifest: RawManifest, release: RawRelease): RawManifest {
  if (knownVersions(manifest).includes(release.version)) {
    throw new ReleaseError(`La version ${release.version} figure déjà dans le manifeste.`);
  }
  const releases = [...manifest.releases, release].sort((a, b) =>
    semver.rcompare(a.version, b.version),
  );
  return checkManifest({ ...manifest, releases });
}

function findRelease(manifest: RawManifest, version: string): RawRelease {
  const release = manifest.releases.find((item) => item.version === version);
  if (release === undefined) {
    throw new ReleaseError(`La version ${version} ne figure pas dans le manifeste.`);
  }
  return release;
}

/** Progressive rollout: the share of the instances (0 to 100) that install `version`. */
export function setRollout(manifest: RawManifest, version: string, rollout: number): RawManifest {
  if (!Number.isInteger(rollout) || rollout < 0 || rollout > 100) {
    throw new ReleaseError("Le pourcentage de déploiement est un entier de 0 à 100.");
  }
  findRelease(manifest, version);
  return checkManifest({
    ...manifest,
    releases: manifest.releases.map((item) =>
      item.version === version ? { ...item, rollout } : item,
    ),
  });
}

/**
 * Withdraws `version`: instances that do not have it never install it, those that have it get
 * the next release. Its entry stays, so the version can never be published again.
 */
export function withdrawRelease(manifest: RawManifest, version: string): RawManifest {
  findRelease(manifest, version);
  if (manifest.withdrawn.includes(version)) {
    throw new ReleaseError(`La version ${version} est déjà retirée.`);
  }
  return checkManifest({ ...manifest, withdrawn: [...manifest.withdrawn, version] });
}
