import { readdir, readFile, rm, stat } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { ReleaseError } from "./exec.js";

/**
 * The production `node_modules` of a package, cut down to what runs (`pnpm deploy` also brings
 * the optional peers it found in the workspace — vitest, drizzle-kit… for better-auth — and the
 * binaries of every libc). Starting from the application's `package.json`, every dependency,
 * optional dependency and non-optional peer is followed with Node's resolution; optional ones
 * built for another platform are left out; whatever is not reached is removed.
 */

/** A platform of the packages: `<process.platform>-<process.arch>`, Linux on glibc. */
export interface Target {
  readonly platform: string;
  readonly os: string;
  readonly cpu: string;
  readonly libc: "glibc" | undefined;
}

const PLATFORM_PATTERN = /^(linux|win32|darwin)-(x64|arm64)$/;

export function parseTarget(platform: string): Target {
  const match = PLATFORM_PATTERN.exec(platform);
  if (match?.[1] === undefined || match[2] === undefined) {
    throw new ReleaseError(
      `Plateforme inconnue : « ${platform} » (attendu : linux-x64, linux-arm64, win32-x64…).`,
    );
  }
  return {
    platform,
    os: match[1],
    cpu: match[2],
    libc: match[1] === "linux" ? "glibc" : undefined,
  };
}

interface PackageJson {
  readonly name?: string;
  readonly files?: readonly string[];
  readonly os?: readonly string[];
  readonly cpu?: readonly string[];
  readonly libc?: readonly string[];
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly peerDependenciesMeta?: Readonly<Record<string, { optional?: boolean }>>;
}

async function readPackageJson(directory: string): Promise<PackageJson> {
  return JSON.parse(await readFile(join(directory, "package.json"), "utf8")) as PackageJson;
}

/** npm's rule for `os`, `cpu` and `libc`: allowed values, or `!value` exclusions. */
function allows(list: readonly string[] | undefined, value: string | undefined): boolean {
  if (list === undefined || list.length === 0) {
    return true;
  }
  if (value === undefined) {
    return false;
  }
  if (list.includes(`!${value}`)) {
    return false;
  }
  const allowed = list.filter((item) => !item.startsWith("!"));
  return allowed.length === 0 || allowed.includes(value);
}

export function supportsTarget(pkg: PackageJson, target: Target): boolean {
  return (
    allows(pkg.os, target.os) &&
    allows(pkg.cpu, target.cpu) &&
    (pkg.libc === undefined || allows(pkg.libc, target.libc))
  );
}

async function isDirectory(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined))?.isDirectory() ?? false;
}

/** Node's lookup: `node_modules/<name>` in the package's directory, then in each parent up to `root`. */
async function resolvePackage(
  from: string,
  name: string,
  root: string,
): Promise<string | undefined> {
  let directory = from;
  for (;;) {
    const candidate = join(directory, "node_modules", name);
    if (await isDirectory(candidate)) {
      return candidate;
    }
    if (relative(root, directory) === "") {
      return undefined;
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return undefined;
    }
    directory = parent;
  }
}

/** Directories of the packages the application at `root` needs on `target`. */
export async function reachablePackages(root: string, target: Target): Promise<Set<string>> {
  const reached = new Set<string>();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const directory = queue.shift() as string;
    const pkg = await readPackageJson(directory);
    const optionalPeers = new Set(
      Object.entries(pkg.peerDependenciesMeta ?? {})
        .filter(([, meta]) => meta.optional === true)
        .map(([name]) => name),
    );
    const wanted: [name: string, optional: boolean][] = [
      ...Object.keys(pkg.dependencies ?? {}).map((name): [string, boolean] => [name, false]),
      ...Object.keys(pkg.optionalDependencies ?? {}).map((name): [string, boolean] => [name, true]),
      ...Object.keys(pkg.peerDependencies ?? {})
        .filter((name) => !optionalPeers.has(name))
        .map((name): [string, boolean] => [name, false]),
    ];
    for (const [name, optional] of wanted) {
      const found = await resolvePackage(directory, name, root);
      if (found === undefined) {
        if (optional) {
          continue;
        }
        throw new ReleaseError(
          `Dépendance « ${name} » de ${pkg.name ?? directory} absente du paquet construit.`,
        );
      }
      if (reached.has(found)) {
        continue;
      }
      if (optional && !supportsTarget(await readPackageJson(found), target)) {
        continue;
      }
      reached.add(found);
      queue.push(found);
    }
  }
  return reached;
}

/** Package directories under a `node_modules` (scoped ones included). */
async function packageDirectories(nodeModules: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(nodeModules, { withFileTypes: true }).catch(() => [])) {
    const path = join(nodeModules, entry.name);
    if (entry.name.startsWith("@") && entry.isDirectory()) {
      for (const scoped of await readdir(path, { withFileTypes: true })) {
        result.push(join(path, scoped.name));
      }
    } else if (!entry.name.startsWith(".")) {
      result.push(path);
    }
  }
  return result;
}

/**
 * Removes from `root/node_modules` (and the nested ones) every package not in `keep`, pnpm's
 * own files (`.bin`, `.pnpm`, `.modules.yaml`…) and the scopes left empty.
 *
 * @returns how many packages were removed.
 */
export async function removeUnreachable(root: string, keep: ReadonlySet<string>): Promise<number> {
  let removed = 0;
  const visit = async (nodeModules: string): Promise<void> => {
    for (const entry of await readdir(nodeModules, { withFileTypes: true }).catch(() => [])) {
      if (entry.name.startsWith(".")) {
        await rm(join(nodeModules, entry.name), { recursive: true, force: true });
      }
    }
    for (const directory of await packageDirectories(nodeModules)) {
      if (keep.has(directory)) {
        await visit(join(directory, "node_modules"));
      } else {
        await rm(directory, { recursive: true, force: true });
        removed += 1;
      }
    }
    for (const entry of await readdir(nodeModules, { withFileTypes: true }).catch(() => [])) {
      const path = join(nodeModules, entry.name);
      if (entry.name.startsWith("@") && (await readdir(path)).length === 0) {
        await rm(path, { recursive: true });
      }
    }
  };
  await visit(join(root, "node_modules"));
  return removed;
}

/** Keeps only `keep` (relative paths) in `directory`. */
async function keepOnly(directory: string, keep: readonly string[]): Promise<void> {
  const wanted = new Set(keep.map((path) => path.split(/[\\/]/)[0]));
  for (const entry of await readdir(directory)) {
    if (!wanted.has(entry)) {
      await rm(join(directory, entry), { recursive: true, force: true });
    }
  }
}

/**
 * Files of a kept package that never run: the sources and tsconfig of the workspace packages
 * (only `package.json` and their `files`, `dist` by default, are used), and the C sources and
 * other platforms' binaries of better-sqlite3 (one prebuilt binary per platform).
 */
export async function trimPackages(keep: ReadonlySet<string>, target: Target): Promise<void> {
  for (const directory of keep) {
    const pkg = await readPackageJson(directory);
    if (pkg.name?.startsWith("@sport-cms/")) {
      await keepOnly(directory, ["package.json", ...(pkg.files ?? ["dist"])]);
    } else if (pkg.name === "better-sqlite3") {
      await keepOnly(directory, ["package.json", "LICENSE", "lib", "prebuilds"]);
      const binary = `${target.platform}.node`;
      const prebuilds = join(directory, "prebuilds");
      const binaries = await readdir(prebuilds);
      if (!binaries.includes(binary)) {
        throw new ReleaseError(`better-sqlite3 ne fournit pas de binaire pour ${target.platform}.`);
      }
      for (const file of binaries) {
        if (file !== binary) {
          await rm(join(prebuilds, file), { force: true });
        }
      }
    }
  }
}

/** The whole cut: unreachable packages removed, kept ones trimmed. */
export async function prune(
  root: string,
  target: Target,
): Promise<{ kept: number; removed: number }> {
  const keep = await reachablePackages(root, target);
  const removed = await removeUnreachable(root, keep);
  await trimPackages(keep, target);
  return { kept: keep.size, removed };
}
