import { z } from "zod";
import { TIME_OF_DAY_PATTERN } from "./sport.js";

/**
 * Automatic updates (PLAN §6.8): the formats the instance and its supervisor share. They talk
 * through three JSON files of `DATA_DIR/updates/`, so that neither has to reach the other's
 * process or database, and a restart of either loses nothing:
 *
 * - `settings.json`: the club's choices, written by the instance (back-office), read by the
 *   supervisor at each check;
 * - `request.json`: an action asked from the back-office (update now, go back), written by the
 *   instance and removed by the supervisor once handled;
 * - `state.json`: what the supervisor did (versions, history, failures), written by it alone and
 *   shown by the back-office.
 */

/** Directory of `DATA_DIR` holding the files above. */
export const UPDATES_DIRECTORY = "updates";
export const UPDATE_SETTINGS_FILE = "settings.json";
export const UPDATE_REQUEST_FILE = "request.json";
export const SUPERVISOR_STATE_FILE = "state.json";

export const UPDATE_POLICIES = ["automatic", "automatic-minor", "manual"] as const;
export type UpdatePolicy = (typeof UPDATE_POLICIES)[number];
export const UPDATE_POLICY_LABELS: Readonly<Record<UpdatePolicy, string>> = {
  automatic: "Automatique",
  "automatic-minor": "Automatique, sauf les versions majeures",
  manual: "Manuelle (déconseillé)",
};

export const UPDATE_CHANNELS = ["stable", "beta"] as const;
export type UpdateChannel = (typeof UPDATE_CHANNELS)[number];
export const UPDATE_CHANNEL_LABELS: Readonly<Record<UpdateChannel, string>> = {
  stable: "Stable",
  beta: "Bêta (versions de test)",
};

/** Longest pause a club can ask for; urgent security fixes ignore it. */
export const MAX_UPDATE_PAUSE_MS = 14 * 24 * 60 * 60 * 1000;

/** With the manual policy, the back-office warns once an available version waits this long. */
export const MANUAL_UPDATE_WARNING_MS = 30 * 24 * 60 * 60 * 1000;

const timeOfDay = z.string().regex(TIME_OF_DAY_PATTERN, "Heure attendue au format HH:MM.");

export const updateSettingsSchema = z.object({
  policy: z.enum(UPDATE_POLICIES).default("automatic"),
  channel: z.enum(UPDATE_CHANNELS).default("stable"),
  /**
   * Maintenance window, server time; `end` before `start` crosses midnight (`23:00`–`02:00`).
   * Equal bounds mean the whole day.
   */
  window: z.object({ start: timeOfDay, end: timeOfDay }).default({ start: "03:00", end: "05:00" }),
  /** No automatic update before this instant (ms since the epoch), urgent fixes excepted. */
  pausedUntil: z.number().int().nonnegative().nullable().default(null),
});

export type UpdateSettings = z.infer<typeof updateSettingsSchema>;

export const DEFAULT_UPDATE_SETTINGS: UpdateSettings = Object.freeze(
  updateSettingsSchema.parse({}),
);

export const UPDATE_ACTIONS = ["update", "rollback"] as const;
export type UpdateAction = (typeof UPDATE_ACTIONS)[number];

export const updateRequestSchema = z.object({
  action: z.enum(UPDATE_ACTIONS),
  requestedAt: z.number().int().nonnegative(),
});

export type UpdateRequest = z.infer<typeof updateRequestSchema>;

export const UPDATE_OUTCOMES = ["installed", "rolled_back", "reverted"] as const;
/**
 * - `installed`: the new version passed its health check;
 * - `rolled_back`: it failed it, the previous version runs again and the new one is never retried;
 * - `reverted`: the club went back to the previous version from the back-office.
 */
export type UpdateOutcome = (typeof UPDATE_OUTCOMES)[number];

const version = z.string().min(1).max(64);

export const supervisorStateSchema = z.object({
  /** Version running (`null` before the first one is installed). */
  current: version.nullable(),
  /** Version kept for a rollback. */
  previous: version.nullable(),
  /** Version of the environment (Docker image) the supervisor runs in. */
  environment: z.number().int().nonnegative(),
  /**
   * Number drawn once, between 0 and 99: a version published to N % of the instances is only
   * installed by those whose number is below N (progressive rollout, without a central server).
   */
  bucket: z.number().int().min(0).max(99),
  /** Versions never installed again: failed health check, or left by the club. */
  failed: z.array(version),
  /** Newest version the club could install, once downloaded and verified. */
  available: z
    .object({
      version,
      urgent: z.boolean(),
      notes: z.string(),
      publishedAt: z.number().int().nonnegative(),
      /** Downloaded, signature and checksum verified, ready to switch to. */
      staged: z.boolean(),
    })
    .nullable(),
  /** A newer version exists but needs a newer environment: the host must redeploy the image. */
  environmentOutdated: z.object({ version, requires: z.number().int().nonnegative() }).nullable(),
  /** Update in progress (left there by a power cut, it is finished or undone at the next start). */
  pending: z
    .object({
      from: version.nullable(),
      to: version,
      phase: z.enum(["stopping", "starting"]),
      reason: z.enum(["update", "rollback"]),
      startedAt: z.number().int().nonnegative(),
    })
    .nullable(),
  history: z.array(
    z.object({
      from: version.nullable(),
      to: version,
      at: z.number().int().nonnegative(),
      outcome: z.enum(UPDATE_OUTCOMES),
      /** Why the health check failed, in French. */
      reason: z.string().optional(),
      notes: z.string().optional(),
    }),
  ),
  lastCheckAt: z.number().int().nonnegative().nullable(),
  /** Last problem met while checking or downloading, in French (`null` once a check succeeds). */
  lastError: z.string().nullable(),
});

export type SupervisorState = z.infer<typeof supervisorStateSchema>;

/** Number of history entries kept in `state.json`. */
export const MAX_UPDATE_HISTORY = 50;
