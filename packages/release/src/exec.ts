import { spawn } from "node:child_process";

/** A step of the release failed; the message, in French, is shown to the maintainer. */
export class ReleaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseError";
  }
}

export interface RunOptions {
  readonly cwd: string;
  /** Output shown to the maintainer as it comes (long steps: install, checks, build). */
  readonly inherit?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Written to the command's standard input. */
  readonly input?: string;
}

/**
 * Runs a command without a shell (arguments are never interpreted). On Windows, `pnpm` is a
 * `.cmd` script, which only a shell starts: it is started through Node and pnpm's own entry
 * point instead (`npm_execpath`, set when this script runs under pnpm).
 *
 * @returns its standard output, trimmed.
 * @throws {ReleaseError} when it exits with a non-zero code.
 */
export function run(
  command: string,
  args: readonly string[],
  options: RunOptions,
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Inside the executor: a refusal rejects the promise, never throws synchronously.
    const [file, fileArgs] = resolveCommand(command, args);
    const child = spawn(file, fileArgs, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: [
        options.input === undefined ? "ignore" : "pipe",
        options.inherit ? "inherit" : "pipe",
        options.inherit ? "inherit" : "pipe",
      ],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
    child.once("error", (error) => {
      reject(new ReleaseError(`Impossible de lancer ${command} : ${error.message}`));
    });
    child.once("close", (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }
      const detail = stderr.trim() || stdout.trim();
      reject(
        new ReleaseError(
          `La commande « ${[command, ...args].join(" ")} » a échoué (code ${code})${detail ? ` :\n${detail}` : "."}`,
        ),
      );
    });
  });
}

function resolveCommand(command: string, args: readonly string[]): [string, string[]] {
  const pnpmEntry = process.env.npm_execpath;
  if (command === "pnpm" && pnpmEntry !== undefined && /pnpm(\.c?js)?$/i.test(pnpmEntry)) {
    return [process.execPath, [pnpmEntry, ...args]];
  }
  if (command === "pnpm" && process.platform === "win32") {
    throw new ReleaseError(
      "Lancez ce script par « pnpm release » (pnpm introuvable sous Windows).",
    );
  }
  return [command, [...args]];
}
