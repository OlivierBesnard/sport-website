import { createSecretKey, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CredentialCipher, CredentialDecryptionError } from "./credentials.js";

const key = () => createSecretKey(randomBytes(32));

describe("CredentialCipher", () => {
  const cipher = new CredentialCipher(key());
  const value = { clientId: "club-42", clientSecret: "très-secret" };

  it("decrypts what it encrypted for the same module", () => {
    expect(cipher.decrypt("helloasso", cipher.encrypt("helloasso", value))).toEqual(value);
  });

  it("never stores the value in clear, and uses a new IV every time", () => {
    const first = cipher.encrypt("helloasso", value);
    const second = cipher.encrypt("helloasso", value);
    expect(first).toMatch(/^v1:[\w-]+:[\w-]+:[\w-]+$/);
    expect(first).not.toContain("secret");
    expect(Buffer.from(first.split(":")[3] ?? "", "base64url").toString()).not.toContain("secret");
    expect(first).not.toBe(second);
  });

  it("refuses a value written for another module", () => {
    const stored = cipher.encrypt("helloasso", value);
    expect(() => cipher.decrypt("brevo", stored)).toThrow(CredentialDecryptionError);
  });

  it("refuses a value encrypted with another SECRET_KEY", () => {
    const stored = new CredentialCipher(key()).encrypt("helloasso", value);
    expect(() => cipher.decrypt("helloasso", stored)).toThrow(CredentialDecryptionError);
  });

  it("refuses an altered or malformed value, with a French message", () => {
    const stored = cipher.encrypt("helloasso", value);
    const parts = stored.split(":");
    const ciphertext = Buffer.from(parts[3] ?? "", "base64url");
    ciphertext[0] = (ciphertext[0] ?? 0) ^ 1;
    const altered = [...parts.slice(0, 3), ciphertext.toString("base64url")].join(":");
    expect(() => cipher.decrypt("helloasso", altered)).toThrow(/ne peuvent pas être déchiffrés/);
    for (const malformed of ["", "v1:chiffré", "v2:a:b:c", `v1:${parts[1]}::${parts[3]}`]) {
      expect(() => cipher.decrypt("helloasso", malformed)).toThrow(CredentialDecryptionError);
    }
  });

  it("derives the same key from the same SECRET_KEY (values survive a restart)", () => {
    const secret = key();
    const stored = new CredentialCipher(secret).encrypt("exemple", value);
    expect(new CredentialCipher(secret).decrypt("exemple", stored)).toEqual(value);
  });
});
