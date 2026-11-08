import {
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { rawPublicKey, signRelease, verifyReleaseSignature } from "@sport-cms/supervisor";
import { ReleaseError } from "./exec.js";

/**
 * The maintainers' signing key (PLAN §8.2): Ed25519, in a PEM file kept outside the repository
 * and off GitHub, encrypted with a passphrase. Its public half, raw 32 bytes in base64, goes
 * into `TRUSTED_RELEASE_KEYS` of the supervisor.
 */

/** Where the key is looked for without `--key` nor `RELEASE_SIGNING_KEY`. */
export function defaultKeyPath(): string {
  return join(homedir(), ".sport-cms", "release-signing-key.pem");
}

export const MIN_PASSPHRASE_LENGTH = 12;

/** `true` when `file` is inside `directory` (or is it). */
export function isInside(directory: string, file: string): boolean {
  const path = relative(resolve(directory), resolve(file));
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

/** A new key pair; the private key encrypted (PKCS#8, AES-256-CBC) with the passphrase. */
export function generateSigningKey(passphrase: string): { pem: string; publicKey: string } {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new ReleaseError(
      `La phrase de passe doit compter au moins ${MIN_PASSPHRASE_LENGTH} caractères.`,
    );
  }
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = privateKey.export({
    type: "pkcs8",
    format: "pem",
    cipher: "aes-256-cbc",
    passphrase,
  }) as string;
  return { pem, publicKey: rawPublicKey(publicKey) };
}

/**
 * Writes a new key file, never over an existing one nor inside the repository.
 *
 * @returns the public key, raw base64.
 */
export async function createKeyFile(
  file: string,
  passphrase: string,
  repositoryRoot: string,
): Promise<string> {
  if (isInside(repositoryRoot, file)) {
    throw new ReleaseError(
      "La clé de signature ne doit pas être enregistrée dans le dépôt : choisissez un autre emplacement.",
    );
  }
  const { pem, publicKey } = generateSigningKey(passphrase);
  await mkdir(dirname(resolve(file)), { recursive: true });
  try {
    await writeFile(file, pem, { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new ReleaseError(`Le fichier ${file} existe déjà : il n'est jamais remplacé.`);
    }
    throw error;
  }
  return publicKey;
}

/** Reads and decrypts the key file. */
export async function loadSigningKey(file: string, passphrase: string): Promise<KeyObject> {
  let pem: string;
  try {
    pem = await readFile(file, "utf8");
  } catch {
    throw new ReleaseError(
      `Clé de signature introuvable : ${file} (créez-la avec « pnpm release keygen »).`,
    );
  }
  let key: KeyObject;
  try {
    key = createPrivateKey({ key: pem, format: "pem", passphrase });
  } catch {
    throw new ReleaseError(
      "La clé de signature n'a pas pu être déchiffrée : phrase de passe incorrecte ?",
    );
  }
  if (key.asymmetricKeyType !== "ed25519") {
    throw new ReleaseError("La clé de signature doit être une clé Ed25519.");
  }
  return key;
}

/** Public key of a private key, raw base64. */
export function publicKeyOf(privateKey: KeyObject): string {
  return rawPublicKey(createPublicKey(privateKey));
}

/**
 * Checks, before anything is built, that the instances will accept what this key signs: its
 * public key must be one of the supervisor's trusted keys.
 */
export function checkTrusted(privateKey: KeyObject, trustedKeys: readonly string[]): void {
  const publicKey = publicKeyOf(privateKey);
  if (!trustedKeys.includes(publicKey)) {
    throw new ReleaseError(
      `La clé publique ${publicKey} ne figure pas dans TRUSTED_RELEASE_KEYS (apps/supervisor/src/signature.ts) : les instances refuseraient cette release.`,
    );
  }
}

/** Signs one package, and checks the signature as an instance will. */
export function signPackage(
  privateKey: KeyObject,
  version: string,
  platform: string,
  sha256: string,
): string {
  const signature = signRelease(privateKey, version, platform, sha256);
  if (
    !verifyReleaseSignature([createPublicKey(privateKey)], version, platform, sha256, signature)
  ) {
    throw new ReleaseError(`La signature du paquet ${platform} n'a pas pu être vérifiée.`);
  }
  return signature;
}
