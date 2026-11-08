import { type KeyObject, randomInt } from "node:crypto";
import { copyFile, cp, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Writable } from "node:stream";
import {
  DEFAULT_UPDATE_SETTINGS,
  MAX_UPDATE_HISTORY,
  SUPERVISOR_STATE_FILE,
  type SupervisorState,
  supervisorStateSchema,
  UPDATE_REQUEST_FILE,
  UPDATE_SETTINGS_FILE,
  UPDATES_DIRECTORY,
  type UpdateRequest,
  type UpdateSettings,
  updateRequestSchema,
  updateSettingsSchema,
} from "@sport-cms/core";
import semver from "semver";
import { AppProcess, checkHealth } from "./app-process.js";
import { readJsonFile, writeJsonFile } from "./files.js";
import {
  InstallError,
  pruneVersions,
  readAppDescriptor,
  stageRelease,
  sweepLeftovers,
  versionDirectory,
} from "./install.js";
import { fetchManifest, ManifestError } from "./manifest.js";
import { SupervisorProxy } from "./proxy.js";
import { isInMaintenanceWindow, selectRelease } from "./select.js";

/** Version of the environment this supervisor belongs to (the Docker image, E14). */
export const ENVIRONMENT_VERSION = 1;

/** Directories and files of `DATA_DIR` the supervisor works in. */
export const APPS_DIRECTORY = "app";
export const BACKUPS_DIRECTORY = "backups";
/** Name of the instance's database in `DATA_DIR` (`databasePath` of `@sport-cms/db`). */
export const DATABASE_FILE = "database.sqlite";
/** Pre-update backups kept; the oldest go first. */
export const KEPT_PRE_UPDATE_BACKUPS = 3;

export const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const DEFAULT_HEALTH_TIMEOUT_MS = 60_000;
const MAX_RESTART_DELAY_MS = 60_000;

export interface SupervisorLogger {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
}

export interface SupervisorOptions {
  readonly dataDir: string;
  /** Port the application listens on, on the loopback. */
  readonly appPort: number;
  readonly manifestUrl: string;
  readonly trustedKeys: readonly KeyObject[];
  /** Environment of the application (its `PORT`, `HOST` and `TRUST_PROXY` are set here). */
  readonly appEnv: Readonly<Record<string, string | undefined>>;
  /** Version shipped with the environment (directory with its `app.json`), installed first. */
  readonly bundledApp?: string;
  readonly environment?: number;
  /** `<platform>-<arch>` of the packages (this machine's by default). */
  readonly platform?: string;
  readonly proxy?: SupervisorProxy;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
  readonly logger?: SupervisorLogger;
  /** Where the application's output goes (the supervisor's by default). */
  readonly appOutput?: Writable;
  readonly healthTimeoutMs?: number;
  readonly checkIntervalMs?: number;
}

type SwitchReason = "update" | "rollback";

/**
 * The supervisor (PLAN §6.8): runs the current version of the application behind its proxy,
 * checks the manifest, downloads and verifies the releases the club's settings allow, switches
 * to them in the maintenance window (backup, then the new version migrates and starts, then the
 * health check), and goes back to the previous version when the check fails. Everything it
 * decides is written to `DATA_DIR/updates/state.json` before it acts, so that a power cut in the
 * middle is finished or undone at the next start.
 *
 * Every operation runs one after the other (`#run`): a request from the back-office never
 * overlaps a scheduled check.
 */
export class Supervisor {
  readonly proxy: SupervisorProxy;
  readonly #options: SupervisorOptions;
  readonly #appsDirectory: string;
  readonly #updatesDirectory: string;
  readonly #platform: string;
  readonly #now: () => number;
  readonly #logger: SupervisorLogger;
  #state: SupervisorState | undefined;
  #app: AppProcess | undefined;
  #queue: Promise<unknown> = Promise.resolve();
  #restartDelay = 1000;
  #restartTimer: NodeJS.Timeout | undefined;
  #stopped = false;

  constructor(options: SupervisorOptions) {
    this.#options = options;
    this.proxy = options.proxy ?? new SupervisorProxy();
    this.#appsDirectory = join(options.dataDir, APPS_DIRECTORY);
    this.#updatesDirectory = join(options.dataDir, UPDATES_DIRECTORY);
    this.#platform = options.platform ?? `${process.platform}-${process.arch}`;
    this.#now = options.now ?? Date.now;
    this.#logger = options.logger ?? console;
  }

  /** What the supervisor knows (a copy). */
  get state(): SupervisorState {
    return structuredClone(this.#requireState());
  }

  /** Version whose process runs (and passed its health check), if any. */
  get running(): string | undefined {
    return this.proxy.target === undefined ? undefined : this.#app?.version;
  }

  /**
   * Starts the supervisor: state read back, leftovers of an interrupted download swept, an
   * update interrupted by a power cut finished or undone, the version shipped with the
   * environment installed when newer, then the current version started.
   */
  start(): Promise<void> {
    return this.#run(async () => {
      await mkdir(this.#appsDirectory, { recursive: true });
      await mkdir(this.#updatesDirectory, { recursive: true });
      this.#state = await this.#loadState();
      this.#state.environment = this.#options.environment ?? ENVIRONMENT_VERSION;
      await this.#saveState();
      await sweepLeftovers(this.#appsDirectory);

      const pending = this.#state.pending;
      if (pending !== null) {
        this.#logger.warn(
          `Superviseur : mise à jour vers ${pending.to} interrompue, reprise au démarrage.`,
        );
        if (pending.phase === "starting") {
          await this.#finishSwitch();
          return;
        }
        // Stopped before the new version ran: nothing changed, the old one starts again.
        this.#state.pending = null;
        await this.#saveState();
      }

      const bundled = await this.#installBundled();
      const state = this.#requireState();
      if (bundled !== undefined && state.current !== null && bundled !== state.current) {
        await this.#switch(bundled, "update");
        return;
      }
      if (bundled !== undefined && state.current === null) {
        state.current = bundled;
        await this.#saveState();
      }
      await this.#startCurrent();
    });
  }

  /**
   * One round of the loop: the back-office's request if there is one, the manifest when the
   * last check is old enough, then the switch when an update is ready and allowed now.
   */
  tick(): Promise<void> {
    return this.#run(async () => {
      if (this.#stopped) {
        return;
      }
      const request = await this.#takeRequest();
      if (request !== undefined) {
        await this.#handleRequest(request);
        return;
      }
      const state = this.#requireState();
      const interval = this.#options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS;
      if (state.lastCheckAt === null || this.#now() - state.lastCheckAt >= interval) {
        await this.#check(false);
      }
      if (await this.#mayApplyNow()) {
        const available = this.#requireState().available;
        if (available !== null) {
          await this.#switch(available.version, "update");
        }
      }
    });
  }

  /** Checks the manifest now and downloads what it allows (no switch). */
  check(): Promise<void> {
    return this.#run(() => this.#check(false));
  }

  /** Stops the application (and every timer). */
  stop(): Promise<void> {
    this.#stopped = true;
    clearTimeout(this.#restartTimer);
    return this.#run(async () => {
      this.proxy.target = undefined;
      await this.#app?.stop();
      this.#app = undefined;
    });
  }

  #run<T>(task: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(task);
    this.#queue = result.catch((error: unknown) => {
      this.#logger.error("Superviseur : opération en échec", error);
    });
    return result;
  }

  #requireState(): SupervisorState {
    if (this.#state === undefined) {
      throw new Error("Supervisor not started");
    }
    return this.#state;
  }

  async #loadState(): Promise<SupervisorState> {
    const path = join(this.#updatesDirectory, SUPERVISOR_STATE_FILE);
    const raw = await readJsonFile(path).catch(() => undefined);
    const parsed = supervisorStateSchema.safeParse(raw);
    if (parsed.success) {
      return parsed.data;
    }
    if (raw !== undefined) {
      this.#logger.error(`Superviseur : ${path} est illisible, il repart d'un état vierge.`);
    }
    return {
      current: null,
      previous: null,
      environment: this.#options.environment ?? ENVIRONMENT_VERSION,
      bucket: randomInt(100),
      failed: [],
      available: null,
      environmentOutdated: null,
      pending: null,
      history: [],
      lastCheckAt: null,
      lastError: null,
    };
  }

  async #saveState(): Promise<void> {
    const state = this.#requireState();
    state.history = state.history.slice(0, MAX_UPDATE_HISTORY);
    await writeJsonFile(join(this.#updatesDirectory, SUPERVISOR_STATE_FILE), state);
  }

  /** The club's settings; the defaults when the file is missing or invalid. */
  async #readSettings(): Promise<UpdateSettings> {
    const path = join(this.#updatesDirectory, UPDATE_SETTINGS_FILE);
    const raw = await readJsonFile(path).catch(() => null);
    if (raw === undefined) {
      return DEFAULT_UPDATE_SETTINGS;
    }
    const parsed = updateSettingsSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.error(`Superviseur : ${path} est invalide, réglages par défaut appliqués.`);
      return DEFAULT_UPDATE_SETTINGS;
    }
    return parsed.data;
  }

  /** The back-office's request, removed once read (handled once, even if it fails). */
  async #takeRequest(): Promise<UpdateRequest | undefined> {
    const path = join(this.#updatesDirectory, UPDATE_REQUEST_FILE);
    const raw = await readJsonFile(path).catch(() => null);
    if (raw === undefined) {
      return undefined;
    }
    await rm(path, { force: true });
    const parsed = updateRequestSchema.safeParse(raw);
    if (!parsed.success) {
      this.#logger.error(`Superviseur : demande illisible ignorée (${path}).`);
      return undefined;
    }
    return parsed.data;
  }

  async #handleRequest(request: UpdateRequest): Promise<void> {
    const state = this.#requireState();
    if (request.action === "rollback") {
      if (state.previous === null || state.current === null) {
        this.#logger.warn("Superviseur : aucune version précédente pour un retour arrière.");
        return;
      }
      this.#logger.info(
        `Superviseur : retour à la version ${state.previous} demandé depuis le back-office.`,
      );
      await this.#switch(state.previous, "rollback");
      return;
    }
    this.#logger.info("Superviseur : mise à jour demandée depuis le back-office.");
    await this.#check(true);
    const available = this.#requireState().available;
    if (available?.staged === true && available.version !== state.current) {
      await this.#switch(available.version, "update");
    }
  }

  async #check(manual: boolean): Promise<void> {
    const state = this.#requireState();
    const settings = await this.#readSettings();
    state.lastCheckAt = this.#now();
    if (this.#options.trustedKeys.length === 0) {
      state.lastError =
        "Aucune clé de publication n'est configurée : les mises à jour automatiques sont désactivées.";
      await this.#saveState();
      return;
    }
    let manifest: Awaited<ReturnType<typeof fetchManifest>>;
    try {
      manifest = await fetchManifest({
        url: this.#options.manifestUrl,
        ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
      });
    } catch (error) {
      state.lastError =
        error instanceof ManifestError ? error.message : "Le manifeste des versions est illisible.";
      this.#logger.error(`Superviseur : ${state.lastError}`);
      await this.#saveState();
      return;
    }
    const selection = selectRelease({
      manifest,
      current: state.current,
      settings,
      environment: state.environment,
      platform: this.#platform,
      bucket: state.bucket,
      failed: state.failed,
      now: this.#now(),
      manual,
    });
    state.environmentOutdated = selection.environmentOutdated;
    state.lastError = null;
    const { release } = selection;
    if (release === null) {
      state.available = null;
      await this.#saveState();
      return;
    }
    const alreadyStaged = state.available?.version === release.version && state.available.staged;
    state.available = {
      version: release.version,
      urgent: release.urgent,
      notes: release.notes,
      publishedAt: release.publishedAt,
      staged: alreadyStaged,
    };
    await this.#saveState();
    try {
      await stageRelease({
        release,
        platform: this.#platform,
        manifestUrl: this.#options.manifestUrl,
        appsDirectory: this.#appsDirectory,
        trustedKeys: this.#options.trustedKeys,
        ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
      });
      state.available.staged = true;
      if (!alreadyStaged) {
        this.#logger.info(`Superviseur : version ${release.version} téléchargée et vérifiée.`);
      }
    } catch (error) {
      state.available.staged = false;
      state.lastError =
        error instanceof InstallError
          ? error.message
          : `Le téléchargement de la version ${release.version} a échoué.`;
      if (error instanceof InstallError) {
        this.#logger.error(`Superviseur : ${state.lastError}`);
      } else {
        this.#logger.error(`Superviseur : ${state.lastError}`, error);
      }
    }
    await this.#saveState();
  }

  /**
   * An update ready to switch to may go now: urgent fixes always; otherwise not with the manual
   * policy, nor during a pause, nor a new major with automatic-minor (the settings may have
   * changed since the download), and only in the maintenance window.
   */
  async #mayApplyNow(): Promise<boolean> {
    const state = this.#requireState();
    const available = state.available;
    if (available === null || !available.staged || available.version === state.current) {
      return false;
    }
    if (available.urgent) {
      return true;
    }
    const settings = await this.#readSettings();
    const now = this.#now();
    if (settings.policy === "manual") {
      return false;
    }
    if (settings.pausedUntil !== null && settings.pausedUntil > now) {
      return false;
    }
    if (
      settings.policy === "automatic-minor" &&
      state.current !== null &&
      semver.major(available.version) > semver.major(state.current)
    ) {
      return false;
    }
    return isInMaintenanceWindow(new Date(now), settings.window);
  }

  /** Copies the version shipped with the environment in place; its version when newer. */
  async #installBundled(): Promise<string | undefined> {
    const source = this.#options.bundledApp;
    if (source === undefined) {
      return undefined;
    }
    const raw = await readJsonFile(join(source, "app.json")).catch(() => undefined);
    const version = (raw as { version?: unknown } | undefined)?.version;
    if (typeof version !== "string" || semver.valid(version) !== version) {
      this.#logger.error(`Superviseur : la version fournie (${source}) n'a pas d'app.json valide.`);
      return undefined;
    }
    const state = this.#requireState();
    if (
      state.failed.includes(version) ||
      (state.current !== null && !semver.gt(version, state.current))
    ) {
      return undefined;
    }
    const target = versionDirectory(this.#appsDirectory, version);
    if ((await stat(target).catch(() => undefined)) === undefined) {
      const staging = join(this.#appsDirectory, `.staging-${version}-bundled`);
      await rm(staging, { recursive: true, force: true });
      await cp(source, staging, { recursive: true });
      await rename(staging, target);
    }
    await readAppDescriptor(target, version);
    return version;
  }

  /** Starts the current version; when it does not pass, goes back to the previous one. */
  async #startCurrent(): Promise<void> {
    const state = this.#requireState();
    if (state.current === null) {
      this.#logger.error(
        "Superviseur : aucune version de l'application n'est installée ; le site reste indisponible.",
      );
      return;
    }
    const problem = await this.#launch(state.current);
    if (problem === null) {
      return;
    }
    this.#logger.error(`Superviseur : la version ${state.current} ne démarre pas : ${problem}.`);
    if (state.previous !== null) {
      await this.#switch(state.previous, "rollback", problem);
      return;
    }
    this.#scheduleRestart();
  }

  /**
   * Starts a version and waits for its health check; on success the proxy sends it the traffic.
   * Returns `null`, or why it failed (the process is then stopped).
   */
  async #launch(version: string): Promise<string | null> {
    clearTimeout(this.#restartTimer);
    let entry: string;
    const directory = versionDirectory(this.#appsDirectory, version);
    try {
      entry = (await readAppDescriptor(directory, version)).entry;
    } catch (error) {
      return error instanceof InstallError ? error.message : String(error);
    }
    const { appPort } = this.#options;
    const app = new AppProcess({
      version,
      directory,
      entry,
      env: {
        ...this.#options.appEnv,
        DATA_DIR: this.#options.dataDir,
        PORT: String(appPort),
        // Only the supervisor reaches it, and the supervisor writes `x-forwarded-for`.
        HOST: "127.0.0.1",
        TRUST_PROXY: "true",
      },
      ...(this.#options.appOutput === undefined ? {} : { output: this.#options.appOutput }),
      onUnexpectedExit: (code) => {
        if (this.#app !== app || this.#stopped) {
          return;
        }
        this.#logger.error(
          `Superviseur : la version ${version} s'est arrêtée (code ${code ?? "signal"}), redémarrage.`,
        );
        this.proxy.target = undefined;
        this.#app = undefined;
        this.#scheduleRestart();
      },
    });
    this.#app = app;
    const problem = await checkHealth({
      port: appPort,
      version,
      process: app,
      timeoutMs: this.#options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS,
      ...(this.#options.fetch === undefined ? {} : { fetch: this.#options.fetch }),
    });
    if (problem !== null) {
      this.#app = undefined;
      await app.stop();
      return problem;
    }
    this.proxy.target = appPort;
    this.#restartDelay = 1000;
    return null;
  }

  /** Restarts the current version later, waiting longer each time (1 s, 2 s… up to 1 min). */
  #scheduleRestart(): void {
    if (this.#stopped) {
      return;
    }
    clearTimeout(this.#restartTimer);
    const delay = this.#restartDelay;
    this.#restartDelay = Math.min(delay * 2, MAX_RESTART_DELAY_MS);
    this.#restartTimer = setTimeout(() => {
      void this.#run(async () => {
        if (this.#stopped || this.#app !== undefined) {
          return;
        }
        const current = this.#requireState().current;
        if (current === null) {
          return;
        }
        const problem = await this.#launch(current);
        if (problem !== null) {
          this.#logger.error(`Superviseur : la version ${current} ne redémarre pas : ${problem}.`);
          this.#scheduleRestart();
        }
      });
    }, delay);
    this.#restartTimer.unref();
  }

  /**
   * Switches to `to`: written down first, then the running version stopped (the proxy serves the
   * kept pages meanwhile), the database backed up, and the new version started and checked.
   */
  async #switch(to: string, reason: SwitchReason, cause?: string): Promise<void> {
    const state = this.#requireState();
    const from = state.current;
    state.pending = { from, to, phase: "stopping", reason, startedAt: this.#now() };
    await this.#saveState();
    this.proxy.target = undefined;
    await this.#app?.stop();
    this.#app = undefined;
    if (reason === "update" && from !== null) {
      await this.#backup(from, to);
    }
    state.pending = { ...state.pending, phase: "starting" };
    await this.#saveState();
    await this.#finishSwitch(cause);
  }

  /** Second half of a switch: the new version started; kept, or the old one back. */
  async #finishSwitch(cause?: string): Promise<void> {
    const state = this.#requireState();
    const pending = state.pending;
    if (pending === null) {
      return;
    }
    const { from, to, reason } = pending;
    const notes = state.available?.version === to ? state.available.notes : undefined;
    const problem = await this.#launch(to);
    if (problem === null) {
      if (reason === "rollback" && from !== null && !state.failed.includes(from)) {
        // Left by the club (or failing at start): never installed again on its own.
        state.failed.push(from);
      }
      state.current = to;
      state.previous = reason === "update" ? from : null;
      state.pending = null;
      if (state.available?.version === to || reason === "rollback") {
        state.available = null;
      }
      state.history.unshift({
        from,
        to,
        at: this.#now(),
        outcome: reason === "update" ? "installed" : "reverted",
        ...(cause === undefined ? {} : { reason: cause }),
        ...(notes === undefined || notes === "" ? {} : { notes }),
      });
      await this.#saveState();
      await this.#prune();
      this.#logger.info(
        reason === "update"
          ? `Superviseur : version ${to} installée${from === null ? "" : ` (depuis ${from})`}.`
          : `Superviseur : retour à la version ${to} effectué.`,
      );
      return;
    }

    this.#logger.error(
      `Superviseur : la version ${to} a échoué au contrôle de santé : ${problem}.`,
    );
    if (reason === "update" && !state.failed.includes(to)) {
      state.failed.push(to);
    }
    if (state.available?.version === to) {
      state.available = null;
    }
    state.pending = null;
    state.history.unshift({ from, to, at: this.#now(), outcome: "rolled_back", reason: problem });
    await this.#saveState();
    if (from === null) {
      this.#scheduleRestart();
      return;
    }
    const back = await this.#launch(from);
    if (back === null) {
      this.#logger.info(`Superviseur : la version ${from} tourne de nouveau.`);
    } else {
      this.#logger.error(`Superviseur : la version ${from} ne redémarre pas non plus : ${back}.`);
      this.#scheduleRestart();
    }
    await this.#prune();
  }

  /** Removes the installed versions no longer needed: all but current, previous and available. */
  async #prune(): Promise<void> {
    const { current, previous, available } = this.#requireState();
    const keep = [current, previous, available?.version].filter(
      (version): version is string => typeof version === "string",
    );
    await pruneVersions(this.#appsDirectory, new Set(keep));
  }

  /**
   * Copy of the database taken while no version runs (so the files are consistent), before the
   * new version migrates it. Migrations are expand/contract, so going back never needs it: it is
   * there for the worst case. The oldest copies are removed.
   */
  async #backup(from: string, to: string): Promise<void> {
    const database = join(this.#options.dataDir, DATABASE_FILE);
    if ((await stat(database).catch(() => undefined)) === undefined) {
      return;
    }
    const root = join(this.#options.dataDir, BACKUPS_DIRECTORY, "pre-update");
    const stamp = new Date(this.#now()).toISOString().replaceAll(":", "-");
    const directory = join(root, `${stamp}-${from}-to-${to}`);
    await mkdir(directory, { recursive: true });
    for (const suffix of ["", "-wal"]) {
      const file = `${database}${suffix}`;
      if ((await stat(file).catch(() => undefined)) !== undefined) {
        await copyFile(file, join(directory, `${DATABASE_FILE}${suffix}`));
      }
    }
    const kept = (await readdir(root)).sort().reverse().slice(KEPT_PRE_UPDATE_BACKUPS);
    await Promise.all(kept.map((name) => rm(join(root, name), { recursive: true, force: true })));
  }
}
