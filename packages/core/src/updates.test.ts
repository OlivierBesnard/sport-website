import { describe, expect, it } from "vitest";
import {
  DEFAULT_UPDATE_SETTINGS,
  supervisorStateSchema,
  updateRequestSchema,
  updateSettingsSchema,
} from "./updates.js";

describe("update settings", () => {
  it("default to automatic, stable, 3 h to 5 h, no pause", () => {
    expect(DEFAULT_UPDATE_SETTINGS).toEqual({
      policy: "automatic",
      channel: "stable",
      window: { start: "03:00", end: "05:00" },
      pausedUntil: null,
    });
  });

  it("refuse unknown policies and malformed hours", () => {
    expect(updateSettingsSchema.safeParse({ policy: "jamais" }).success).toBe(false);
    expect(
      updateSettingsSchema.safeParse({ window: { start: "3:00", end: "05:00" } }).success,
    ).toBe(false);
    expect(
      updateSettingsSchema.safeParse({ window: { start: "23:00", end: "02:30" } }).success,
    ).toBe(true);
  });

  it("describe requests and the supervisor's state", () => {
    expect(updateRequestSchema.safeParse({ action: "rollback", requestedAt: 1 }).success).toBe(
      true,
    );
    expect(updateRequestSchema.safeParse({ action: "reinstall", requestedAt: 1 }).success).toBe(
      false,
    );
    expect(supervisorStateSchema.safeParse({ current: "1.0.0" }).success).toBe(false);
  });
});
