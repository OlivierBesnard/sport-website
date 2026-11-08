import { type ChildProcess, spawn } from "node:child_process";
import type { Writable } from "node:stream";

/** One version of the application, run as a child process of the supervisor. */
export interface AppProcessOptions {
  readonly version: string;
  /** Directory of the version (its working directory). */
  readonly directory: string;
  /** Absolute path of its entry point. */
  readonly entry: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Where its output goes (the supervisor's own by default). */
  readonly output?: Writable;
  /** Told when the process ends without having been asked to. */
  readonly onUnexpectedExit?: (code: number | null, signal: NodeJS.Signals | null) => void;
}

export class AppProcess {
  readonly version: string;
  readonly #child: ChildProcess;
  readonly #exited: Promise<void>;
  #exitCode: number | null | undefined;
  #stopping = false;

  constructor(options: AppProcessOptions) {
    this.version = options.version;
    const output = options.output ?? process.stdout;
    this.#child = spawn(process.execPath, ["--enable-source-maps", options.entry], {
      cwd: options.directory,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    this.#child.stdout?.pipe(output, { end: false });
    this.#child.stderr?.pipe(output, { end: false });
    this.#exited = new Promise((resolve) => {
      this.#child.once("exit", (code, signal) => {
        this.#exitCode = code;
        if (!this.#stopping) {
          options.onUnexpectedExit?.(code, signal);
        }
        resolve();
      });
      // A process that cannot even start (missing Node binary…) never emits `exit`.
      this.#child.once("error", () => {
        if (this.#exitCode === undefined) {
          this.#exitCode = null;
          resolve();
        }
      });
    });
  }

  /** `undefined` while it runs; its exit code (or `null` after a signal) once it ended. */
  get exitCode(): number | null | undefined {
    return this.#exitCode;
  }

  /** Asks it to stop (SIGTERM: it closes its database), then kills it after `timeoutMs`. */
  async stop(timeoutMs = 15_000): Promise<void> {
    this.#stopping = true;
    if (this.#exitCode !== undefined) {
      return;
    }
    this.#child.kill("SIGTERM");
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), timeoutMs);
    });
    const result = await Promise.race([this.#exited, timedOut]);
    clearTimeout(timer);
    if (result === "timeout") {
      this.#child.kill("SIGKILL");
      await this.#exited;
    }
  }
}

export interface HealthCheckOptions {
  readonly port: number;
  /** Version expected to answer: an older process still on the port must not pass. */
  readonly version: string;
  readonly timeoutMs: number;
  readonly process: AppProcess;
  readonly fetch?: typeof fetch;
  readonly intervalMs?: number;
}

/**
 * Health check of a version just started (PLAN §6.8): `/health` answers 200 with this version
 * and its background tasks running, the home page answers without a server error, and so does
 * the back-office (200: its build is there). Retried until `timeoutMs`, since the application
 * migrates its database before it listens.
 *
 * @returns `null` when healthy, otherwise why not, in French.
 */
export async function checkHealth(options: HealthCheckOptions): Promise<string | null> {
  const { port, version, timeoutMs, process: app, fetch: fetchImpl = fetch } = options;
  const deadline = Date.now() + timeoutMs;
  const base = `http://127.0.0.1:${port}`;
  let reason = `l'application ne répond pas après ${Math.round(timeoutMs / 1000)} s`;
  while (Date.now() < deadline) {
    if (app.exitCode !== undefined) {
      return `l'application s'est arrêtée au démarrage (code ${app.exitCode ?? "signal"})`;
    }
    const problem = await probe(base, version, fetchImpl);
    if (problem === null) {
      return null;
    }
    if (problem.final) {
      return problem.reason ?? reason;
    }
    reason = problem.reason ?? reason;
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 500));
  }
  return reason;
}

/** What one probe found; `reason` absent while nothing answers yet. */
interface Problem {
  readonly reason: string | undefined;
  /** Retrying cannot change it. */
  readonly final: boolean;
}

async function probe(
  base: string,
  version: string,
  fetchImpl: typeof fetch,
): Promise<Problem | null> {
  const get = (path: string) =>
    fetchImpl(`${base}${path}`, { redirect: "manual", signal: AbortSignal.timeout(10_000) });
  let health: Response;
  try {
    health = await get("/health");
  } catch {
    return { reason: undefined, final: false };
  }
  if (health.status !== 200) {
    return { reason: `le contrôle de santé répond ${health.status}`, final: false };
  }
  const body = (await health.json().catch(() => ({}))) as Record<string, unknown>;
  if (body.version !== version) {
    // Another version answers: waiting longer would not change it.
    return {
      reason: `la version ${version} était attendue, ${String(body.version)} a répondu`,
      final: true,
    };
  }
  if (body.background !== "running") {
    return { reason: "les tâches de fond ne tournent pas", final: false };
  }
  try {
    const home = await get("/");
    await home.body?.cancel();
    if (home.status >= 500) {
      return { reason: `la page d'accueil répond ${home.status}`, final: false };
    }
    const admin = await get("/admin/");
    await admin.body?.cancel();
    if (admin.status !== 200) {
      return { reason: `le back-office répond ${admin.status}`, final: false };
    }
  } catch {
    return { reason: undefined, final: false };
  }
  return null;
}
