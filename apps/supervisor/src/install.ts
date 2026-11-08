import { createHash, type KeyObject, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { extract } from "tar";
import { z } from "zod";
import { readJsonFile } from "./files.js";
import { isAllowedDownloadUrl, type Release } from "./manifest.js";
import { verifyReleaseSignature } from "./signature.js";

/**
 * Installing a version: `DATA_DIR/app/<version>/` holds it once complete. The archive is
 * downloaded beside it (`.downloads/`), extracted in a staging directory (`.staging-*`), and
 * renamed into place last: a version directory is never half written, and whatever a power cut
 * leaves behind starts with a dot and is swept at the next start.
 */

/** Largest package accepted, in bytes. */
export const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;

/** File at the root of every package, describing it. */
export const APP_DESCRIPTOR_FILE = "app.json";

const descriptorSchema = z.object({
  version: z.string().min(1),
  /** Entry point started with Node, relative to the package's root. */
  main: z.string().min(1),
});

export type AppDescriptor = z.infer<typeof descriptorSchema>;

/** The package was refused; nothing of the installed versions was touched. */
export class InstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InstallError";
  }
}

/** Version names become directory names: only what semver allows, nothing to escape with. */
const VERSION_DIRECTORY = /^[0-9A-Za-z.+-]+$/;

export function versionDirectory(appsDirectory: string, version: string): string {
  if (!VERSION_DIRECTORY.test(version) || version.startsWith(".")) {
    throw new InstallError(`Numéro de version refusé : ${version}`);
  }
  return join(appsDirectory, version);
}

/**
 * Reads and checks `app.json` of an installed (or staged) version: same version, entry point
 * inside the directory and present. Returns the absolute path of the entry point.
 */
export async function readAppDescriptor(
  directory: string,
  version: string,
): Promise<{ readonly descriptor: AppDescriptor; readonly entry: string }> {
  let raw: unknown;
  try {
    raw = await readJsonFile(join(directory, APP_DESCRIPTOR_FILE));
  } catch {
    throw new InstallError(
      `Le fichier ${APP_DESCRIPTOR_FILE} de la version ${version} est illisible.`,
    );
  }
  const parsed = descriptorSchema.safeParse(raw);
  if (!parsed.success) {
    throw new InstallError(
      `La version ${version} n'a pas de fichier ${APP_DESCRIPTOR_FILE} valide.`,
    );
  }
  const descriptor = parsed.data;
  if (descriptor.version !== version) {
    throw new InstallError(
      `Le paquet annonce la version ${descriptor.version} au lieu de ${version}.`,
    );
  }
  const entry = resolve(directory, descriptor.main);
  const inside = relative(directory, entry);
  if (inside === "" || inside.startsWith("..") || isAbsolute(inside)) {
    throw new InstallError(`Le point d'entrée de la version ${version} sort de son dossier.`);
  }
  const entryStat = await stat(entry).catch(() => undefined);
  if (entryStat?.isFile() !== true) {
    throw new InstallError(`Le point d'entrée de la version ${version} est absent.`);
  }
  return { descriptor, entry };
}

export interface StageOptions {
  readonly release: Release;
  readonly platform: string;
  /** URL of the manifest, against which a relative package URL resolves. */
  readonly manifestUrl: string;
  /** `DATA_DIR/app`. */
  readonly appsDirectory: string;
  readonly trustedKeys: readonly KeyObject[];
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * Downloads a release, checks it (signature of the declared checksum, then the checksum and size
 * of the bytes received), extracts it and puts it in place. Any failure removes what it wrote
 * and leaves the installed versions alone.
 *
 * @throws {InstallError} with a French message.
 */
export async function stageRelease(options: StageOptions): Promise<string> {
  const { release, platform, appsDirectory, trustedKeys } = options;
  const target = versionDirectory(appsDirectory, release.version);
  if ((await stat(target).catch(() => undefined)) !== undefined) {
    await readAppDescriptor(target, release.version);
    return target;
  }
  const releasePackage = release.packages[platform];
  if (releasePackage === undefined) {
    throw new InstallError(`La version ${release.version} n'existe pas pour ${platform}.`);
  }
  if (releasePackage.size > MAX_PACKAGE_BYTES) {
    throw new InstallError(`Le paquet de la version ${release.version} est trop volumineux.`);
  }
  // Checked before anything is downloaded: a manifest altered on the way is stopped here.
  if (
    !verifyReleaseSignature(
      trustedKeys,
      release.version,
      platform,
      releasePackage.sha256,
      releasePackage.signature,
    )
  ) {
    throw new InstallError(
      `La signature de la version ${release.version} est invalide : le paquet a été ignoré.`,
    );
  }
  const url = URL.parse(releasePackage.url, options.manifestUrl);
  if (url === null || !isAllowedDownloadUrl(url)) {
    throw new InstallError(`Adresse du paquet refusée (https requis) : ${releasePackage.url}`);
  }

  const suffix = randomBytes(6).toString("hex");
  const downloads = join(appsDirectory, ".downloads");
  const archive = join(downloads, `${release.version}-${suffix}.tgz`);
  const staging = join(appsDirectory, `.staging-${release.version}-${suffix}`);
  await mkdir(downloads, { recursive: true });
  try {
    await download(url, archive, releasePackage.size, releasePackage.sha256, options);
    await mkdir(staging);
    // Plain files and directories only (`pnpm release` writes nothing else): a link could
    // point outside the version's directory.
    let refused = false;
    try {
      await extract({
        file: archive,
        cwd: staging,
        strict: true,
        filter: (_path, entry) => {
          const plain = "type" in entry && (entry.type === "File" || entry.type === "Directory");
          refused ||= !plain;
          return plain;
        },
      });
    } catch {
      throw new InstallError(`Le paquet de la version ${release.version} est illisible.`);
    }
    if (refused) {
      throw new InstallError(
        `Le paquet de la version ${release.version} contient des liens ou des fichiers spéciaux : il a été ignoré.`,
      );
    }
    await readAppDescriptor(staging, release.version);
    await rename(staging, target);
    return target;
  } finally {
    await rm(downloads, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}

async function download(
  url: URL,
  file: string,
  size: number,
  expectedSha256: string,
  { fetch: fetchImpl = fetch, timeoutMs = 30 * 60_000, release }: StageOptions,
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs), redirect: "follow" });
  } catch (error) {
    throw new InstallError(
      `Le paquet de la version ${release.version} est injoignable (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok || response.body === null) {
    throw new InstallError(
      `Le téléchargement de la version ${release.version} répond ${response.status}.`,
    );
  }
  const hash = createHash("sha256");
  let received = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > size) {
        callback(
          new InstallError(
            `Le paquet de la version ${release.version} dépasse sa taille annoncée.`,
          ),
        );
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(
      Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
      meter,
      createWriteStream(file),
    );
  } catch (error) {
    if (error instanceof InstallError) {
      throw error;
    }
    throw new InstallError(`Le téléchargement de la version ${release.version} a échoué.`);
  }
  if (received !== size || hash.digest("hex") !== expectedSha256) {
    throw new InstallError(
      `La somme de contrôle de la version ${release.version} ne correspond pas : le paquet a été ignoré.`,
    );
  }
}

/** Removes what an interrupted download or extraction left in `DATA_DIR/app`. */
export async function sweepLeftovers(appsDirectory: string): Promise<void> {
  const entries = await readdir(appsDirectory).catch(() => [] as string[]);
  await Promise.all(
    entries
      .filter((name) => name === ".downloads" || name.startsWith(".staging-"))
      .map((name) => rm(join(appsDirectory, name), { recursive: true, force: true })),
  );
}

/** Removes every installed version but those kept (current, previous, available). */
export async function pruneVersions(
  appsDirectory: string,
  keep: ReadonlySet<string>,
): Promise<void> {
  const entries = await readdir(appsDirectory, { withFileTypes: true }).catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith(".") && !keep.has(entry.name),
      )
      .map((entry) => rm(join(appsDirectory, entry.name), { recursive: true, force: true })),
  );
}
