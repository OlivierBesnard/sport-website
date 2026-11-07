import { describe, expect, it } from "vitest";
import { CORE_PERMISSIONS, can, ROLE_PERMISSIONS, ROLES } from "./auth.js";

describe("roles", () => {
  it("holds the six roles of the plan, owner first", () => {
    expect(ROLES).toEqual(["owner", "admin", "editor", "treasurer", "coach", "member"]);
  });

  it("defines an entry for every role other than the owner, who can do anything", () => {
    expect(Object.hasOwn(ROLE_PERMISSIONS, "owner")).toBe(false);
    for (const role of ROLES) {
      if (role !== "owner") {
        expect(ROLE_PERMISSIONS[role]).toEqual(expect.any(Array));
      }
    }
  });
});

describe("can", () => {
  it("grants the owner everything, even a permission that no table knows", () => {
    for (const permission of [...CORE_PERMISSIONS, "compta.write", "future.thing"]) {
      expect(can({ role: "owner" }, permission)).toBe(true);
    }
  });

  it.each([
    ["admin", "pages.edit", true],
    ["admin", "users.manage", true],
    ["admin", "finance.manage", true],
    ["admin", "teams.own", true],
    ["admin", "sport.manage", true],
    ["admin", "settings.manage", false],
    ["admin", "modules.manage", false],
    ["editor", "pages.edit", true],
    ["editor", "teams.own", true],
    ["editor", "sport.manage", true],
    ["editor", "users.manage", false],
    ["editor", "settings.manage", false],
    ["treasurer", "finance.manage", true],
    ["treasurer", "pages.edit", false],
    ["coach", "teams.own", true],
    ["coach", "pages.edit", false],
    ["coach", "sport.manage", false],
    ["treasurer", "sport.manage", false],
    ["member", "pages.edit", false],
    ["member", "teams.own", false],
    ["member", "finance.manage", false],
  ] as const)("grants %s %s: %s", (role, permission, granted) => {
    expect(can({ role }, permission)).toBe(granted);
  });

  it("grants nothing to a missing role", () => {
    for (const permission of CORE_PERMISSIONS) {
      expect(can({ role: undefined }, permission)).toBe(false);
      expect(can({ role: null }, permission)).toBe(false);
    }
    // A role unknown to the matrix (an old value in the database, for instance).
    expect(can({ role: "inconnu" as never }, "pages.edit")).toBe(false);
  });
});
