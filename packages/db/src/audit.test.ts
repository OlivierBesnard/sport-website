import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { auditLog, createTestDatabase, writeAudit } from "./index.js";

describe("writeAudit", () => {
  it("stores an entry with its details as JSON and its date", () => {
    const db = createTestDatabase();
    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      const now = new Date("2026-03-15T12:00:00.000Z");
      vi.setSystemTime(now);

      const row = writeAudit(db, {
        actorId: "user-1",
        action: "setup.completed",
        targetType: "instance",
        targetId: "self",
        details: { clubName: "US Exemple", sports: ["rugby"] },
      });

      expect(row).toEqual({
        id: 1,
        actorId: "user-1",
        action: "setup.completed",
        targetType: "instance",
        targetId: "self",
        details: { clubName: "US Exemple", sports: ["rugby"] },
        createdAt: now,
      });
      expect(db.$client.prepare("SELECT details FROM audit_log").pluck().get()).toBe(
        JSON.stringify({ clubName: "US Exemple", sports: ["rugby"] }),
      );
      vi.useRealTimers();
    } finally {
      db.$client.close();
    }
  });

  it("defaults the details to an empty object", () => {
    const db = createTestDatabase();
    try {
      const row = writeAudit(db, { action: "auth.sign_in_failed" });
      expect(row.details).toEqual({});
      expect(row.actorId).toBeNull();
      expect(row.targetType).toBeNull();
    } finally {
      db.$client.close();
    }
  });

  it("keeps the actor of a deleted account: no foreign key on actor_id", () => {
    const db = createTestDatabase();
    try {
      writeAudit(db, { actorId: "supprimé", action: "setup.completed" });
      expect(db.select().from(auditLog).where(eq(auditLog.actorId, "supprimé")).all()).toHaveLength(
        1,
      );
    } finally {
      db.$client.close();
    }
  });
});
