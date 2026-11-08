import { createPublicKey, type KeyObject, sign, verify } from "node:crypto";

/**
 * Signature of the release packages: Ed25519, by the maintainers' key (kept off the repository
 * and off GitHub, E13). What is signed binds the archive's checksum to its version and platform,
 * so a valid signature cannot be replayed onto another version (a downgrade) or platform.
 */

/** Public keys trusted for the releases, raw 32 bytes in base64. Added by E13. */
export const TRUSTED_RELEASE_KEYS: readonly string[] = [];

/** DER prefix of an Ed25519 public key in SPKI form; the raw 32 bytes follow. */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/** The bytes signed for one package. */
export function signedReleaseMessage(version: string, platform: string, sha256: string): Buffer {
  return Buffer.from(`sport-cms release v1\n${version}\n${platform}\n${sha256}\n`, "utf8");
}

/** Ed25519 public key from its raw 32 bytes in base64; `undefined` when malformed. */
export function releasePublicKey(raw: string): KeyObject | undefined {
  const bytes = Buffer.from(raw, "base64");
  if (bytes.length !== 32 || bytes.toString("base64") !== raw) {
    return undefined;
  }
  return createPublicKey({
    key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]),
    format: "der",
    type: "spki",
  });
}

/** Raw 32 bytes of an Ed25519 public key, in base64 (the format of {@link TRUSTED_RELEASE_KEYS}). */
export function rawPublicKey(key: KeyObject): string {
  const der = key.export({ format: "der", type: "spki" });
  return der.subarray(ED25519_SPKI_PREFIX.length).toString("base64");
}

/** Signs one package (release script, and the tests' fake releases). */
export function signRelease(
  privateKey: KeyObject,
  version: string,
  platform: string,
  sha256: string,
): string {
  return sign(null, signedReleaseMessage(version, platform, sha256), privateKey).toString("base64");
}

/** `true` when one of the trusted keys signed this package. */
export function verifyReleaseSignature(
  trustedKeys: readonly KeyObject[],
  version: string,
  platform: string,
  sha256: string,
  signature: string,
): boolean {
  const signatureBytes = Buffer.from(signature, "base64");
  if (signatureBytes.length !== 64) {
    return false;
  }
  const message = signedReleaseMessage(version, platform, sha256);
  return trustedKeys.some((key) => {
    try {
      return verify(null, message, key, signatureBytes);
    } catch {
      return false;
    }
  });
}
