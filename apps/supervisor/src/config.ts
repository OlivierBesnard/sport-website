import type { KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { releasePublicKey, TRUSTED_RELEASE_KEYS } from "./signature.js";

/** Address of the manifest the releases script publishes (GitHub Pages, E13). */
export const DEFAULT_MANIFEST_URL = "https://olivierbesnard.github.io/sport-website/manifest.json";

/** Variables read by the supervisor only; every other one is passed on to the application. */
const SUPERVISOR_VARIABLES = new Set([
  "APP_PORT",
  "UPDATE_MANIFEST_URL",
  "UPDATE_PUBLIC_KEY",
  "BUNDLED_APP",
  "BEHIND_PROXY",
]);

export interface SupervisorConfig {
  readonly dataDir: string;
  /** Public port, the one visitors (or Caddy) reach. */
  readonly port: number;
  /** Port of the application, on the loopback only. */
  readonly appPort: number;
  readonly manifestUrl: string;
  readonly trustedKeys: readonly KeyObject[];
  readonly bundledApp: string | undefined;
  readonly behindProxy: boolean;
  /** Environment given to the application. */
  readonly appEnv: Readonly<Record<string, string | undefined>>;
}

/** Thrown with every invalid variable, in French. */
export class SupervisorConfigError extends Error {
  constructor(problems: readonly string[]) {
    super(`Configuration du superviseur invalide :\n${problems.map((p) => `- ${p}`).join("\n")}`);
    this.name = "SupervisorConfigError";
  }
}

function parsePort(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined || value.trim() === "") {
    return fallback;
  }
  const port = Number(value.trim());
  return /^\d+$/.test(value.trim()) && port >= 1 && port <= 65_535 ? port : undefined;
}

/**
 * Reads the supervisor's configuration from `env` (`process.env`):
 *
 * - `DATA_DIR`, `PORT` (public port, 3000 by default), as for the application;
 * - `APP_PORT`: port of the application on the loopback (`PORT` + 1 by default);
 * - `UPDATE_MANIFEST_URL`: manifest of the releases;
 * - `UPDATE_PUBLIC_KEY`: one more Ed25519 key trusted for the releases (raw, base64);
 * - `BUNDLED_APP`: directory of the version shipped with the environment;
 * - `BEHIND_PROXY`: `true` when a reverse proxy (Caddy) sets `x-forwarded-for` in front.
 *
 * `BASE_URL` defaults to `http://localhost:<PORT>` for the application, which would otherwise
 * take its own port.
 */
export function parseSupervisorConfig(
  env: Readonly<Record<string, string | undefined>>,
): SupervisorConfig {
  const problems: string[] = [];
  const port = parsePort(env.PORT, 3000);
  if (port === undefined) {
    problems.push("PORT doit être un nombre entier entre 1 et 65535.");
  }
  const appPort = parsePort(env.APP_PORT, (port ?? 3000) + 1);
  if (appPort === undefined || appPort === port) {
    problems.push("APP_PORT doit être un port entre 1 et 65535, différent de PORT.");
  }
  const manifestUrl = env.UPDATE_MANIFEST_URL?.trim() || DEFAULT_MANIFEST_URL;
  if (URL.parse(manifestUrl) === null) {
    problems.push("UPDATE_MANIFEST_URL doit être une adresse https.");
  }
  const keys = [...TRUSTED_RELEASE_KEYS];
  const extraKey = env.UPDATE_PUBLIC_KEY?.trim();
  if (extraKey !== undefined && extraKey !== "") {
    keys.push(extraKey);
  }
  const trustedKeys: KeyObject[] = [];
  for (const raw of keys) {
    const key = releasePublicKey(raw);
    if (key === undefined) {
      problems.push("UPDATE_PUBLIC_KEY doit être une clé publique Ed25519 (32 octets en base64).");
    } else {
      trustedKeys.push(key);
    }
  }
  const behind = env.BEHIND_PROXY?.trim().toLowerCase();
  if (behind !== undefined && behind !== "" && !["true", "false", "1", "0"].includes(behind)) {
    problems.push("BEHIND_PROXY doit valoir true ou false.");
  }
  if (problems.length > 0 || port === undefined || appPort === undefined) {
    throw new SupervisorConfigError(problems);
  }
  const appEnv: Record<string, string | undefined> = {};
  for (const [name, value] of Object.entries(env)) {
    if (!SUPERVISOR_VARIABLES.has(name)) {
      appEnv[name] = value;
    }
  }
  if (env.BASE_URL === undefined || env.BASE_URL.trim() === "") {
    appEnv.BASE_URL = `http://localhost:${port}`;
  }
  const bundled = env.BUNDLED_APP?.trim();
  return {
    dataDir: resolve(env.DATA_DIR?.trim() || "./data"),
    port,
    appPort,
    manifestUrl,
    trustedKeys,
    bundledApp: bundled === undefined || bundled === "" ? undefined : resolve(bundled),
    behindProxy: behind === "true" || behind === "1",
    appEnv,
  };
}
