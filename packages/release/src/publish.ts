import { generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENVIRONMENT_VERSION, TRUSTED_RELEASE_KEYS } from "@sport-cms/supervisor";
import semver from "semver";
import { archiveName, buildRelease } from "./build.js";
import { ReleaseError, run } from "./exec.js";
import { checkTrusted, publicKeyOf, signPackage } from "./keys.js";
import {
  addRelease,
  emptyManifest,
  knownVersions,
  type RawRelease,
  serializeManifest,
  setRollout,
  withdrawRelease,
} from "./manifest.js";
import { readPagesManifest, writePagesManifest } from "./pages.js";
import { checkNewVersion, readVersion, VERSION_FILE, writeVersion } from "./version.js";

/** Platforms of the Docker image (PLAN §6.8). */
export const RELEASE_PLATFORMS = ["linux-x64", "linux-arm64"] as const;

export const RELEASE_BRANCH = "main";

type Log = (message: string) => void;

export function tagName(version: string): string {
  return `v${version}`;
}

/** Where a release keeps its archives until it is fully published (`pnpm release resume`). */
export function releaseOutput(version: string): string {
  return join(tmpdir(), `sport-cms-release-${version}`);
}

const git = (repository: string, ...args: string[]) => run("git", args, { cwd: repository });

/** Refuses to release anything but a clean `main`, identical to GitHub's. */
export async function checkRepository(repository: string, log: Log): Promise<void> {
  if ((await git(repository, "status", "--porcelain")) !== "") {
    throw new ReleaseError(
      "L'arbre de travail contient des modifications : commitez-les ou mettez-les de côté avant de publier.",
    );
  }
  const branch = await git(repository, "rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== RELEASE_BRANCH) {
    throw new ReleaseError(
      `Une release se publie depuis ${RELEASE_BRANCH} (branche actuelle : ${branch}).`,
    );
  }
  log("Récupération de GitHub (git fetch)");
  await git(repository, "fetch", "--quiet", "origin", RELEASE_BRANCH);
  const local = await git(repository, "rev-parse", "HEAD");
  const remote = await git(repository, "rev-parse", `origin/${RELEASE_BRANCH}`);
  if (local !== remote) {
    throw new ReleaseError(
      `${RELEASE_BRANCH} n'est pas identique à GitHub (local ${local.slice(0, 12)}, GitHub ${remote.slice(0, 12)}) : poussez ou récupérez d'abord.`,
    );
  }
}

async function tagExists(
  repository: string,
  tag: string,
): Promise<{ local: boolean; remote: boolean }> {
  const local = await git(repository, "rev-parse", "--quiet", "--verify", `refs/tags/${tag}`)
    .then(() => true)
    .catch(() => false);
  const remote =
    (await git(repository, "ls-remote", "--tags", "origin", `refs/tags/${tag}`)) !== "";
  return { local, remote };
}

/** `owner/name` of the GitHub repository; fails early when `gh` is not signed in. */
export async function githubRepository(repository: string): Promise<string> {
  await run("gh", ["auth", "status"], { cwd: repository }).catch(() => {
    throw new ReleaseError("GitHub CLI n'est pas connecté : lancez « gh auth login ».");
  });
  return run("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    cwd: repository,
  });
}

export interface PublishOptions {
  readonly repository: string;
  readonly version: string;
  readonly notes: string;
  readonly urgent: boolean;
  readonly rollout: number;
  readonly minFrom: string | undefined;
  /** Asked only once the cheap checks passed. */
  readonly loadKey: () => Promise<KeyObject>;
  readonly log: Log;
}

/**
 * `pnpm release <version>` (PLAN §6.8): checks, version commit, full verification and build
 * of the packages from that commit, signature, then tag, GitHub release and manifest. Until the
 * push, a failure undoes the version commit; after it, `pnpm release resume <version>` finishes.
 */
export async function publish(options: PublishOptions): Promise<void> {
  const { repository, version, log } = options;
  await checkRepository(repository, log);
  const tag = tagName(version);
  const tags = await tagExists(repository, tag);
  if (tags.local || tags.remote) {
    throw new ReleaseError(`Le tag ${tag} existe déjà${tags.remote ? " sur GitHub" : ""}.`);
  }
  const githubName = await githubRepository(repository);
  const { manifest } = await readPagesManifest(repository);
  checkNewVersion(version, await readVersion(repository), knownVersions(manifest));
  if (options.minFrom !== undefined && semver.valid(options.minFrom) !== options.minFrom) {
    throw new ReleaseError(`--min-from attend un numéro de version (reçu : ${options.minFrom}).`);
  }
  const key = await options.loadKey();
  checkTrusted(key, TRUSTED_RELEASE_KEYS);

  const output = releaseOutput(version);
  await rm(output, { recursive: true, force: true });
  await writeVersion(repository, version);
  await git(repository, "commit", "--quiet", "-m", `Version ${version}`, "--", VERSION_FILE);
  const commit = await git(repository, "rev-parse", "HEAD");
  try {
    const packages = await buildRelease({
      repository,
      commit,
      version,
      platforms: RELEASE_PLATFORMS,
      output,
      verify: true,
      sign: (...args) => signPackage(key, ...args),
      packageUrl: (file) => `https://github.com/${githubName}/releases/download/${tag}/${file}`,
      log,
    });
    const release: RawRelease = {
      version,
      publishedAt: new Date().toISOString(),
      notes: options.notes,
      urgent: options.urgent,
      rollout: options.rollout,
      minEnvironment: ENVIRONMENT_VERSION,
      ...(options.minFrom === undefined ? {} : { minFrom: options.minFrom }),
      packages,
    };
    // Checked now, before anything leaves the machine.
    addRelease(manifest, release);
    await writeFile(join(output, "release.json"), `${JSON.stringify(release, null, 2)}\n`);
  } catch (error) {
    log("Échec : le commit de version est annulé.");
    await git(repository, "reset", "--quiet", "--keep", "HEAD~1");
    throw error;
  }

  log(`Tag ${tag} et envoi sur GitHub`);
  await git(repository, "tag", "-a", tag, "-m", `Version ${version}`, commit);
  await git(
    repository,
    "push",
    "--quiet",
    "--atomic",
    "origin",
    RELEASE_BRANCH,
    `refs/tags/${tag}`,
  );
  await finishPublication(repository, version, log);
}

/**
 * The GitHub release (with the archives) and the manifest entry. Both are skipped when already
 * done: safe to run again after an interruption.
 */
export async function finishPublication(
  repository: string,
  version: string,
  log: Log,
): Promise<void> {
  const output = releaseOutput(version);
  let release: RawRelease;
  try {
    release = JSON.parse(await readFile(join(output, "release.json"), "utf8")) as RawRelease;
  } catch {
    throw new ReleaseError(
      `Les paquets de la version ${version} sont introuvables (${output}) : la release n'a pas été construite sur cette machine.`,
    );
  }
  const tag = tagName(version);
  if (!(await tagExists(repository, tag)).remote) {
    throw new ReleaseError(`Le tag ${tag} n'est pas sur GitHub.`);
  }
  const archives = Object.keys(release.packages).map((platform) =>
    join(output, archiveName(version, platform)),
  );
  const exists = await run("gh", ["release", "view", tag, "--json", "tagName"], { cwd: repository })
    .then(() => true)
    .catch(() => false);
  if (exists) {
    log(`Release GitHub ${tag} déjà créée : paquets renvoyés`);
    await run("gh", ["release", "upload", tag, "--clobber", ...archives], {
      cwd: repository,
      inherit: true,
    });
  } else {
    log(`Création de la release GitHub ${tag}`);
    const notesFile = join(output, "notes.md");
    await writeFile(notesFile, release.notes === "" ? `Version ${version}.` : release.notes);
    await run(
      "gh",
      [
        "release",
        "create",
        tag,
        "--verify-tag",
        "--title",
        `Version ${version}`,
        "--notes-file",
        notesFile,
        ...(semver.prerelease(version) === null ? [] : ["--prerelease"]),
        ...archives,
      ],
      { cwd: repository, inherit: true },
    );
  }
  const { manifest, parent } = await readPagesManifest(repository);
  if (knownVersions(manifest).includes(version)) {
    log("Le manifeste contient déjà cette version.");
  } else {
    log("Publication du manifeste sur GitHub Pages");
    await writePagesManifest(
      repository,
      addRelease(manifest, release),
      parent,
      `Version ${version}`,
    );
  }
  await rm(output, { recursive: true, force: true });
  log(
    `Version ${version} publiée (déploiement : ${release.rollout} %${release.urgent ? ", urgente" : ""}).`,
  );
}

/** `pnpm release rollout <version> <pourcentage>`. */
export async function changeRollout(
  repository: string,
  version: string,
  rollout: number,
  log: Log,
): Promise<void> {
  const { manifest, parent } = await readPagesManifest(repository);
  await writePagesManifest(
    repository,
    setRollout(manifest, version, rollout),
    parent,
    `Déploiement de ${version} : ${rollout} %`,
  );
  log(`Version ${version} : déploiement à ${rollout} %.`);
}

/** `pnpm release withdraw <version>`. */
export async function withdraw(repository: string, version: string, log: Log): Promise<void> {
  const { manifest, parent } = await readPagesManifest(repository);
  await writePagesManifest(
    repository,
    withdrawRelease(manifest, version),
    parent,
    `Retrait de ${version}`,
  );
  log(`Version ${version} retirée : les instances qui ne l'ont pas l'ignoreront.`);
}

export interface TestReleaseOptions {
  readonly repository: string;
  readonly version: string | undefined;
  readonly platforms: readonly string[];
  readonly output: string;
  /** Base of the archives' URLs in the manifest; relative to the manifest without it. */
  readonly baseUrl: string | undefined;
  readonly log: Log;
}

/**
 * `pnpm release test`: the same packages as a release, from `HEAD`, signed with a key generated
 * for the occasion, with their manifest, in a local directory. Nothing is pushed. Served over
 * `http://127.0.0.1`, they let a supervisor started with `UPDATE_MANIFEST_URL` and
 * `UPDATE_PUBLIC_KEY` install a real build.
 *
 * @returns the public key to trust.
 */
export async function testRelease(options: TestReleaseOptions): Promise<string> {
  const { repository, output, log } = options;
  if ((await git(repository, "status", "--porcelain")) !== "") {
    log(
      "Attention : les modifications non commitées ne sont pas dans la release de test (construite depuis HEAD).",
    );
  }
  const current = await readVersion(repository);
  const version = options.version ?? (semver.inc(current, "patch") as string);
  if (semver.valid(version) !== version) {
    throw new ReleaseError(`« ${version} » n'est pas un numéro de version valide.`);
  }
  await mkdir(output, { recursive: true });
  if ((await readdir(output)).length > 0) {
    throw new ReleaseError(`Le dossier ${output} n'est pas vide.`);
  }
  const { privateKey } = generateKeyPairSync("ed25519");
  const packages = await buildRelease({
    repository,
    commit: await git(repository, "rev-parse", "HEAD"),
    version,
    platforms: options.platforms,
    output,
    verify: false,
    sign: (...args) => signPackage(privateKey, ...args),
    packageUrl: (file) =>
      options.baseUrl === undefined ? file : new URL(file, options.baseUrl).href,
    log,
  });
  const manifest = addRelease(emptyManifest(), {
    version,
    publishedAt: new Date().toISOString(),
    notes: "Release de test.",
    urgent: false,
    rollout: 100,
    minEnvironment: ENVIRONMENT_VERSION,
    packages,
  });
  await writeFile(join(output, "manifest.json"), serializeManifest(manifest));
  const publicKey = publicKeyOf(privateKey);
  await writeFile(join(output, "public-key.txt"), `${publicKey}\n`);
  return publicKey;
}
