import { createHash, generateKeyPairSync } from "node:crypto";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import {
  parseManifest,
  releasePublicKey,
  stageRelease,
  TRUSTED_RELEASE_KEYS,
} from "@sport-cms/supervisor";
import { Header } from "tar";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ReleaseError, run } from "./exec.js";
import {
  checkTrusted,
  createKeyFile,
  isInside,
  loadSigningKey,
  publicKeyOf,
  signPackage,
} from "./keys.js";
import {
  addRelease,
  emptyManifest,
  knownVersions,
  parseManifestText,
  type RawRelease,
  serializeManifest,
  setRollout,
  withdrawRelease,
} from "./manifest.js";
import { listTree, packDirectory } from "./pack.js";
import { readPagesManifest, writePagesManifest } from "./pages.js";
import { parseTarget, prune, supportsTarget } from "./prune.js";
import { checkRepository } from "./publish.js";
import {
  checkNewVersion,
  readDeclaredVersion,
  readVersion,
  withDeclaredVersion,
} from "./version.js";

const REPOSITORY = join(import.meta.dirname, "..", "..", "..");

let temp: string;
beforeEach(async () => {
  temp = await mkdtemp(join(tmpdir(), "sport-cms-release-test-"));
});
afterEach(async () => {
  await rm(temp, { recursive: true, force: true, maxRetries: 3 });
});

function release(version: string, extra: Partial<RawRelease> = {}): RawRelease {
  return {
    version,
    publishedAt: "2026-11-08T08:00:00.000Z",
    notes: "",
    urgent: false,
    rollout: 100,
    minEnvironment: 1,
    packages: {
      "linux-x64": { url: `p-${version}.tgz`, size: 10, sha256: "a".repeat(64), signature: "c2ln" },
    },
    ...extra,
  };
}

describe("version", () => {
  it("reads and rewrites CMS_VERSION in the real version.ts", async () => {
    const source = await readFile(
      join(REPOSITORY, "packages", "core", "src", "version.ts"),
      "utf8",
    );
    const current = readDeclaredVersion(source);
    expect(await readVersion(REPOSITORY)).toBe(current);
    const rewritten = withDeclaredVersion(source, "9.8.7-beta.1");
    expect(readDeclaredVersion(rewritten)).toBe("9.8.7-beta.1");
    expect(rewritten.replace("9.8.7-beta.1", current)).toBe(source);
    expect(() => readDeclaredVersion("export const OTHER = 1;")).toThrow(ReleaseError);
  });

  it("accepts only a newer, strict, unpublished version", () => {
    expect(() => checkNewVersion("1.4.0", "1.3.2", ["1.3.2"])).not.toThrow();
    expect(() => checkNewVersion("1.5.0-beta.1", "1.4.0", [])).not.toThrow();
    for (const invalid of ["v1.4.0", "1.4", "1.4.0+build.1", " 1.4.0"]) {
      expect(() => checkNewVersion(invalid, "1.3.0", []), invalid).toThrow(/valide/);
    }
    expect(() => checkNewVersion("1.3.0", "1.3.0", [])).toThrow(/plus récente/);
    expect(() => checkNewVersion("1.3.0-beta.1", "1.3.0", [])).toThrow(/plus récente/);
    expect(() => checkNewVersion("1.4.0", "1.3.0", ["1.4.0"])).toThrow(/déjà publiée/);
  });
});

describe("manifest", () => {
  it("adds releases newest first, in a manifest the supervisor reads", () => {
    let manifest = addRelease(emptyManifest(), release("1.3.0"));
    manifest = addRelease(manifest, release("1.4.0-beta.1"));
    manifest = addRelease(manifest, release("1.3.1", { urgent: true, minFrom: "1.0.0" }));
    expect(manifest.releases.map((item) => item.version)).toEqual([
      "1.4.0-beta.1",
      "1.3.1",
      "1.3.0",
    ]);
    const text = serializeManifest(manifest);
    expect(parseManifestText(text)).toEqual(manifest);
    const parsed = parseManifest(JSON.parse(text));
    expect(parsed.releases[1]).toMatchObject({ version: "1.3.1", urgent: true, minFrom: "1.0.0" });
    expect(() => addRelease(manifest, release("1.3.0"))).toThrow(/figure déjà/);
  });

  it("changes the rollout and withdraws a version for good", () => {
    let manifest = addRelease(emptyManifest(), release("1.3.0", { rollout: 10 }));
    manifest = setRollout(manifest, "1.3.0", 50);
    expect(manifest.releases[0]?.rollout).toBe(50);
    expect(() => setRollout(manifest, "1.3.0", 101)).toThrow(/0 à 100/);
    expect(() => setRollout(manifest, "1.3.0", 2.5)).toThrow(/0 à 100/);
    expect(() => setRollout(manifest, "9.9.9", 50)).toThrow(/ne figure pas/);
    manifest = withdrawRelease(manifest, "1.3.0");
    expect(manifest.withdrawn).toEqual(["1.3.0"]);
    expect(knownVersions(manifest)).toEqual(["1.3.0"]);
    expect(() => withdrawRelease(manifest, "1.3.0")).toThrow(/déjà retirée/);
    expect(() => addRelease(manifest, release("1.3.0"))).toThrow(/figure déjà/);
  });

  it("refuses what the supervisor would refuse", () => {
    expect(() => addRelease(emptyManifest(), release("1.3.0", { rollout: 200 }))).toThrow(
      ReleaseError,
    );
    expect(() => parseManifestText("{")).toThrow(/JSON/);
    expect(() => parseManifestText('{"schema":2,"releases":[]}')).toThrow(/Manifeste/);
  });
});

describe("signing key", () => {
  it("creates an encrypted key outside the repository, then loads it with its passphrase", async () => {
    const file = join(temp, "keys", "release.pem");
    const publicKey = await createKeyFile(file, "une phrase de passe longue", REPOSITORY);
    const pem = await readFile(file, "utf8");
    expect(pem).toContain("BEGIN ENCRYPTED PRIVATE KEY");
    const key = await loadSigningKey(file, "une phrase de passe longue");
    expect(publicKeyOf(key)).toBe(publicKey);
    expect(releasePublicKey(publicKey)).toBeDefined();
    await expect(loadSigningKey(file, "une autre phrase longue")).rejects.toThrow(/déchiffrée/);
    await expect(loadSigningKey(join(temp, "absente.pem"), "x")).rejects.toThrow(/introuvable/);
    await expect(createKeyFile(file, "une phrase de passe longue", REPOSITORY)).rejects.toThrow(
      /existe déjà/,
    );
    expect(await readFile(file, "utf8")).toBe(pem);
  });

  it("refuses short passphrases and keys inside the repository", async () => {
    await expect(createKeyFile(join(temp, "k.pem"), "court", REPOSITORY)).rejects.toThrow(/12/);
    await expect(
      createKeyFile(join(REPOSITORY, "cle.pem"), "une phrase de passe longue", REPOSITORY),
    ).rejects.toThrow(/dans le dépôt/);
    expect(isInside(REPOSITORY, join(REPOSITORY, "a", "b.pem"))).toBe(true);
    expect(isInside(REPOSITORY, join(REPOSITORY, "..", "b.pem"))).toBe(false);
    expect(isInside(REPOSITORY, join(REPOSITORY, "..foo"))).toBe(true);
  });

  it("checks that the instances trust the key before anything is built", () => {
    const { privateKey } = generateKeyPairSync("ed25519");
    expect(() => checkTrusted(privateKey, [])).toThrow(/TRUSTED_RELEASE_KEYS/);
    expect(() => checkTrusted(privateKey, [publicKeyOf(privateKey)])).not.toThrow();
    expect(TRUSTED_RELEASE_KEYS.every((key) => releasePublicKey(key) !== undefined)).toBe(true);
  });
});

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(join(path, ".."), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

describe("prune", () => {
  it("keeps what the application reaches on the target platform, nothing else", async () => {
    const app = join(temp, "apps", "server");
    const modules = join(app, "node_modules");
    await writeJson(join(app, "package.json"), {
      name: "@sport-cms/server",
      dependencies: { lib: "1", "@sport-cms/core": "1", "better-sqlite3": "1" },
    });
    await writeJson(join(modules, "lib", "package.json"), {
      name: "lib",
      dependencies: { nested: "1" },
      optionalDependencies: {
        "@img/native-linux-x64": "1",
        "@img/native-linux-arm64": "1",
        "@img/native-musl": "1",
      },
      peerDependencies: { vitest: "1", react: "1" },
      peerDependenciesMeta: { vitest: { optional: true } },
    });
    await writeJson(join(modules, "lib", "node_modules", "nested", "package.json"), {
      name: "nested",
    });
    await writeJson(join(modules, "nested", "package.json"), { name: "nested" });
    await writeJson(join(modules, "react", "package.json"), { name: "react" });
    await writeJson(join(modules, "vitest", "package.json"), { name: "vitest" });
    await writeJson(join(modules, "@img", "native-linux-x64", "package.json"), {
      name: "x",
      os: ["linux"],
      cpu: ["x64"],
      libc: ["glibc"],
    });
    await writeJson(join(modules, "@img", "native-linux-arm64", "package.json"), {
      name: "a",
      os: ["linux"],
      cpu: ["arm64"],
    });
    await writeJson(join(modules, "@img", "native-musl", "package.json"), {
      name: "m",
      os: ["linux"],
      libc: ["musl"],
    });
    await writeJson(join(modules, "@other", "unused", "package.json"), { name: "@other/unused" });
    await writeJson(join(modules, "@sport-cms", "core", "package.json"), {
      name: "@sport-cms/core",
    });
    await writeFile(join(modules, "@sport-cms", "core", "tsconfig.json"), "{}");
    await mkdir(join(modules, "@sport-cms", "core", "src"));
    await mkdir(join(modules, "@sport-cms", "core", "dist"));
    await writeJson(join(modules, "better-sqlite3", "package.json"), { name: "better-sqlite3" });
    await mkdir(join(modules, "better-sqlite3", "deps"));
    for (const binary of ["linux-x64.node", "linux-arm64.node", "win32-x64.node"]) {
      await writeJson(join(modules, "better-sqlite3", "prebuilds", binary), {});
    }
    await mkdir(join(modules, ".bin"));
    await writeFile(join(modules, ".modules.yaml"), "");

    const result = await prune(app, parseTarget("linux-x64"));
    expect(result.removed).toBe(5);
    const tree = (await listTree(app)).filter(
      (path) => path.endsWith("package.json") || path.endsWith(".node"),
    );
    expect(tree).toEqual([
      "node_modules/@img/native-linux-x64/package.json",
      "node_modules/@sport-cms/core/package.json",
      "node_modules/better-sqlite3/package.json",
      "node_modules/better-sqlite3/prebuilds/linux-x64.node",
      "node_modules/lib/node_modules/nested/package.json",
      "node_modules/lib/package.json",
      "node_modules/react/package.json",
      "package.json",
    ]);
    expect(await listTree(join(modules, "@sport-cms", "core"))).toEqual(["dist/", "package.json"]);
    expect(await listTree(join(modules, "better-sqlite3"))).not.toContain("deps/");
  });

  it("fails when a required dependency is missing, or a platform is unknown", async () => {
    await writeJson(join(temp, "package.json"), { name: "app", dependencies: { absent: "1" } });
    await expect(prune(temp, parseTarget("linux-x64"))).rejects.toThrow(/absent/);
    expect(() => parseTarget("linux-ia32")).toThrow(/Plateforme inconnue/);
    expect(supportsTarget({ os: ["!win32"] }, parseTarget("win32-x64"))).toBe(false);
    expect(supportsTarget({ os: ["!win32"] }, parseTarget("linux-arm64"))).toBe(true);
  });
});

describe("test release, installed by the supervisor", () => {
  it("packs the same bytes every time, signs them, and the supervisor installs them", async () => {
    const app = join(temp, "app");
    await writeJson(join(app, "app.json"), { version: "1.4.0", main: "apps/server/dist/main.js" });
    await mkdir(join(app, "apps", "server", "dist"), { recursive: true });
    await writeFile(join(app, "apps", "server", "dist", "main.js"), "console.log('ok');\n");
    await writeJson(
      join(app, "apps", "server", "node_modules", "@scope", "lib", "package.json"),
      {},
    );
    // pnpm installs files as hard links to its store: archived as plain files.
    await link(
      join(app, "apps", "server", "dist", "main.js"),
      join(app, "apps", "server", "dist", "copy.js"),
    );

    const first = await packDirectory(app, join(temp, "first.tgz"));
    const second = await packDirectory(app, join(temp, "second.tgz"));
    expect(second.sha256).toBe(first.sha256);
    expect(second.size).toBe(first.size);

    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = addRelease(emptyManifest(), {
      ...release("1.4.0"),
      packages: {
        "linux-x64": {
          url: "sport-cms-1.4.0-linux-x64.tgz",
          size: first.size,
          sha256: first.sha256,
          signature: signPackage(privateKey, "1.4.0", "linux-x64", first.sha256),
        },
      },
    });
    const bytes = await readFile(first.file);
    const requested: string[] = [];
    const appsDirectory = join(temp, "data", "app");
    await mkdir(appsDirectory, { recursive: true });
    const stage = (keys: (typeof publicKey)[]) =>
      stageRelease({
        release: parseManifest(JSON.parse(serializeManifest(manifest))).releases[0] as never,
        platform: "linux-x64",
        manifestUrl: "https://example.test/releases/manifest.json",
        appsDirectory,
        trustedKeys: keys,
        fetch: (async (url: URL) => {
          requested.push(String(url));
          return new Response(bytes);
        }) as typeof fetch,
      });
    await expect(stage([generateKeyPairSync("ed25519").publicKey])).rejects.toThrow(/signature/);
    expect(requested).toEqual([]);
    const installed = await stage([publicKey]);
    expect(requested).toEqual(["https://example.test/releases/sport-cms-1.4.0-linux-x64.tgz"]);
    expect(await readFile(join(installed, "apps", "server", "dist", "copy.js"), "utf8")).toBe(
      "console.log('ok');\n",
    );
    expect(await listTree(installed)).toContain("apps/server/node_modules/@scope/lib/package.json");
  });

  it("is refused by the supervisor when it contains a link", async () => {
    const block = (header: Header) => {
      const bytes = Buffer.alloc(512);
      header.encode(bytes);
      return bytes;
    };
    const descriptor = Buffer.from(JSON.stringify({ version: "1.4.0", main: "main.js" }));
    const padded = Buffer.alloc(Math.ceil(descriptor.length / 512) * 512);
    descriptor.copy(padded);
    const archive = gzipSync(
      Buffer.concat([
        block(new Header({ path: "app.json", type: "File", size: descriptor.length, mode: 0o644 })),
        padded,
        block(
          new Header({
            path: "main.js",
            type: "SymbolicLink",
            linkpath: "../../../etc/passwd",
            mode: 0o777,
          }),
        ),
        Buffer.alloc(1024),
      ]),
    );
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const manifest = addRelease(emptyManifest(), {
      ...release("1.4.0"),
      packages: {
        "linux-x64": {
          url: "p.tgz",
          size: archive.length,
          sha256,
          signature: signPackage(privateKey, "1.4.0", "linux-x64", sha256),
        },
      },
    });
    const appsDirectory = join(temp, "data", "app");
    await mkdir(appsDirectory, { recursive: true });
    await expect(
      stageRelease({
        release: parseManifest(manifest).releases[0] as never,
        platform: "linux-x64",
        manifestUrl: "https://example.test/manifest.json",
        appsDirectory,
        trustedKeys: [publicKey],
        fetch: (async () => new Response(archive)) as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/liens ou des fichiers spéciaux/);
    expect(await listTree(appsDirectory)).toEqual([]);
  });

  it("refuses symbolic links in a package", async () => {
    await mkdir(join(temp, "app"));
    await writeFile(join(temp, "target.txt"), "");
    try {
      await symlink(join(temp, "target.txt"), join(temp, "app", "link.txt"));
    } catch {
      return; // Windows without the right to create symbolic links.
    }
    await expect(listTree(join(temp, "app"))).rejects.toThrow(/Lien symbolique refusé/);
  });
});

describe("git", () => {
  async function git(cwd: string, ...args: string[]) {
    return run("git", args, { cwd });
  }

  async function repositoryWithRemote(): Promise<{ origin: string; clone: string }> {
    const origin = join(temp, "origin.git");
    const clone = join(temp, "clone");
    await git(temp, "init", "--quiet", "--bare", "--initial-branch=main", origin);
    await git(temp, "clone", "--quiet", origin, clone);
    await git(clone, "config", "user.email", "test@example.test");
    await git(clone, "config", "user.name", "Test");
    await git(clone, "config", "commit.gpgsign", "false");
    await git(clone, "checkout", "--quiet", "-b", "main");
    await writeFile(join(clone, "README.md"), "club\n");
    await git(clone, "add", ".");
    await git(clone, "commit", "--quiet", "-m", "Départ");
    await git(clone, "push", "--quiet", "origin", "main");
    return { origin, clone };
  }

  it("publishes the manifest on gh-pages without touching the working tree", async () => {
    const { clone } = await repositoryWithRemote();
    const first = await readPagesManifest(clone);
    expect(first).toEqual({ manifest: emptyManifest(), parent: undefined });
    const commit = await writePagesManifest(
      clone,
      addRelease(first.manifest, release("1.3.0")),
      undefined,
      "Version 1.3.0",
    );
    const second = await readPagesManifest(clone);
    expect(second.parent).toBe(commit);
    expect(knownVersions(second.manifest)).toEqual(["1.3.0"]);
    await writePagesManifest(
      clone,
      setRollout(second.manifest, "1.3.0", 10),
      second.parent,
      "Déploiement",
    );
    expect((await readPagesManifest(clone)).manifest.releases[0]?.rollout).toBe(10);
    expect(await git(clone, "ls-tree", "--name-only", "origin/gh-pages")).toBe(
      ".nojekyll\nmanifest.json",
    );
    expect(await git(clone, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    expect(await git(clone, "status", "--porcelain")).toBe("");
    // Published from a stale read: refused, not forced.
    await expect(
      writePagesManifest(clone, second.manifest, second.parent, "Périmé"),
    ).rejects.toThrow(/n'a pas pu être publié/);
  }, 30_000);

  it("releases only a clean main identical to GitHub's", async () => {
    const { clone } = await repositoryWithRemote();
    const log = () => undefined;
    await expect(checkRepository(clone, log)).resolves.toBeUndefined();
    await writeFile(join(clone, "README.md"), "modifié\n");
    await expect(checkRepository(clone, log)).rejects.toThrow(/modifications/);
    await git(clone, "commit", "--quiet", "-am", "Local");
    await expect(checkRepository(clone, log)).rejects.toThrow(/identique à GitHub/);
    await git(clone, "checkout", "--quiet", "-b", "autre");
    await expect(checkRepository(clone, log)).rejects.toThrow(/depuis main/);
  }, 30_000);
});
