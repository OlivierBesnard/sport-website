import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseSupervisorConfig } from "./config.js";
import { isAllowedDownloadUrl } from "./manifest.js";
import { StaleCache } from "./proxy.js";
import {
  rawPublicKey,
  releasePublicKey,
  signRelease,
  verifyReleaseSignature,
} from "./signature.js";
import { generateReleaseKeys } from "./testing.js";

describe("release signatures", () => {
  const keys = generateReleaseKeys();
  const sha = createHash("sha256").update("paquet").digest("hex");

  it("verifies a signature by a trusted key, raw key round trip included", () => {
    const signature = signRelease(keys.privateKey, "1.2.0", "linux-x64", sha);
    const trusted = releasePublicKey(rawPublicKey(keys.publicKey));
    expect(trusted).toBeDefined();
    expect(
      verifyReleaseSignature([trusted ?? keys.publicKey], "1.2.0", "linux-x64", sha, signature),
    ).toBe(true);
  });

  it("refuses it for another version, platform, checksum or key", () => {
    const signature = signRelease(keys.privateKey, "1.2.0", "linux-x64", sha);
    const trusted = [keys.publicKey];
    expect(verifyReleaseSignature(trusted, "1.1.0", "linux-x64", sha, signature)).toBe(false);
    expect(verifyReleaseSignature(trusted, "1.2.0", "linux-arm64", sha, signature)).toBe(false);
    expect(verifyReleaseSignature(trusted, "1.2.0", "linux-x64", "0".repeat(64), signature)).toBe(
      false,
    );
    expect(
      verifyReleaseSignature(
        [generateReleaseKeys().publicKey],
        "1.2.0",
        "linux-x64",
        sha,
        signature,
      ),
    ).toBe(false);
    expect(verifyReleaseSignature(trusted, "1.2.0", "linux-x64", sha, "pas une signature")).toBe(
      false,
    );
    expect(verifyReleaseSignature([], "1.2.0", "linux-x64", sha, signature)).toBe(false);
  });

  it("refuses malformed public keys", () => {
    expect(releasePublicKey("abc")).toBeUndefined();
    expect(releasePublicKey(Buffer.alloc(31).toString("base64"))).toBeUndefined();
  });
});

describe("download URLs", () => {
  it("allow https, and http on the loopback only", () => {
    expect(isAllowedDownloadUrl(new URL("https://example.org/m.json"))).toBe(true);
    expect(isAllowedDownloadUrl(new URL("http://127.0.0.1:8080/m.json"))).toBe(true);
    expect(isAllowedDownloadUrl(new URL("http://localhost/m.json"))).toBe(true);
    expect(isAllowedDownloadUrl(new URL("http://example.org/m.json"))).toBe(false);
    expect(isAllowedDownloadUrl(new URL("file:///etc/passwd"))).toBe(false);
  });
});

describe("StaleCache", () => {
  it("drops the least recently used entries beyond its size", () => {
    const cache = new StaleCache(10);
    const entry = (size: number) => ({ status: 200, headers: {}, body: Buffer.alloc(size) });
    cache.set("/a", entry(4));
    cache.set("/b", entry(4));
    cache.get("/a");
    cache.set("/c", entry(4));
    expect(cache.get("/b")).toBeUndefined();
    expect(cache.get("/a")).toBeDefined();
    expect(cache.get("/c")).toBeDefined();
    cache.set("/a", entry(2));
    expect(cache.size).toBe(2);
  });
});

describe("parseSupervisorConfig", () => {
  it("has defaults, and passes the application its own variables", () => {
    const config = parseSupervisorConfig({ PORT: "8080", SECRET_KEY: "s", UPDATE_PUBLIC_KEY: "" });
    expect(config).toMatchObject({
      port: 8080,
      appPort: 8081,
      behindProxy: false,
      trustedKeys: [],
    });
    expect(config.appEnv).toEqual({
      PORT: "8080",
      SECRET_KEY: "s",
      BASE_URL: "http://localhost:8080",
    });
    expect(parseSupervisorConfig({ BASE_URL: "https://monclub.fr" }).appEnv.BASE_URL).toBe(
      "https://monclub.fr",
    );
  });

  it("reads the extra key and the proxy flag", () => {
    const raw = rawPublicKey(generateReleaseKeys().publicKey);
    const config = parseSupervisorConfig({ UPDATE_PUBLIC_KEY: raw, BEHIND_PROXY: "true" });
    expect(config.trustedKeys).toHaveLength(1);
    expect(config.behindProxy).toBe(true);
    expect(config.appEnv).not.toHaveProperty("UPDATE_PUBLIC_KEY");
  });

  it("lists every invalid variable, in French", () => {
    expect(() =>
      parseSupervisorConfig({
        PORT: "3000",
        APP_PORT: "3000",
        UPDATE_PUBLIC_KEY: "x",
        BEHIND_PROXY: "oui",
      }),
    ).toThrow(/APP_PORT[\s\S]*UPDATE_PUBLIC_KEY[\s\S]*BEHIND_PROXY/);
  });
});
