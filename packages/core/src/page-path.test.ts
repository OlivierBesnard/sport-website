import { describe, expect, it } from "vitest";
import { encodePagePath, normalizePagePath } from "./page-path.js";

describe("normalizePagePath", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["//", "/"],
    ["/club", "/club"],
    ["/club/", "/club"],
    ["/club///", "/club"],
    ["club", "/club"],
    ["/equipes//u13", "/equipes/u13"],
    ["//evil.example/page", "/evil.example/page"],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizePagePath(input)).toBe(expected);
  });

  it.each([
    ["/a/./b", "/a/b"],
    ["/a/../b", "/b"],
    ["/a/b/..", "/a"],
    ["/a/../", "/"],
    ["/..", "/"],
    ["/../../club", "/club"],
    ["/a/.././../b/./c/", "/b/c"],
    ["./club", "/club"],
  ])("resolves the dot segments of %j to %j", (input, expected) => {
    expect(normalizePagePath(input)).toBe(expected);
  });

  it("keeps segments that only look like dot segments", () => {
    expect(normalizePagePath("/.../a..b/.c/d.")).toBe("/.../a..b/.c/d.");
  });

  it("keeps the case of the path, which is significant", () => {
    expect(normalizePagePath("/Equipes/U13")).toBe("/Equipes/U13");
  });

  it("drops control characters, as browsers drop them from a URL", () => {
    expect(normalizePagePath("/a\tb\nc\r")).toBe("/abc");
    expect(normalizePagePath("/équ\u0085ipe/\u007Fclub")).toBe("/équipe/club");
  });

  it("composes accents (NFC), whatever the form typed or sent", () => {
    const decomposed = "/équipe/séniors";
    const composed = "/équipe/séniors";
    expect(normalizePagePath(decomposed)).toBe(composed);
    expect(normalizePagePath(composed)).toBe(composed);
  });

  it("is idempotent", () => {
    for (const path of ["/", "/a/b", "a//b/", "/été/", "/a/../b/./c"]) {
      const once = normalizePagePath(path);
      expect(normalizePagePath(once)).toBe(once);
    }
  });
});

describe("encodePagePath", () => {
  it("leaves plain paths unchanged", () => {
    expect(encodePagePath("/")).toBe("/");
    expect(encodePagePath("/equipes/u13")).toBe("/equipes/u13");
  });

  it("percent-encodes non-ASCII characters as UTF-8", () => {
    expect(encodePagePath("/équipes")).toBe("/%C3%A9quipes");
  });

  it("encodes the characters that would change how the path is read", () => {
    expect(encodePagePath("/a?b#c%d")).toBe("/a%3Fb%23c%25d");
    expect(encodePagePath("/\\evil.example")).toBe("/%5Cevil.example");
  });

  it("round-trips through decodeURIComponent", () => {
    const path = "/été 2026/l'équipe & co";
    const encoded = encodePagePath(path);
    expect(decodeURIComponent(encoded)).toBe(path);
  });
});
