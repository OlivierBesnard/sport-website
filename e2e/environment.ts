import { rmSync } from "node:fs";
import { join } from "node:path";

/**
 * Environment of the end-to-end tests, shared by the config and the tests. Everything stays
 * side-effect free except {@link resetDataDir}, called by the config: Playwright evaluates the
 * config file several times per run (main process, test workers), so a random temp directory
 * would disagree from one evaluation to another and the reset must run exactly once.
 */

/** Port of the instance under test. */
export const PORT = 4180;
/** Base URL of the instance under test. */
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/**
 * Data directory of the instance under test. Deterministic (see above), relative to the
 * directory the tests run from, like the data of a normal instance; ignored by Git.
 */
export const DATA_DIR = join(process.cwd(), ".playwright-data");

/**
 * Wipes the data of the previous run, once per process and never from a test worker (the
 * server holds the files open): the first evaluation of the config, before the server starts.
 */
export function resetDataDir(): void {
  if (process.env.TEST_WORKER_INDEX !== undefined) {
    return;
  }
  const flag = "__sport_cms_e2e_data_reset";
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[flag] === true) {
    return;
  }
  scope[flag] = true;
  rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
