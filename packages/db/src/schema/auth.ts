import { ROLES, type Role } from "@sport-cms/core";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createdAt, timestamp, updatedAt } from "./columns.js";

/*
 * Tables of Better Auth (email + password authentication). The field names of the core schema
 * (`user`, `session`, `account`, `verification`) are mandatory: the Better Auth Drizzle adapter
 * maps them by Drizzle property name. The rows get random text ids from Better Auth. Dates are
 * stored like everywhere else (epoch milliseconds), set by Drizzle (`createdAt()`/`updatedAt()`
 * fill them from the application clock when Better Auth does not).
 *
 * - `account` holds one authentication method per row; the email + password one is
 *   `providerId: "credential"`, with the password hash in `password`.
 * - `verification` stores short-lived values (email verification, password reset).
 * - `user.role` is an additional field of the Better Auth user (`input: false`, filled with
 *   "member" on account creation, then owned by the application).
 */

/** Accounts of the instance: back-office users, with their role. */
export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).notNull().default(false),
  image: text("image"),
  role: text("role", { enum: ROLES }).notNull().default("member").$type<Role>(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** One session per signed-in browser: the cookie holds `token`, signed by Better Auth. */
export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Identifier carried by the session cookie. */
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

/** Authentication methods of a user; deleting the user deletes its methods. */
export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Provider-side identity: `"credential"` and the user id for email + password. */
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    /** Password hash, for the `credential` provider only. */
    password: text("password"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

/** Short-lived values (email verification, password reset), deleted by Better Auth. */
export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);
