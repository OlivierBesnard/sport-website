import {
  createCipheriv,
  createDecipheriv,
  createSecretKey,
  hkdfSync,
  type KeyObject,
  randomBytes,
} from "node:crypto";

/**
 * Encryption of the module credentials at rest (`module_credentials.encrypted_value`):
 * AES-256-GCM with a key derived from `SECRET_KEY` by HKDF-SHA256, so the instance secret itself
 * never encrypts data and other uses of it get keys of their own. The identifier of the module is
 * authenticated with each value (additional data): a value copied to another module's row does
 * not decrypt.
 *
 * Stored form: `v1:<iv>:<tag>:<ciphertext>`, each part in base64url (12-byte random IV,
 * 16-byte tag). `v1` names the scheme, to let a later one coexist.
 */

const VERSION = "v1";
const HKDF_INFO = "sport-cms:module-credentials:v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** The stored value cannot be decrypted: altered, written for another module, or another key. */
export class CredentialDecryptionError extends Error {
  constructor(moduleId: string) {
    super(
      `Les identifiants du module « ${moduleId} » ne peuvent pas être déchiffrés : ils ont été ` +
        "modifiés, ou chiffrés avec une autre clé SECRET_KEY. Enregistrez-les à nouveau.",
    );
    this.name = "CredentialDecryptionError";
  }
}

function additionalData(moduleId: string): Buffer {
  return Buffer.from(`module:${moduleId}`, "utf8");
}

export class CredentialCipher {
  readonly #key: KeyObject;

  constructor(secretKey: KeyObject) {
    this.#key = createSecretKey(
      Buffer.from(hkdfSync("sha256", secretKey, Buffer.alloc(0), HKDF_INFO, 32)),
    );
  }

  /** Encrypts the credentials of `moduleId` (a JSON value); a new IV every time. */
  encrypt(moduleId: string, value: unknown): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv("aes-256-gcm", this.#key, iv, { authTagLength: TAG_BYTES });
    cipher.setAAD(additionalData(moduleId));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [VERSION, iv, cipher.getAuthTag(), ciphertext]
      .map((part) => (typeof part === "string" ? part : part.toString("base64url")))
      .join(":");
  }

  /**
   * Decrypts a value written by {@link encrypt} for the same module.
   *
   * @throws {CredentialDecryptionError} when the value is malformed, altered, written for
   *   another module or with another key.
   */
  decrypt(moduleId: string, stored: string): unknown {
    const parts = stored.split(":");
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new CredentialDecryptionError(moduleId);
    }
    const [iv, tag, ciphertext] = parts.slice(1).map((part) => Buffer.from(part, "base64url"));
    if (iv?.length !== IV_BYTES || tag?.length !== TAG_BYTES || ciphertext === undefined) {
      throw new CredentialDecryptionError(moduleId);
    }
    try {
      const decipher = createDecipheriv("aes-256-gcm", this.#key, iv, {
        authTagLength: TAG_BYTES,
      });
      decipher.setAAD(additionalData(moduleId));
      decipher.setAuthTag(tag);
      const text = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
      return JSON.parse(text);
    } catch {
      throw new CredentialDecryptionError(moduleId);
    }
  }
}
