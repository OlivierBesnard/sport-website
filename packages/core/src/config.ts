import { createSecretKey, type KeyObject } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";

/** Environment the runtime configuration is read from, usually `process.env`. */
export type RuntimeEnv = Readonly<Record<string, string | undefined>>;

/** Runtime configuration of an instance, read once at startup. */
export interface RuntimeConfig {
  /** Absolute path of the directory holding runtime data (database, media, modules, backups). */
  readonly dataDir: string;
  /** TCP port the HTTP server listens on. */
  readonly port: number;
  /** Public origin of the instance, without trailing slash (e.g. `https://monclub.fr`). */
  readonly baseUrl: string;
  /**
   * 256-bit key encrypting secrets at rest, such as module credentials. Kept as a `KeyObject`
   * so that logging the configuration never prints it. Absent until the instance configures it.
   */
  readonly secretKey: KeyObject | undefined;
  /** Address the HTTP server listens on (every interface when absent). */
  readonly host: string | undefined;
  /**
   * A reverse proxy in front (the supervisor, Caddy) overwrites `x-forwarded-for` with the
   * client's real address: the rate limits may then trust it.
   */
  readonly trustProxy: boolean;
  /** Directory of the back-office build, when the package lays it out elsewhere. */
  readonly adminDir: string | undefined;
}

/** Variables read by {@link parseRuntimeConfig}. */
export type RuntimeConfigVariable =
  | "DATA_DIR"
  | "PORT"
  | "BASE_URL"
  | "SECRET_KEY"
  | "HOST"
  | "TRUST_PROXY"
  | "ADMIN_DIR";

export interface RuntimeConfigIssue {
  readonly variable: RuntimeConfigVariable;
  /** Explanation in French, shown to whoever installs the instance. */
  readonly message: string;
}

/** Thrown by {@link parseRuntimeConfig}; the message lists every invalid variable, in French. */
export class RuntimeConfigError extends Error {
  readonly issues: readonly RuntimeConfigIssue[];

  constructor(issues: readonly RuntimeConfigIssue[]) {
    const details = issues.map(({ variable, message }) => `- ${variable} ${message}`).join("\n");
    super(`Configuration invalide :\n${details}`);
    this.name = "RuntimeConfigError";
    this.issues = issues;
  }
}

/** Data directory used when `DATA_DIR` is not set, relative to the working directory. */
export const DEFAULT_DATA_DIR = "./data";
/** Port used when `PORT` is not set. */
export const DEFAULT_PORT = 3000;
/** Size in bytes of `SECRET_KEY` once decoded (AES-256). */
export const SECRET_KEY_BYTES = 32;

/**
 * One message per variable: the values are never echoed back, since `SECRET_KEY` is a secret.
 */
const ISSUE_MESSAGES: Readonly<Record<RuntimeConfigVariable, string>> = {
  DATA_DIR: "doit être un chemin de dossier.",
  PORT: "doit être un nombre entier entre 1 et 65535.",
  BASE_URL:
    "doit être l'adresse publique du site, en http ou https, sans chemin, paramètre ni fragment (exemple : https://monclub.fr).",
  HOST: "doit être une adresse d'écoute (exemple : 127.0.0.1).",
  TRUST_PROXY: "doit valoir true ou false.",
  ADMIN_DIR: "doit être un chemin de dossier.",
  SECRET_KEY: `doit contenir ${SECRET_KEY_BYTES} octets encodés en base64 (à générer par exemple avec « openssl rand -base64 ${SECRET_KEY_BYTES} »).`,
};

const PORT_PATTERN = /^\d+$/;
/** A hostname or an IPv4/IPv6 address, nothing else. */
const HOST_PATTERN = /^[0-9A-Za-z.:-]+$/;

/** Surrounding whitespace is dropped and an empty value counts as unset. */
function normalizeValue(value: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/**
 * Reduces an absolute http(s) URL to its origin; anything beyond it is refused, and so is
 * port 0, which no visitor can reach. The URL parser already rejects ports above 65535.
 */
function toOrigin(value: string, context: z.RefinementCtx): string {
  const url = URL.parse(value);
  const isOriginOnly =
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.username === "" &&
    url.password === "" &&
    url.port !== "0" &&
    url.pathname === "/" &&
    !value.includes("?") &&
    !value.includes("#");
  if (url === null || !isOriginOnly) {
    context.addIssue({ code: "custom", message: "not an http(s) origin" });
    return z.NEVER;
  }
  return url.origin;
}

/** Accepts only the canonical, padded base64 encoding of exactly {@link SECRET_KEY_BYTES} bytes. */
function toSecretKey(value: string, context: z.RefinementCtx): KeyObject {
  const bytes = Buffer.from(value, "base64");
  if (bytes.length !== SECRET_KEY_BYTES || bytes.toString("base64") !== value) {
    context.addIssue({ code: "custom", message: "not a base64-encoded 256-bit key" });
    return z.NEVER;
  }
  return createSecretKey(bytes);
}

const envSchema = z.object({
  DATA_DIR: z.preprocess(normalizeValue, z.string().optional()),
  PORT: z.preprocess(
    normalizeValue,
    z
      .string()
      .regex(PORT_PATTERN)
      .transform(Number)
      .pipe(z.number().int().min(1).max(65_535))
      .optional(),
  ),
  BASE_URL: z.preprocess(normalizeValue, z.string().transform(toOrigin).optional()),
  SECRET_KEY: z.preprocess(normalizeValue, z.string().transform(toSecretKey).optional()),
  HOST: z.preprocess(normalizeValue, z.string().regex(HOST_PATTERN).optional()),
  TRUST_PROXY: z.preprocess(
    (value) => {
      const normalized = normalizeValue(value);
      return typeof normalized === "string" ? normalized.toLowerCase() : normalized;
    },
    z
      .enum(["true", "false", "1", "0"])
      .transform((value) => value === "true" || value === "1")
      .optional(),
  ),
  ADMIN_DIR: z.preprocess(normalizeValue, z.string().optional()),
});

/**
 * Reads and validates the runtime configuration from `env` (pass `process.env` in production).
 * Other variables of `env` are ignored, and `env` is never modified.
 *
 * - `DATA_DIR`: data directory, resolved against the working directory (default `./data`).
 * - `PORT`: HTTP port (default 3000).
 * - `BASE_URL`: public origin of the site (default `http://localhost:<PORT>`).
 * - `SECRET_KEY`: optional at this stage; 32 random bytes in base64 when set.
 * - `HOST`: listening address (`127.0.0.1` behind the supervisor: a single port exposed).
 * - `TRUST_PROXY`: `true` when a reverse proxy overwrites `x-forwarded-for` (default false).
 * - `ADMIN_DIR`: directory of the back-office build (found next to the server by default).
 *
 * @throws {RuntimeConfigError} when a variable is invalid; every invalid variable is reported.
 */
export function parseRuntimeConfig(env: RuntimeEnv): RuntimeConfig {
  const result = envSchema.safeParse({
    DATA_DIR: env.DATA_DIR,
    PORT: env.PORT,
    BASE_URL: env.BASE_URL,
    SECRET_KEY: env.SECRET_KEY,
    HOST: env.HOST,
    TRUST_PROXY: env.TRUST_PROXY,
    ADMIN_DIR: env.ADMIN_DIR,
  });
  if (!result.success) {
    const variables = new Set(
      result.error.issues.map((issue) => issue.path[0] as RuntimeConfigVariable),
    );
    throw new RuntimeConfigError(
      [...variables].map((variable) => ({ variable, message: ISSUE_MESSAGES[variable] })),
    );
  }

  const { DATA_DIR, PORT, BASE_URL, SECRET_KEY, HOST, TRUST_PROXY, ADMIN_DIR } = result.data;
  const port = PORT ?? DEFAULT_PORT;
  return Object.freeze({
    dataDir: resolve(DATA_DIR ?? DEFAULT_DATA_DIR),
    port,
    baseUrl: BASE_URL ?? `http://localhost:${port}`,
    secretKey: SECRET_KEY,
    host: HOST,
    trustProxy: TRUST_PROXY ?? false,
    adminDir: ADMIN_DIR === undefined ? undefined : resolve(ADMIN_DIR),
  });
}
