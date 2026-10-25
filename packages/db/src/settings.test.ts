import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDatabase, type Database, type StoredJson, settings } from "./index.js";

let db: Database;

beforeEach(() => {
  db = createTestDatabase();
});

afterEach(() => {
  db.$client.close();
  vi.useRealTimers();
});

function readSetting(key: string): StoredJson | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

/** Inserts the setting, or replaces its value when the key already exists. */
function writeSetting(key: string, value: StoredJson): void {
  db.insert(settings)
    .values({ key, value })
    .onConflictDoUpdate({ target: settings.key, set: { value } })
    .run();
}

describe("settings CRUD", () => {
  it.each<[string, StoredJson]>([
    ["an object", { name: "US Exemple", sports: ["rugby", "football"], founded: 1923 }],
    ["an array", ["#0055a4", "#ffffff", "#ef4135"]],
    ["a string", "US Exemple"],
    ["an empty string", ""],
    ["a number", 42.5],
    ["zero", 0],
    ["true", true],
    ["false", false],
    ["an object holding null", { logo: null }],
  ])("stores and reads back %s", (_label, value) => {
    db.insert(settings).values({ key: "club", value }).run();
    expect(readSetting("club")).toEqual(value);
  });

  it("returns nothing for a missing key", () => {
    expect(readSetting("inconnu")).toBeUndefined();
  });

  it("lists every setting", () => {
    writeSetting("club.name", "US Exemple");
    writeSetting("theme", { primary: "#0055a4" });
    const rows = db.select({ key: settings.key }).from(settings).orderBy(settings.key).all();
    expect(rows).toEqual([{ key: "club.name" }, { key: "theme" }]);
  });

  it("updates a value and bumps updated_at", () => {
    db.insert(settings)
      .values({ key: "theme", value: { primary: "#0055a4" } })
      .run();
    const created = db.select().from(settings).get();
    const later = new Date((created?.updatedAt.getTime() ?? 0) + 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(later);

    db.update(settings)
      .set({ value: { primary: "#ef4135" } })
      .where(eq(settings.key, "theme"))
      .run();

    expect(db.select().from(settings).get()).toEqual({
      key: "theme",
      value: { primary: "#ef4135" },
      updatedAt: later,
    });
  });

  it("upserts a value", () => {
    writeSetting("club.name", "US Exemple");
    writeSetting("club.name", "Union Sportive Exemple");
    expect(readSetting("club.name")).toBe("Union Sportive Exemple");
    expect(db.get(sql`select count(*) as count from ${settings}`)).toEqual({ count: 1 });
  });

  it("deletes a value", () => {
    writeSetting("club.name", "US Exemple");
    writeSetting("theme", { primary: "#0055a4" });
    db.delete(settings).where(eq(settings.key, "club.name")).run();
    expect(readSetting("club.name")).toBeUndefined();
    expect(readSetting("theme")).toEqual({ primary: "#0055a4" });
  });
});

describe("settings constraints", () => {
  it("refuses a second row with the same key", () => {
    db.insert(settings).values({ key: "club.name", value: "US Exemple" }).run();
    expect(() => db.insert(settings).values({ key: "club.name", value: "Autre" }).run()).toThrow(
      expect.objectContaining({ code: "SQLITE_CONSTRAINT_PRIMARYKEY" }),
    );
    expect(readSetting("club.name")).toBe("US Exemple");
  });

  it("refuses a missing value", () => {
    expect(() =>
      db.$client.prepare("INSERT INTO settings (key, value) VALUES (?, NULL)").run("club.name"),
    ).toThrow(/NOT NULL constraint failed: settings.value/);
  });
});
