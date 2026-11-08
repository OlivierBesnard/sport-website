import { randomBytes } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assembleApp } from "./assemble.js";
import { ReleaseError, run } from "./exec.js";
import type { RawPackage } from "./manifest.js";
import { packDirectory } from "./pack.js";
import { parseTarget } from "./prune.js";
import { readVersion, writeVersion } from "./version.js";

/**
 * Builds the packages of a release from a commit, never from the working tree: a temporary
 * Git worktree of that commit is installed from the lockfile, checked and built, so what is
 * published is exactly what the commit contains (no stale `dist/`, no uncommitted file).
 */

export interface BuildOptions {
  /** Root of the repository. */
  readonly repository: string;
  readonly commit: string;
  readonly version: string;
  readonly platforms: readonly string[];
  /** Directory receiving the archives. */
  readonly output: string;
  /** `pnpm check` and `pnpm test:e2e` too (a real release); `pnpm build` only otherwise. */
  readonly verify: boolean;
  readonly sign: (version: string, platform: string, sha256: string) => string;
  /** URL of an archive in the manifest, from its file name. */
  readonly packageUrl: (file: string) => string;
  readonly log: (message: string) => void;
}

export function archiveName(version: string, platform: string): string {
  return `sport-cms-${version}-${platform}.tgz`;
}

export async function buildRelease(options: BuildOptions): Promise<Record<string, RawPackage>> {
  const { repository, commit, version, log } = options;
  const targets = options.platforms.map(parseTarget);
  const work = join(tmpdir(), `sport-cms-release-${randomBytes(4).toString("hex")}`);
  const checkout = join(work, "source");
  await mkdir(options.output, { recursive: true });
  log(`Copie de travail du commit ${commit.slice(0, 12)} dans ${checkout}`);
  await run("git", ["worktree", "add", "--detach", checkout, commit], { cwd: repository });
  try {
    if ((await readVersion(checkout)) !== version) {
      // Test releases only: a real one commits the version before it is built.
      await writeVersion(checkout, version);
    }
    const pnpm = (...args: string[]) => run("pnpm", args, { cwd: checkout, inherit: true });
    log("Installation des dépendances (lockfile)");
    await pnpm("install", "--frozen-lockfile");
    if (options.verify) {
      log("Vérification complète : pnpm check");
      await pnpm("check");
    }
    log("Construction : pnpm build");
    await pnpm("build");
    if (options.verify) {
      log("Tests de bout en bout : pnpm test:e2e");
      await pnpm("test:e2e");
    }
    const packages: Record<string, RawPackage> = {};
    for (const target of targets) {
      log(`Paquet ${target.platform}`);
      const directory = join(work, "apps", target.platform);
      await assembleApp({ source: checkout, target, version, directory, inherit: true });
      const file = archiveName(version, target.platform);
      const archive = await packDirectory(directory, join(options.output, file));
      packages[target.platform] = {
        url: options.packageUrl(file),
        size: archive.size,
        sha256: archive.sha256,
        signature: options.sign(version, target.platform, archive.sha256),
      };
      log(`  ${file} : ${(archive.size / 1024 / 1024).toFixed(1)} Mo, SHA-256 ${archive.sha256}`);
    }
    return packages;
  } finally {
    await run("git", ["worktree", "remove", "--force", checkout], { cwd: repository }).catch(
      () => undefined,
    );
    await rm(work, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
    await run("git", ["worktree", "prune"], { cwd: repository }).catch((error: unknown) => {
      if (error instanceof ReleaseError) {
        log(`Attention : ${error.message}`);
      }
    });
  }
}
