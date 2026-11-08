import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ReleaseError, run } from "./exec.js";
import { prune, type Target } from "./prune.js";

/**
 * The application directory of one platform, as the supervisor installs it in
 * `DATA_DIR/app/<version>/`:
 *
 * ```
 * app.json                 { "version": "1.4.0", "main": "apps/server/dist/main.js" }
 * apps/server/package.json
 * apps/server/dist/        the server, compiled
 * apps/server/node_modules production dependencies, workspace packages copied (no links)
 * apps/admin/dist/         the back-office build, where the server looks for it
 * ```
 *
 * The dependencies come from `pnpm deploy` with the lockfile (injected workspace packages, flat
 * `node_modules`), for the target platform: the native binaries of another architecture
 * (sharp's `@img/sharp-linux-arm64`…) are prebuilt packages, nothing is compiled.
 */

export const APP_ENTRY = "apps/server/dist/main.js";

export interface AssembleOptions {
  /** Root of a checkout already installed and built (`pnpm build`). */
  readonly source: string;
  readonly target: Target;
  readonly version: string;
  /** Where the application directory is created; must not exist. */
  readonly directory: string;
  readonly inherit?: boolean;
}

async function exists(path: string): Promise<boolean> {
  return (await stat(path).catch(() => undefined)) !== undefined;
}

export async function assembleApp(options: AssembleOptions): Promise<void> {
  const { source, target, version, directory } = options;
  if (await exists(directory)) {
    throw new ReleaseError(`Le dossier ${directory} existe déjà.`);
  }
  for (const built of [
    join(source, APP_ENTRY),
    join(source, "apps", "admin", "dist", "index.html"),
  ]) {
    if (!(await exists(built))) {
      throw new ReleaseError(`Build absent : ${built} (lancez « pnpm build »).`);
    }
  }
  const server = join(directory, "apps", "server");
  await mkdir(join(directory, "apps"), { recursive: true });
  await run(
    "pnpm",
    [
      "--filter",
      "@sport-cms/server",
      "deploy",
      "--prod",
      "--frozen-lockfile",
      "--config.inject-workspace-packages=true",
      "--config.node-linker=hoisted",
      `--os=${target.os}`,
      `--cpu=${target.cpu}`,
      ...(target.libc === undefined ? [] : [`--libc=${target.libc}`]),
      server,
    ],
    { cwd: source, inherit: options.inherit },
  );
  for (const entry of await readdir(server)) {
    if (!["package.json", "dist", "node_modules"].includes(entry)) {
      await rm(join(server, entry), { recursive: true, force: true });
    }
  }
  await prune(server, target);
  await cp(join(source, "apps", "admin", "dist"), join(directory, "apps", "admin", "dist"), {
    recursive: true,
  });
  await writeFile(
    join(directory, "app.json"),
    `${JSON.stringify({ version, main: APP_ENTRY }, null, 2)}\n`,
  );
}
