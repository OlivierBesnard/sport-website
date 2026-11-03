import { randomBytes } from "node:crypto";
import { defineConfig } from "@playwright/test";
import { BASE_URL, DATA_DIR, PORT, resetDataDir } from "./e2e/environment.js";

// Fresh data for every run; the config file being evaluated several times per run, this runs
// once, in the main process, before the server starts (see e2e/environment.ts).
resetDataDir();

/**
 * End-to-end tests against the compiled server (`apps/server/dist/main.js`), built first by
 * the `test:e2e` script, serving the built back-office under `/admin`. The environment of the
 * instance is set here (`env` of the web server), never inline in a shell command: `DATA_DIR`
 * is reset for the run and `SECRET_KEY` is generated at runtime, never written down.
 */
export default defineConfig({
  testDir: "e2e",
  // The tests share one instance and run in order: the setup first, then its refusals.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 30_000,
  expect: { timeout: 5_000 },
  reporter: [["list"]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: "node apps/server/dist/main.js",
    url: `${BASE_URL}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: {
      ...process.env,
      DATA_DIR,
      PORT: String(PORT),
      BASE_URL,
      SECRET_KEY: randomBytes(32).toString("base64"),
    },
  },
  projects: [
    // If the download of Chromium fails, use the Edge installed on Windows instead:
    // `channel: "msedge"` in this project (documented in CLAUDE.md).
    { name: "chromium", use: { channel: "chromium" } },
  ],
});
