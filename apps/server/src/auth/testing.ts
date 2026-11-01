import { createSecretKey, type KeyObject, randomBytes } from "node:crypto";
import type { Role } from "@sport-cms/core";
import {
  createTestDatabase,
  type Database,
  user as userTable,
  type writeAudit,
} from "@sport-cms/db";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { type Mock, vi } from "vitest";
import { type AppDependencies, createApp, type Logger } from "../app.js";
import { type Auth, createAuth } from "./create-auth.js";
import { type AuthLimits, authRoutes, DEFAULT_AUTH_LIMITS } from "./routes.js";

/**
 * Test helpers for the auth API (excluded from the build, imported by the tests only). No
 * secret is written anywhere: a fresh 256-bit key is generated for every harness.
 */

/** `http://`, so the session cookie is not `__Secure-`-prefixed. */
export const BASE_URL = "http://localhost:3000";

export interface AuthHarnessOptions {
  readonly baseUrl?: string;
  readonly limits?: Partial<AuthLimits>;
  /** Writer of the audit entry of the setup, to fail an installation halfway (a test). */
  readonly audit?: typeof writeAudit;
}

export interface AuthHarness {
  readonly db: Database;
  readonly auth: Auth;
  readonly logger: { error: Mock<Logger["error"]> };
  readonly secretKey: KeyObject;
  /** The full instance application, with the auth routes registered. */
  readonly app: (overrides?: Partial<AppDependencies>) => Hono;
  /** Creates an account of the given role via Better Auth, to sign in with `email`. */
  readonly createUser: (role: Role) => Promise<{ id: string; email: string }>;
  /** Signs in and returns the value of the session cookie, to send in `Cookie`. */
  readonly signIn: (email: string, password: string) => Promise<string>;
}

/** A minimal owner request body for `POST /api/setup`. */
export function setupBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    club: {
      name: "US Exemple",
      sports: ["rugby", "football"],
      colors: { primary: "#0b5cad", secondary: "#ffffff" },
    },
    owner: {
      name: "Jeanne Dupont",
      email: "jeanne@monclub.example",
      password: "mot-de-passe-2026",
    },
    ...overrides,
  };
}

export function createAuthHarness(options: AuthHarnessOptions = {}): AuthHarness {
  const baseUrl = options.baseUrl ?? BASE_URL;
  const db = createTestDatabase();
  const logger = { error: vi.fn<Logger["error"]>() };
  const secretKey = createSecretKey(randomBytes(32));
  const auth = createAuth({ db, baseUrl, secretKey, logger });
  const limits: AuthLimits = {
    signIn: options.limits?.signIn ?? DEFAULT_AUTH_LIMITS.signIn,
    setup: options.limits?.setup ?? DEFAULT_AUTH_LIMITS.setup,
  };
  // One routes function per harness: its rate limiters count across the app() calls.
  const routes = authRoutes({ auth, db, logger, limits, audit: options.audit });

  const harness: AuthHarness = {
    db,
    auth,
    logger,
    secretKey,
    app: (overrides: Partial<AppDependencies> = {}) =>
      createApp({ db, baseUrl, secretKey, logger, routes, ...overrides }),
    createUser: async (role) => {
      const email = `${role}.${Date.now()}.${randomBytes(4).toString("hex")}@monclub.example`;
      await auth.api.signUpEmail({
        body: { name: `Compte ${role}`, email, password: "mot-de-passe-2026" },
      });
      const row = db
        .select({ id: userTable.id })
        .from(userTable)
        .where(eq(userTable.email, email))
        .get();
      if (row === undefined) {
        throw new Error("L'utilisateur de test n'a pas été créé.");
      }
      if (role !== "member") {
        db.update(userTable).set({ role }).where(eq(userTable.id, row.id)).run();
      }
      return { id: row.id, email };
    },
    signIn: async (email, password) => {
      const response = await harness.app().request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (response.status !== 200) {
        throw new Error(`La connexion de test a échoué (${response.status}).`);
      }
      const cookie = response.headers
        .getSetCookie()
        .find((value) => value.includes("session_token"));
      if (cookie === undefined) {
        throw new Error("La connexion de test n'a pas renvoyé de cookie de session.");
      }
      return cookie.split(";")[0] ?? "";
    },
  };
  return harness;
}
