import { describe, expect, it } from "vitest";
import * as root from "./index.js";

describe("root entry of @sport-cms/core", () => {
  it("exports the domain helpers and the roles, but no Node.js built-ins", () => {
    expect(Object.keys(root).sort()).toEqual([
      "CALENDAR_EVENT_KINDS",
      "CALENDAR_EVENT_KIND_LABELS",
      "CMS_VERSION",
      "CORE_PERMISSIONS",
      "DAY_PATTERN",
      "DEFAULT_UPDATE_SETTINGS",
      "EVENT_TYPE_PATTERN",
      "MANUAL_UPDATE_WARNING_MS",
      "MAX_MATCHES_PER_QUERY",
      "MAX_POSTS_PER_QUERY",
      "MAX_UPDATE_HISTORY",
      "MAX_UPDATE_PAUSE_MS",
      "MEDIA_RIGHTS",
      "MEDIA_RIGHTS_LABELS",
      "PARTNER_LEVELS",
      "PARTNER_LEVEL_LABELS",
      "POSTS_PATH_PREFIX",
      "ROLES",
      "ROLE_PERMISSIONS",
      "SLUG_PATTERN",
      "SUPERVISOR_STATE_FILE",
      "TEAM_GENDERS",
      "TEAM_GENDER_LABELS",
      "TIME_OF_DAY_PATTERN",
      "UPDATES_DIRECTORY",
      "UPDATE_ACTIONS",
      "UPDATE_CHANNELS",
      "UPDATE_CHANNEL_LABELS",
      "UPDATE_OUTCOMES",
      "UPDATE_POLICIES",
      "UPDATE_POLICY_LABELS",
      "UPDATE_REQUEST_FILE",
      "UPDATE_SETTINGS_FILE",
      "WEEKDAYS",
      "can",
      "encodePagePath",
      "isDay",
      "isPublicMedia",
      "normalizePagePath",
      "parseEventSelector",
      "postPath",
      "selectsEvent",
      "slugify",
      "supervisorStateSchema",
      "updateRequestSchema",
      "updateSettingsSchema",
      "weekdayLabel",
    ]);
    expect(root).not.toHaveProperty("parseRuntimeConfig");
  });

  it("gives the version of the CMS in semver form", () => {
    // Written by `pnpm release`: a release (1.4.0) or a beta (1.5.0-beta.1).
    expect(root.CMS_VERSION).toMatch(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  });
});
