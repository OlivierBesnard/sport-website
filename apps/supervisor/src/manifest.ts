import semver from "semver";
import { z } from "zod";

/**
 * The manifest (`manifest.json`, published next to the releases by `pnpm release`, E13): every
 * release still offered, with one package per platform. A static file, read by every instance:
 * no central server, and no GitHub API quota.
 *
 * ```json
 * {
 *   "schema": 1,
 *   "releases": [{
 *     "version": "1.4.0", "publishedAt": "2026-11-02T20:00:00Z", "notes": "…",
 *     "urgent": false, "rollout": 10, "minEnvironment": 1, "minFrom": "1.0.0",
 *     "packages": { "linux-x64": { "url": "…", "size": 123, "sha256": "…", "signature": "…" } }
 *   }],
 *   "withdrawn": ["1.3.0"]
 * }
 * ```
 */

/** Largest manifest read, in bytes. */
export const MAX_MANIFEST_BYTES = 1024 * 1024;

const version = z
  .string()
  .refine((value) => semver.valid(value) === value, "Numéro de version invalide (semver).");

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, "Somme SHA-256 attendue en hexadécimal.");

const releasePackageSchema = z.object({
  /** Absolute, or relative to the manifest's own URL. */
  url: z.string().min(1),
  size: z.number().int().positive(),
  sha256,
  /** Ed25519 signature of {@link signedReleaseMessage}, in base64. */
  signature: z.string().min(1),
});

const releaseSchema = z.object({
  version,
  publishedAt: z.iso.datetime({ offset: true }).transform((value) => Date.parse(value)),
  notes: z.string().default(""),
  /** Security fix: installed as soon as possible, without waiting for window, pause or rollout. */
  urgent: z.boolean().default(false),
  /** Share of the instances (0 to 100) that install it: progressive rollout. */
  rollout: z.number().int().min(0).max(100).default(100),
  /** Version of the environment (Docker image) it needs. */
  minEnvironment: z.number().int().nonnegative().default(1),
  /**
   * Oldest version that may update to it directly; older instances first go through a relay
   * (the newest release they may reach).
   */
  minFrom: version.optional(),
  /** By platform, `<process.platform>-<process.arch>` (`linux-x64`, `linux-arm64`). */
  packages: z.record(z.string().regex(/^[a-z0-9]+-[a-z0-9]+$/), releasePackageSchema),
});

const manifestSchema = z.object({
  schema: z.literal(1),
  releases: z.array(releaseSchema),
  /** Withdrawn versions: never installed, even if a release still lists them. */
  withdrawn: z.array(version).default([]),
});

export type ReleasePackage = z.infer<typeof releasePackageSchema>;
export type Release = z.infer<typeof releaseSchema>;
export type Manifest = z.infer<typeof manifestSchema>;

/** The manifest cannot be used; the message, in French, ends up in the back-office. */
export class ManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestError";
  }
}

/** Validates a manifest already parsed from JSON. */
export function parseManifest(value: unknown): Manifest {
  const result = manifestSchema.safeParse(value, {
    error: z.locales.fr().localeError,
    reportInput: true,
  });
  if (!result.success) {
    const issue = result.error.issues[0];
    const where =
      issue === undefined || issue.path.length === 0 ? "" : ` (${issue.path.join(".")})`;
    throw new ManifestError(`Manifeste des versions invalide${where} : ${issue?.message ?? ""}`);
  }
  return result.data;
}

/**
 * `true` for the URLs a package or manifest may be fetched from: `https:`, or `http:` on the
 * loopback (the local release server of the tests). The signature protects the package
 * anyway; https keeps the manifest itself (rollout, withdrawals) from being altered on the way.
 */
export function isAllowedDownloadUrl(url: URL): boolean {
  if (url.protocol === "https:") {
    return true;
  }
  return (
    url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]")
  );
}

export interface FetchManifestOptions {
  readonly url: string;
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

/** Downloads and validates the manifest. */
export async function fetchManifest({
  url,
  fetch: fetchImpl = fetch,
  timeoutMs = 30_000,
}: FetchManifestOptions): Promise<Manifest> {
  const target = URL.parse(url);
  if (target === null || !isAllowedDownloadUrl(target)) {
    throw new ManifestError(`Adresse du manifeste refusée (https requis) : ${url}`);
  }
  let response: Response;
  try {
    response = await fetchImpl(target, {
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
  } catch (error) {
    throw new ManifestError(
      `Le manifeste des versions est injoignable (${error instanceof Error ? error.message : String(error)}).`,
    );
  }
  if (!response.ok) {
    throw new ManifestError(`Le manifeste des versions répond ${response.status}.`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > MAX_MANIFEST_BYTES) {
    throw new ManifestError("Le manifeste des versions est trop volumineux.");
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new ManifestError("Le manifeste des versions n'est pas du JSON valide.");
  }
  return parseManifest(json);
}
