import { DEFAULT_UPDATE_SETTINGS, type UpdateSettings } from "@sport-cms/core";
import { describe, expect, it } from "vitest";
import { type Manifest, parseManifest } from "./manifest.js";
import { isInMaintenanceWindow, type SelectionInput, selectRelease } from "./select.js";

const PACKAGE = { url: "p.tgz", size: 1, sha256: "a".repeat(64), signature: "c2ln" };

function manifest(
  releases: readonly Record<string, unknown>[],
  withdrawn: readonly string[] = [],
): Manifest {
  return parseManifest({
    schema: 1,
    releases: releases.map((release) => ({
      publishedAt: "2026-11-01T20:00:00Z",
      packages: { "linux-x64": PACKAGE },
      ...release,
    })),
    withdrawn,
  });
}

function select(
  releases: readonly Record<string, unknown>[],
  overrides: Partial<Omit<SelectionInput, "settings">> & {
    settings?: Partial<UpdateSettings>;
  } = {},
) {
  const { settings, ...rest } = overrides;
  return selectRelease({
    manifest: manifest(releases),
    current: "1.0.0",
    settings: { ...DEFAULT_UPDATE_SETTINGS, ...settings },
    environment: 1,
    platform: "linux-x64",
    bucket: 50,
    failed: [],
    now: Date.parse("2026-11-08T12:00:00Z"),
    ...rest,
  });
}

describe("selectRelease", () => {
  it("picks the newest newer release", () => {
    const result = select([{ version: "0.9.0" }, { version: "1.2.0" }, { version: "1.1.0" }]);
    expect(result.release?.version).toBe("1.2.0");
    expect(select([{ version: "1.0.0" }, { version: "0.9.0" }]).release).toBeNull();
  });

  it("keeps pre-releases to the beta channel", () => {
    const releases = [{ version: "1.1.0" }, { version: "1.2.0-beta.1" }];
    expect(select(releases).release?.version).toBe("1.1.0");
    expect(select(releases, { settings: { channel: "beta" } }).release?.version).toBe(
      "1.2.0-beta.1",
    );
  });

  it("skips withdrawn and failed versions, and other platforms", () => {
    const result = selectRelease({
      manifest: manifest(
        [{ version: "1.1.0" }, { version: "1.2.0" }, { version: "1.3.0" }],
        ["1.3.0"],
      ),
      current: "1.0.0",
      settings: DEFAULT_UPDATE_SETTINGS,
      environment: 1,
      platform: "linux-x64",
      bucket: 0,
      failed: ["1.2.0"],
      now: 0,
    });
    expect(result.release?.version).toBe("1.1.0");
    expect(select([{ version: "1.1.0" }], { platform: "linux-arm64" }).release).toBeNull();
  });

  it("follows the policy: nothing when manual, no new major with automatic-minor", () => {
    const releases = [{ version: "1.1.0" }, { version: "2.0.0" }];
    expect(select(releases, { settings: { policy: "manual" } }).release).toBeNull();
    expect(select(releases, { settings: { policy: "automatic-minor" } }).release?.version).toBe(
      "1.1.0",
    );
    expect(
      select(releases, { settings: { policy: "manual" }, manual: true }).release?.version,
    ).toBe("2.0.0");
  });

  it("holds back during a pause and outside the rollout, except urgent fixes", () => {
    const now = Date.parse("2026-11-08T12:00:00Z");
    const paused = { pausedUntil: now + 1000 };
    expect(select([{ version: "1.1.0" }], { settings: paused, now }).release).toBeNull();
    expect(
      select([{ version: "1.1.0" }], { settings: { pausedUntil: now - 1 }, now }).release,
    ).not.toBeNull();
    expect(
      select([{ version: "1.1.0", urgent: true }], { settings: paused, now }).release?.version,
    ).toBe("1.1.0");

    expect(select([{ version: "1.1.0", rollout: 50 }], { bucket: 50 }).release).toBeNull();
    expect(select([{ version: "1.1.0", rollout: 51 }], { bucket: 50 }).release).not.toBeNull();
    expect(select([{ version: "1.1.0", rollout: 0, urgent: true }]).release).not.toBeNull();
    // « Mettre à jour maintenant » does not wait for the rollout.
    expect(select([{ version: "1.1.0", rollout: 0 }], { manual: true }).release).not.toBeNull();
  });

  it("stays on the newest compatible release and reports the newer one", () => {
    const result = select([{ version: "1.1.0" }, { version: "1.2.0", minEnvironment: 2 }]);
    expect(result.release?.version).toBe("1.1.0");
    expect(result.environmentOutdated).toEqual({ version: "1.2.0", requires: 2 });
    expect(select([{ version: "1.1.0" }]).environmentOutdated).toBeNull();
  });

  it("goes through a relay when the current version is too old for the newest", () => {
    const releases = [{ version: "1.5.0" }, { version: "2.0.0", minFrom: "1.5.0" }];
    expect(select(releases).release?.version).toBe("1.5.0");
    expect(select(releases, { current: "1.5.0" }).release?.version).toBe("2.0.0");
  });

  it("installs the newest release when nothing runs yet", () => {
    expect(select([{ version: "1.1.0" }], { current: null }).release?.version).toBe("1.1.0");
  });
});

describe("parseManifest", () => {
  it("refuses an invalid manifest, in French", () => {
    expect(() => parseManifest({ schema: 2, releases: [] })).toThrow(
      /Manifeste des versions invalide/,
    );
    expect(() =>
      parseManifest({ schema: 1, releases: [{ version: "v1", publishedAt: "x", packages: {} }] }),
    ).toThrow(/releases\.0\.version/);
  });
});

describe("isInMaintenanceWindow", () => {
  const at = (hours: number, minutes = 0) => new Date(2026, 10, 8, hours, minutes);

  it("includes the start and excludes the end", () => {
    const window = { start: "03:00", end: "05:00" };
    expect(isInMaintenanceWindow(at(2, 59), window)).toBe(false);
    expect(isInMaintenanceWindow(at(3), window)).toBe(true);
    expect(isInMaintenanceWindow(at(4, 59), window)).toBe(true);
    expect(isInMaintenanceWindow(at(5), window)).toBe(false);
  });

  it("crosses midnight, and equal bounds mean the whole day", () => {
    const window = { start: "23:00", end: "02:00" };
    expect(isInMaintenanceWindow(at(23, 30), window)).toBe(true);
    expect(isInMaintenanceWindow(at(1), window)).toBe(true);
    expect(isInMaintenanceWindow(at(12), window)).toBe(false);
    expect(isInMaintenanceWindow(at(12), { start: "00:00", end: "00:00" })).toBe(true);
  });
});
