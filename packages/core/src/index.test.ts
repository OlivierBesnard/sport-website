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
      "EVENT_TYPE_PATTERN",
      "MAX_MATCHES_PER_QUERY",
      "ROLES",
      "ROLE_PERMISSIONS",
      "TEAM_GENDERS",
      "TEAM_GENDER_LABELS",
      "TIME_OF_DAY_PATTERN",
      "WEEKDAYS",
      "can",
      "encodePagePath",
      "isDay",
      "normalizePagePath",
      "parseEventSelector",
      "selectsEvent",
      "slugify",
      "weekdayLabel",
    ]);
    expect(root).not.toHaveProperty("parseRuntimeConfig");
  });

  it("gives the version of the CMS in semver form", () => {
    expect(root.CMS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
