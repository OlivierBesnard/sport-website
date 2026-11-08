import type { UpdateSettings } from "@sport-cms/core";
import semver from "semver";
import type { Manifest, Release } from "./manifest.js";

export interface SelectionInput {
  readonly manifest: Manifest;
  /** Version running (`null`: none yet). */
  readonly current: string | null;
  readonly settings: UpdateSettings;
  /** Version of the environment the supervisor runs in. */
  readonly environment: number;
  /** Platform of the packages, `<platform>-<arch>`. */
  readonly platform: string;
  /** Rollout number of the instance, 0 to 99. */
  readonly bucket: number;
  /** Versions never installed again. */
  readonly failed: readonly string[];
  readonly now: number;
  /**
   * Asked from the back-office (« Mettre à jour maintenant »): the policy, the pause and the
   * rollout no longer hold the update back. Channel, withdrawals, failures and compatibility
   * still do.
   */
  readonly manual?: boolean;
}

export interface Selection {
  /** Release to install, the newest one allowed; `null`: nothing to do. */
  readonly release: Release | null;
  /** Newest release held back because the environment is too old (the host must redeploy). */
  readonly environmentOutdated: { readonly version: string; readonly requires: number } | null;
}

/**
 * Which release the instance should install, if any (PLAN §6.8): channel (`stable` ignores
 * pre-releases), withdrawn and failed versions, newer than the current one, reachable directly
 * from it (`minFrom`: an older instance goes through the newest release it may reach), policy
 * (manual: nothing; automatic-minor: no new major), pause and progressive rollout (both skipped
 * by urgent fixes), then the environment: an instance stays on the newest compatible release.
 */
export function selectRelease(input: SelectionInput): Selection {
  const { manifest, current, settings, manual = false } = input;
  const withdrawn = new Set(manifest.withdrawn);
  const failed = new Set(input.failed);
  const paused = settings.pausedUntil !== null && settings.pausedUntil > input.now;

  const candidates = manifest.releases
    .filter((release) => {
      if (release.packages[input.platform] === undefined) {
        return false;
      }
      if (withdrawn.has(release.version) || failed.has(release.version)) {
        return false;
      }
      if (settings.channel === "stable" && semver.prerelease(release.version) !== null) {
        return false;
      }
      if (current !== null) {
        if (!semver.gt(release.version, current)) {
          return false;
        }
        if (release.minFrom !== undefined && semver.lt(current, release.minFrom)) {
          return false;
        }
      }
      if (manual) {
        return true;
      }
      if (settings.policy === "manual") {
        return false;
      }
      if (
        settings.policy === "automatic-minor" &&
        current !== null &&
        semver.major(release.version) > semver.major(current)
      ) {
        return false;
      }
      if (release.urgent) {
        return true;
      }
      return !paused && input.bucket < release.rollout;
    })
    .sort((a, b) => semver.rcompare(a.version, b.version));

  const release = candidates.find((candidate) => candidate.minEnvironment <= input.environment);
  const newest = candidates[0];
  const environmentOutdated =
    newest !== undefined && newest !== release
      ? { version: newest.version, requires: newest.minEnvironment }
      : null;
  return { release: release ?? null, environmentOutdated };
}

/** Minutes since midnight of `HH:MM`. */
function minutesOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

/**
 * `true` when `now` (server time) falls in the maintenance window. The end is excluded, a window
 * whose end comes before its start crosses midnight, and equal bounds mean the whole day.
 */
export function isInMaintenanceWindow(now: Date, window: UpdateSettings["window"]): boolean {
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);
  const minute = now.getHours() * 60 + now.getMinutes();
  if (start === end) {
    return true;
  }
  return start < end ? minute >= start && minute < end : minute >= start || minute < end;
}
