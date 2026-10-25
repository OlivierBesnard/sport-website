import { randomBytes } from "node:crypto";
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import {
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

/** Parses `env` and returns the error it is rejected with. */
function rejection(env: RuntimeEnv): RuntimeConfigError {
  try {
    parseRuntimeConfig(env);
  } catch (error) {
    expect(error).toBeInstanceOf(RuntimeConfigError);
    return error as RuntimeConfigError;
  }
  throw new Error("expected the configuration to be rejected");
}

function invalidVariables(env: RuntimeEnv): RuntimeConfigVariable[] {
  return rejection(env).issues.map((issue) => issue.variable);
}

describe("PORT limits", () => {
  // Leading zeros are read as decimal, as `net.Server#listen` does with a numeric string.
  it.each([
    ["080", 80],
    ["0080", 80],
    ["03000", 3000],
  ])("reads %j as the decimal port %d", (value, expected) => {
    expect(parseRuntimeConfig({ PORT: value }).port).toBe(expected);
  });

  it.each(["00", "3000abc", "٣٠٠٠", "３０００", "-0"])("rejects %j", (value) => {
    expect(invalidVariables({ PORT: value })).toEqual(["PORT"]);
  });

  it("accepts a value ending with CRLF, as written by a Windows editor", () => {
    expect(parseRuntimeConfig({ PORT: "8080\r\n" }).port).toBe(8080);
  });
});

describe("BASE_URL limits", () => {
  it.each([
    "https://admin@monclub.fr",
    "https://monclub.fr/club/",
    "https://monclub.fr/club?page=1",
    "https://monclub.fr#",
    "https://monclub.fr:99999",
  ])("rejects %j", (value) => {
    expect(invalidVariables({ BASE_URL: value })).toEqual(["BASE_URL"]);
  });

  it("rejects port 0, which no visitor can reach", () => {
    expect(invalidVariables({ BASE_URL: "https://monclub.fr:0" })).toEqual(["BASE_URL"]);
  });

  it.each([
    ["http://[::1]:3000/", "http://[::1]:3000"],
    ["https://192.168.1.10:8443", "https://192.168.1.10:8443"],
    ["https://monclub.fr\r\n", "https://monclub.fr"],
  ])("normalizes %j to its origin", (value, expected) => {
    expect(parseRuntimeConfig({ BASE_URL: value }).baseUrl).toBe(expected);
  });

  it("never echoes credentials found in the URL", () => {
    const error = rejection({ BASE_URL: "https://club:motdepasse-secret@monclub.fr" });
    expect(error.message).not.toContain("motdepasse-secret");
    expect(inspect(error, { depth: Number.POSITIVE_INFINITY })).not.toContain("motdepasse-secret");
  });
});

describe("SECRET_KEY limits", () => {
  it("accepts a key followed by CRLF, as written in a .env edited on Windows", () => {
    const encoded = generateSecretKey();
    const key = parseRuntimeConfig({ SECRET_KEY: `${encoded}\r\n` }).secretKey;
    expect(key?.export().toString("base64")).toBe(encoded);
  });

  it.each([
    ["31 bytes", () => generateSecretKey(31)],
    ["33 bytes", () => generateSecretKey(33)],
    [
      "a line break inside the key",
      () => {
        const key = generateSecretKey();
        return `${key.slice(0, 20)}\n${key.slice(20)}`;
      },
    ],
    [
      "a space inside the key",
      () => {
        const key = generateSecretKey();
        return `${key.slice(0, 20)} ${key.slice(20)}`;
      },
    ],
    ["an extra padding character", () => `${generateSecretKey()}=`],
  ])("rejects a key with %s", (_label, makeValue) => {
    expect(invalidVariables({ SECRET_KEY: makeValue() })).toEqual(["SECRET_KEY"]);
  });

  it("never shows any part of an invalid key in the error, its stack or its issues", () => {
    const leaked = generateSecretKey(31);
    const error = rejection({ SECRET_KEY: leaked });
    const outputs = [
      String(error),
      error.stack ?? "",
      inspect(error, { depth: Number.POSITIVE_INFINITY, showHidden: true }),
      JSON.stringify(error),
      JSON.stringify(error.issues),
    ];
    const chunks = Array.from({ length: 8 }, (_, i) => leaked.slice(i * 5, i * 5 + 8));
    for (const output of outputs) {
      for (const chunk of chunks) {
        expect(output).not.toContain(chunk);
      }
    }
  });

  it("never shows a valid key, whatever the way the configuration is printed", () => {
    const encoded = generateSecretKey();
    const config = parseRuntimeConfig({ SECRET_KEY: encoded });
    const raw = config.secretKey?.export();
    expect(raw).toBeDefined();
    const outputs = [
      JSON.stringify(config),
      inspect(config, { depth: Number.POSITIVE_INFINITY, showHidden: true }),
      String(config.secretKey),
      JSON.stringify(Object.entries(config)),
    ];
    for (const output of outputs) {
      expect(output).not.toContain(encoded);
      expect(output).not.toContain(raw?.toString("hex"));
      expect(output).not.toContain(raw?.toString("base64url"));
    }
  });
});
