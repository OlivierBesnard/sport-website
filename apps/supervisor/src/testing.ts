import { createHash, generateKeyPairSync, type KeyObject } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create } from "tar";
import { signRelease } from "./signature.js";

/** Test helpers: fake versions of the application, and a local release server. */

export function generateReleaseKeys(): { privateKey: KeyObject; publicKey: KeyObject } {
  return generateKeyPairSync("ed25519");
}

export const PLATFORM = `${process.platform}-${process.arch}`;

/** A port free right now on the loopback. */
export async function freePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise((resolve) => server.close(resolve));
  if (address === null || typeof address === "string") {
    throw new Error("No port");
  }
  return address.port;
}

export interface FakeAppOptions {
  readonly version: string;
  /** Its `/health` answers 503: the health check fails. */
  readonly broken?: boolean;
}

/**
 * Script of a fake application: answers `/health` like the real one, and every other path with
 * its version and the `x-forwarded-for` it received. Each start is appended to
 * `DATA_DIR/starts.log`.
 */
function fakeAppScript({ version, broken = false }: FakeAppOptions): string {
  return `import { appendFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
const VERSION = ${JSON.stringify(version)};
const BROKEN = ${broken};
appendFileSync(join(process.env.DATA_DIR, "starts.log"), VERSION + "\\n");
const server = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(BROKEN ? 503 : 200, { "content-type": "application/json" });
    response.end(JSON.stringify({ status: BROKEN ? "unavailable" : "ok", version: VERSION, background: "running" }));
    return;
  }
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" });
  response.end("<h1>Version " + VERSION + "</h1><p>client " + request.headers["x-forwarded-for"] + "</p>");
});
server.listen(Number(process.env.PORT), process.env.HOST);
process.on("SIGTERM", () => server.close(() => process.exit(0)));
`;
}

/** Writes a fake application in `directory` (`app.json` + `main.mjs`). */
export async function writeFakeApp(directory: string, options: FakeAppOptions): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "app.json"),
    JSON.stringify({ version: options.version, main: "main.mjs" }),
  );
  await writeFile(join(directory, "main.mjs"), fakeAppScript(options));
}

export interface FakePackage {
  readonly version: string;
  readonly bytes: Buffer;
  readonly sha256: string;
}

/** A fake version packaged like a release (`.tgz` with `app.json` at its root). */
export async function buildFakePackage(options: FakeAppOptions): Promise<FakePackage> {
  const directory = await mkdtemp(join(tmpdir(), "sport-cms-package-"));
  try {
    const content = join(directory, "content");
    await writeFakeApp(content, options);
    const file = join(directory, "package.tgz");
    await create({ gzip: true, cwd: content, file, portable: true }, ["app.json", "main.mjs"]);
    const bytes = await readFile(file);
    return {
      version: options.version,
      bytes,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export interface ManifestRelease {
  readonly package: FakePackage;
  /** Key that signs it. */
  readonly privateKey: KeyObject;
  readonly urgent?: boolean;
  readonly rollout?: number;
  readonly minEnvironment?: number;
  /** Bytes served instead of the package's own (checksum mismatch). */
  readonly servedBytes?: Buffer;
}

/** Local release server: `/manifest.json` and `/packages/<version>.tgz`. */
export class ReleaseServer {
  readonly #server: Server;
  #releases: readonly ManifestRelease[] = [];
  port = 0;

  constructor() {
    this.#server = createServer((request, response) => {
      if (request.url === "/manifest.json") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(this.manifest()));
        return;
      }
      const match = /^\/packages\/(.+)\.tgz$/.exec(request.url ?? "");
      const release = this.#releases.find((item) => item.package.version === match?.[1]);
      if (release === undefined) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, { "content-type": "application/gzip" });
      response.end(release.servedBytes ?? release.package.bytes);
    });
  }

  get manifestUrl(): string {
    return `http://127.0.0.1:${this.port}/manifest.json`;
  }

  publish(releases: readonly ManifestRelease[]): void {
    this.#releases = releases;
  }

  manifest(): unknown {
    return {
      schema: 1,
      releases: this.#releases.map((release) => ({
        version: release.package.version,
        publishedAt: "2026-11-01T20:00:00Z",
        notes: `Notes de la version ${release.package.version}`,
        urgent: release.urgent ?? false,
        rollout: release.rollout ?? 100,
        minEnvironment: release.minEnvironment ?? 1,
        packages: {
          [PLATFORM]: {
            url: `packages/${release.package.version}.tgz`,
            size: release.package.bytes.length,
            sha256: release.package.sha256,
            signature: signRelease(
              release.privateKey,
              release.package.version,
              PLATFORM,
              release.package.sha256,
            ),
          },
        },
      })),
      withdrawn: [],
    };
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve) => this.#server.listen(0, "127.0.0.1", resolve));
    const address = this.#server.address();
    if (address !== null && typeof address !== "string") {
      this.port = address.port;
    }
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.#server.close(resolve));
  }
}
