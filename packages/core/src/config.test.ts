import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_PORT,
  parseRuntimeConfig,
  RuntimeConfigError,
  type RuntimeConfigVariable,
  type RuntimeEnv,
  SECRET_KEY_BYTES,
} from "./config.js";

/** Generated on the fly: no key is ever written in the repository. */
function generateSecretKey(bytes = SECRET_KEY_BYTES): string {
  return randomBytes(bytes).toString("base64");
}

/** Parses `env` and returns the variables reported as invalid. */
function invalidVariables(env: RuntimeEnv): RuntimeConfigVariable[] {
  try {
    parseRuntimeConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeConfigError);
    return (error as RuntimeConfigError).issues.map((issue) => issue.variable);
  }
  throw new Error("expected the configuration to be rejected");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("parseRuntimeConfig defaults", () => {
  it("applies every default to an empty environment", () => {
    const config = parseRuntimeConfig({});
    expect(config.dataDir).toBe(resolve("data"));
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.baseUrl).toBe("http://localhost:3000");
    expect(config.secretKey).toBeUndefined();
  });

  it("derives the default base URL from the port", () => {
    expect(parseRuntimeConfig({ PORT: "8080" }).baseUrl).toBe("http://localhost:8080");
  });

  it("treats empty and blank values as unset", () => {
    const config = parseRuntimeConfig({ DATA_DIR: "", PORT: "  ", BASE_URL: "", SECRET_KEY: " " });
    expect(config).toEqual(parseRuntimeConfig({}));
  });

  it("reads only the environment it is given, never process.env", () => {
    vi.stubEnv("PORT", "4321");
    vi.stubEnv("BASE_URL", "https://depuis-process-env.fr");
    const config = parseRuntimeConfig({});
    expect(config.port).toBe(DEFAULT_PORT);
    expect(config.baseUrl).toBe("http://localhost:3000");
  });

  it("ignores unknown variables, leaves the environment untouched and returns a frozen object", () => {
    const env = Object.freeze({ PORT: "8080", NODE_ENV: "production", HOME: "/home/club" });
    const config = parseRuntimeConfig(env);
    expect(env).toEqual({ PORT: "8080", NODE_ENV: "production", HOME: "/home/club" });
    expect(Object.keys(config).sort()).toEqual(["baseUrl", "dataDir", "port", "secretKey"]);
    expect(Object.isFrozen(config)).toBe(true);
  });
});

describe("DATA_DIR", () => {
  it("resolves a relative directory against the working directory", () => {
    expect(parseRuntimeConfig({ DATA_DIR: "var/club" }).dataDir).toBe(resolve("var", "club"));
  });

  it("keeps an absolute directory", () => {
    const directory = join(tmpdir(), "sport-cms-data");
    expect(parseRuntimeConfig({ DATA_DIR: directory }).dataDir).toBe(directory);
  });

  it("trims surrounding whitespace", () => {
    expect(parseRuntimeConfig({ DATA_DIR: "  donnees \n" }).dataDir).toBe(resolve("donnees"));
  });
});

describe("PORT", () => {
  it.each([
    ["1", 1],
    ["80", 80],
    ["8080", 8080],
    ["65535", 65_535],
    [" 3001\n", 3001],
  ])("accepts %j", (value, expected) => {
    expect(parseRuntimeConfig({ PORT: value }).port).toBe(expected);
  });

  it.each([
    "0",
    "65536",
    "99999999999999999999",
    "-1",
    "+80",
    "3.5",
    "80.0",
    "3e3",
    "0x1F",
    "80 80",
    "abc",
    "8080abc",
  ])("rejects %j", (value) => {
    expect(invalidVariables({ PORT: value })).toEqual(["PORT"]);
  });
});

describe("BASE_URL", () => {
  it.each([
    ["https://monclub.fr", "https://monclub.fr"],
    ["https://monclub.fr/", "https://monclub.fr"],
    ["HTTPS://MonClub.FR", "https://monclub.fr"],
    ["http://localhost:8080", "http://localhost:8080"],
    ["https://monclub.fr:443", "https://monclub.fr"],
    ["http://127.0.0.1:3000/", "http://127.0.0.1:3000"],
    ["https://école-de-rugby.fr", "https://xn--cole-de-rugby-9gb.fr"],
  ])("normalizes %j to its origin", (value, expected) => {
    expect(parseRuntimeConfig({ BASE_URL: value }).baseUrl).toBe(expected);
  });

  it("keeps the base URL when PORT is also set", () => {
    const config = parseRuntimeConfig({ PORT: "8080", BASE_URL: "https://monclub.fr" });
    expect(config.port).toBe(8080);
    expect(config.baseUrl).toBe("https://monclub.fr");
  });

  it.each([
    "monclub.fr",
    "/admin",
    "ftp://monclub.fr",
    "file:///srv/club",
    "javascript:alert(1)",
    "https://monclub.fr/club",
    "https://monclub.fr/?",
    "https://monclub.fr?page=1",
    "https://monclub.fr/#accueil",
    "https://admin:motdepasse@monclub.fr",
    "https://",
    "https://mon club.fr",
  ])("rejects %j", (value) => {
    expect(invalidVariables({ BASE_URL: value })).toEqual(["BASE_URL"]);
  });
});

describe("SECRET_KEY", () => {
  it("is optional", () => {
    expect(parseRuntimeConfig({}).secretKey).toBeUndefined();
  });

  it("decodes a base64 key of 32 bytes into a secret KeyObject", () => {
    const encoded = generateSecretKey();
    const key = parseRuntimeConfig({ SECRET_KEY: `${encoded}\n` }).secretKey;
    expect(key?.type).toBe("secret");
    expect(key?.symmetricKeySize).toBe(SECRET_KEY_BYTES);
    expect(key?.export().toString("base64")).toBe(encoded);
  });

  it("never exposes the key when the configuration is logged or serialized", () => {
    const encoded = generateSecretKey();
    const config = parseRuntimeConfig({ SECRET_KEY: encoded });
    expect(inspect(config, { depth: Number.POSITIVE_INFINITY })).not.toContain(encoded);
    expect(JSON.stringify(config)).not.toContain(encoded);
  });

  it.each([
    ["a key that is too short", () => generateSecretKey(16)],
    ["a key that is too long", () => generateSecretKey(33)],
    ["a key of 31 bytes", () => generateSecretKey(31)],
    ["a hexadecimal key", () => randomBytes(SECRET_KEY_BYTES).toString("hex")],
    ["a base64url key", () => randomBytes(SECRET_KEY_BYTES).toString("base64url")],
    ["a key without padding", () => generateSecretKey().replace(/=+$/, "")],
    ["a key with characters outside base64", () => `${generateSecretKey().slice(0, 42)}!=`],
    ["a passphrase", () => "mot de passe du club"],
  ])("rejects %s", (_label, makeValue) => {
    expect(invalidVariables({ SECRET_KEY: makeValue() })).toEqual(["SECRET_KEY"]);
  });

  it("rejects a non-canonical encoding of 32 bytes", () => {
    // 32 bytes leave 2 unused bits in the last base64 character: "B" sets one of them.
    const canonical = Buffer.alloc(SECRET_KEY_BYTES).toString("base64");
    expect(canonical.at(-2)).toBe("A");
    const nonCanonical = `${canonical.slice(0, -2)}B=`;
    expect(Buffer.from(nonCanonical, "base64")).toHaveLength(SECRET_KEY_BYTES);
    expect(invalidVariables({ SECRET_KEY: nonCanonical })).toEqual(["SECRET_KEY"]);
  });

  it("never echoes an invalid key in the error", () => {
    const leaked = generateSecretKey(16);
    try {
      parseRuntimeConfig({ SECRET_KEY: leaked });
      expect.unreachable();
    } catch (error) {
      expect(String(error)).not.toContain(leaked);
      expect(inspect(error, { depth: Number.POSITIVE_INFINITY })).not.toContain(leaked);
    }
  });
});

describe("RuntimeConfigError", () => {
  it("reports every invalid variable at once, in French", () => {
    let caught: unknown;
    try {
      parseRuntimeConfig({ PORT: "0", BASE_URL: "monclub.fr", SECRET_KEY: "court" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RuntimeConfigError);
    const error = caught as RuntimeConfigError;
    expect(error.name).toBe("RuntimeConfigError");
    expect(error.issues.map((issue) => issue.variable)).toEqual(["PORT", "BASE_URL", "SECRET_KEY"]);
    expect(error.message).toMatch(/^Configuration invalide :\n/);
    expect(error.message).toContain("- PORT doit être un nombre entier entre 1 et 65535.");
    expect(error.message).toContain("- BASE_URL doit être l'adresse publique du site");
    expect(error.message).toContain("openssl rand -base64 32");
  });

  it("reports a variable only once", () => {
    expect(invalidVariables({ PORT: "99999999999999999999" })).toEqual(["PORT"]);
  });
});
