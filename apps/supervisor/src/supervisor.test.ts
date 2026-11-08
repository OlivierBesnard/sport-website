import type { KeyObject } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { SupervisorState, UpdateSettings } from "@sport-cms/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SupervisorProxy } from "./proxy.js";
import { Supervisor } from "./supervisor.js";
import {
  buildFakePackage,
  freePort,
  generateReleaseKeys,
  type ManifestRelease,
  ReleaseServer,
  writeFakeApp,
} from "./testing.js";

/**
 * Acceptance of E12: a local release server, fake versions of the application (real child
 * processes), the supervisor and its proxy for real.
 */

const keys = generateReleaseKeys();
const otherKeys = generateReleaseKeys();

const WHOLE_DAY: UpdateSettings = {
  policy: "automatic",
  channel: "stable",
  window: { start: "00:00", end: "00:00" },
  pausedUntil: null,
};

let dataDir: string;
let releases: ReleaseServer;
let supervisor: Supervisor | undefined;
let server: Server | undefined;
let publicPort: number;

beforeEach(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "sport-cms-supervisor-"));
  releases = new ReleaseServer();
  await releases.start();
  await writeFakeApp(join(dataDir, "bundled"), { version: "1.0.0" });
  await writeFile(join(dataDir, "database.sqlite"), "base de la version 1.0.0");
});

afterEach(async () => {
  await supervisor?.stop();
  supervisor = undefined;
  await new Promise((resolve) =>
    server === undefined ? resolve(undefined) : server.close(resolve),
  );
  server = undefined;
  await releases.stop();
  await rm(dataDir, { recursive: true, force: true, maxRetries: 5 });
});

async function writeSettings(settings: UpdateSettings): Promise<void> {
  await writeFile(join(dataDir, "updates", "settings.json"), JSON.stringify(settings));
}

async function startSupervisor(
  trustedKeys: readonly KeyObject[] = [keys.publicKey],
  options: { now?: () => number } = {},
): Promise<Supervisor> {
  const proxy = new SupervisorProxy();
  const created = new Supervisor({
    dataDir,
    appPort: await freePort(),
    manifestUrl: releases.manifestUrl,
    trustedKeys,
    appEnv: {},
    bundledApp: join(dataDir, "bundled"),
    proxy,
    appOutput: new PassThrough().resume(),
    healthTimeoutMs: 2000,
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    ...options,
  });
  supervisor = created;
  publicPort = await freePort();
  server = proxy.createServer();
  await new Promise<void>((resolve) => server?.listen(publicPort, "127.0.0.1", resolve));
  await created.start();
  return created;
}

async function home(headers: Record<string, string> = {}): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${publicPort}/`, { headers });
  return response.text();
}

async function starts(): Promise<string[]> {
  return (await readFile(join(dataDir, "starts.log"), "utf8")).trim().split("\n");
}

async function release(
  version: string,
  options: Partial<Omit<ManifestRelease, "package">> & { broken?: boolean } = {},
): Promise<ManifestRelease> {
  const { broken, ...rest } = options;
  return {
    package: await buildFakePackage({ version, ...(broken === undefined ? {} : { broken }) }),
    privateKey: keys.privateKey,
    ...rest,
  };
}

async function versionsOnDisk(): Promise<string[]> {
  return (await readdir(join(dataDir, "app"))).filter((name) => !name.startsWith(".")).sort();
}

describe("supervisor", { timeout: 30_000 }, () => {
  it("installs the shipped version, then updates to a new release in the window", async () => {
    const started = await startSupervisor();
    expect(started.running).toBe("1.0.0");
    expect(await home()).toContain("Version 1.0.0");

    await writeSettings(WHOLE_DAY);
    releases.publish([await release("1.1.0")]);
    await started.tick();

    expect(started.running).toBe("1.1.0");
    expect(await home()).toContain("Version 1.1.0");
    const state = started.state;
    expect(state).toMatchObject({
      current: "1.1.0",
      previous: "1.0.0",
      available: null,
      pending: null,
      failed: [],
      lastError: null,
    });
    expect(state.history[0]).toMatchObject({ from: "1.0.0", to: "1.1.0", outcome: "installed" });
    expect(state.history[0]?.notes).toBe("Notes de la version 1.1.0");
    expect(await versionsOnDisk()).toEqual(["1.0.0", "1.1.0"]);
    // The database was copied before the new version started.
    const backups = await readdir(join(dataDir, "backups", "pre-update"));
    expect(backups).toHaveLength(1);
    expect(backups[0]).toMatch(/-1\.0\.0-to-1\.1\.0$/);
    expect(
      await readFile(
        join(dataDir, "backups", "pre-update", backups[0] ?? "", "database.sqlite"),
        "utf8",
      ),
    ).toBe("base de la version 1.0.0");
    // What the supervisor wrote is what the back-office reads.
    const written = JSON.parse(
      await readFile(join(dataDir, "updates", "state.json"), "utf8"),
    ) as SupervisorState;
    expect(written.current).toBe("1.1.0");
  });

  it("goes back to the previous version when the health check fails, and never retries it", async () => {
    const started = await startSupervisor();
    await writeSettings(WHOLE_DAY);
    releases.publish([await release("1.1.0", { broken: true })]);
    await started.tick();

    expect(started.running).toBe("1.0.0");
    expect(await home()).toContain("Version 1.0.0");
    const state = started.state;
    expect(state).toMatchObject({ current: "1.0.0", failed: ["1.1.0"], pending: null });
    expect(state.history[0]).toMatchObject({ from: "1.0.0", to: "1.1.0", outcome: "rolled_back" });
    expect(state.history[0]?.reason).toContain("503");
    expect(await starts()).toEqual(["1.0.0", "1.1.0", "1.0.0"]);

    // Marked « à ne pas réessayer »: the next checks leave it alone.
    await started.check();
    await started.tick();
    expect(started.state.available).toBeNull();
    expect(await starts()).toEqual(["1.0.0", "1.1.0", "1.0.0"]);
    expect(await versionsOnDisk()).toEqual(["1.0.0"]);
  });

  it("touches nothing when the signature is invalid", async () => {
    const started = await startSupervisor();
    await writeSettings(WHOLE_DAY);
    releases.publish([{ ...(await release("1.1.0")), privateKey: otherKeys.privateKey }]);
    await started.tick();

    expect(started.running).toBe("1.0.0");
    expect(await home()).toContain("Version 1.0.0");
    expect(await versionsOnDisk()).toEqual(["1.0.0"]);
    expect(await readdir(join(dataDir, "app"))).toEqual(["1.0.0"]);
    expect(await starts()).toEqual(["1.0.0"]);
    expect(started.state).toMatchObject({ current: "1.0.0", failed: [], history: [] });
    expect(started.state.lastError).toBe(
      "La signature de la version 1.1.0 est invalide : le paquet a été ignoré.",
    );
    expect(started.state.available?.staged).toBe(false);
  });

  it("touches nothing when the bytes do not match the signed checksum", async () => {
    const started = await startSupervisor();
    await writeSettings(WHOLE_DAY);
    const tampered = await buildFakePackage({ version: "1.1.0", broken: true });
    releases.publish([{ ...(await release("1.1.0")), servedBytes: tampered.bytes }]);
    await started.tick();

    expect(started.running).toBe("1.0.0");
    expect(await readdir(join(dataDir, "app"))).toEqual(["1.0.0"]);
    expect(await starts()).toEqual(["1.0.0"]);
    expect(started.state.lastError).toContain("somme de contrôle");
  });

  it("downloads outside the window but waits for it, unless the release is urgent", async () => {
    const noon = new Date(2026, 10, 8, 12, 0).getTime();
    const started = await startSupervisor([keys.publicKey], { now: () => noon });
    await writeSettings({ ...WHOLE_DAY, window: { start: "03:00", end: "05:00" } });
    releases.publish([await release("1.1.0")]);
    await started.tick();
    expect(started.running).toBe("1.0.0");
    expect(started.state.available).toMatchObject({ version: "1.1.0", staged: true });

    releases.publish([await release("1.1.0"), await release("1.1.1", { urgent: true })]);
    await started.check();
    await started.tick();
    expect(started.running).toBe("1.1.1");
  });

  it("follows the club's settings: pause, manual policy, rollout", async () => {
    const started = await startSupervisor();
    releases.publish([await release("1.1.0")]);

    await writeSettings({ ...WHOLE_DAY, pausedUntil: Date.now() + 60_000 });
    await started.check();
    await started.tick();
    expect(started.state.available).toBeNull();

    await writeSettings({ ...WHOLE_DAY, policy: "manual" });
    await started.check();
    await started.tick();
    expect(started.running).toBe("1.0.0");

    await writeSettings(WHOLE_DAY);
    releases.publish([await release("1.1.0", { rollout: started.state.bucket })]);
    await started.check();
    expect(started.state.available).toBeNull();
    releases.publish([await release("1.1.0", { rollout: started.state.bucket + 1 })]);
    await started.check();
    await started.tick();
    expect(started.running).toBe("1.1.0");
  });

  it("updates and goes back on the back-office's requests", async () => {
    const started = await startSupervisor();
    await writeSettings({ ...WHOLE_DAY, policy: "manual" });
    releases.publish([await release("1.1.0")]);
    const request = join(dataDir, "updates", "request.json");

    await writeFile(request, JSON.stringify({ action: "update", requestedAt: Date.now() }));
    await started.tick();
    expect(started.running).toBe("1.1.0");
    await expect(stat(request)).rejects.toThrow();

    await writeFile(request, JSON.stringify({ action: "rollback", requestedAt: Date.now() }));
    await started.tick();
    expect(started.running).toBe("1.0.0");
    expect(started.state).toMatchObject({ current: "1.0.0", previous: null, failed: ["1.1.0"] });
    expect(started.state.history[0]).toMatchObject({ to: "1.0.0", outcome: "reverted" });
  });

  it("finishes, at the next start, an update interrupted by a power cut", async () => {
    const started = await startSupervisor();
    await writeSettings(WHOLE_DAY);
    releases.publish([await release("1.1.0")]);
    await started.check();
    await started.stop();
    supervisor = undefined;
    await new Promise((resolve) => server?.close(resolve));
    // The power went off right after the old version stopped and the backup was taken.
    const statePath = join(dataDir, "updates", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as SupervisorState;
    state.pending = {
      from: "1.0.0",
      to: "1.1.0",
      phase: "starting",
      reason: "update",
      startedAt: Date.now(),
    };
    await writeFile(statePath, JSON.stringify(state));
    // A half-extracted download was left behind too.
    await writeFakeApp(join(dataDir, "app", ".staging-1.2.0-abcdef"), { version: "1.2.0" });

    const restarted = await startSupervisor();
    expect(restarted.running).toBe("1.1.0");
    expect(restarted.state).toMatchObject({ current: "1.1.0", previous: "1.0.0", pending: null });
    expect(await readdir(join(dataDir, "app"))).toEqual(["1.0.0", "1.1.0"]);
  });

  it("starts the old version again when the power went off before the new one ran", async () => {
    const started = await startSupervisor();
    await started.stop();
    supervisor = undefined;
    await new Promise((resolve) => server?.close(resolve));
    const statePath = join(dataDir, "updates", "state.json");
    const state = JSON.parse(await readFile(statePath, "utf8")) as SupervisorState;
    state.pending = {
      from: "1.0.0",
      to: "1.1.0",
      phase: "stopping",
      reason: "update",
      startedAt: Date.now(),
    };
    await writeFile(statePath, JSON.stringify(state));

    const restarted = await startSupervisor();
    expect(restarted.running).toBe("1.0.0");
    expect(restarted.state.pending).toBeNull();
  });

  it("overwrites x-forwarded-for with the client's real address", async () => {
    await startSupervisor();
    const page = await home({ "x-forwarded-for": "203.0.113.9" });
    expect(page).not.toContain("203.0.113.9");
    expect(page).toMatch(/client (::ffff:)?127\.0\.0\.1/);
  });

  it("serves the kept pages while the application is down", async () => {
    const started = await startSupervisor();
    expect(await home()).toContain("Version 1.0.0");
    started.proxy.target = undefined;
    const kept = await fetch(`http://127.0.0.1:${publicPort}/`);
    expect(kept.status).toBe(200);
    expect(await kept.text()).toContain("Version 1.0.0");
    const unknown = await fetch(`http://127.0.0.1:${publicPort}/autre-page`);
    expect(unknown.status).toBe(503);
    expect(unknown.headers.get("retry-after")).toBe("10");
    expect(await unknown.text()).toContain("Site en cours de mise à jour");
  });

  it("disables the updates without any trusted key", async () => {
    const started = await startSupervisor([]);
    releases.publish([await release("1.1.0")]);
    await started.tick();
    expect(started.running).toBe("1.0.0");
    expect(started.state.lastError).toContain("Aucune clé de publication");
  });
});
