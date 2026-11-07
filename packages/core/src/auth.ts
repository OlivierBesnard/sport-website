/**
 * Roles and permissions of the accounts of an instance (PLAN §2.2). Shared by the server
 * (middlewares, setup) and, later, by the back-office interface: this module must stay free of
 * Node.js built-ins, as it is exported from the root entry, usable in the browser.
 */

/** Account roles, from the most to the least privileged. The role is stored on every user. */
export const ROLES = ["owner", "admin", "editor", "treasurer", "coach", "member"] as const;

export type Role = (typeof ROLES)[number];

/** A permission of the core or of a module, as a simple string (e.g. `pages.edit`). */
export type Permission = string;

/** Permissions the core defines; modules declare their own with their manifest. */
export const CORE_PERMISSIONS = [
  "pages.edit",
  "settings.manage",
  "users.manage",
  "modules.manage",
  "finance.manage",
  "sport.manage",
  "teams.own",
] as const satisfies readonly Permission[];

/**
 * Permissions held by each role, other than the owner's, who can do anything (PLAN §2.2):
 * the owner manages the technical settings, the modules, the backups and the users.
 *
 * Sports content (PLAN §3.3): `sport.manage` edits all of it (seasons, sections, venues, teams,
 * calendar); `teams.own` only the teams assigned to the account (`team_assignments`) — their
 * description, training times and calendar, results included.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Exclude<Role, "owner">, readonly Permission[]>> = {
  // Everything except the technical settings (`settings.manage`, `modules.manage`).
  admin: ["pages.edit", "users.manage", "finance.manage", "sport.manage", "teams.own"],
  editor: ["pages.edit", "sport.manage", "teams.own"],
  treasurer: ["finance.manage"],
  coach: ["teams.own"],
  member: [],
};

/** Minimum the permission check needs of a user: just the role stored on the account. */
export type RoleHolder = { readonly role: Role | null | undefined };

/** Whether a user holding `role` is granted `permission`. The owner is granted everything. */
export function can(user: RoleHolder, permission: Permission): boolean {
  if (user.role === "owner") {
    return true;
  }
  const granted =
    user.role === undefined || user.role === null ? undefined : ROLE_PERMISSIONS[user.role];
  return granted?.includes(permission) ?? false;
}
