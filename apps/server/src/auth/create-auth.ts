import type { KeyObject } from "node:crypto";
import { ROLES } from "@sport-cms/core";
import { account, type Database, session, user, verification } from "@sport-cms/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Logger } from "../app.js";

export interface AuthDependencies {
  /** Migrated database of the instance. */
  readonly db: Database;
  /**
   * Public origin of the site, without trailing slash (`RuntimeConfig.baseUrl`). Better Auth
   * derives the session cookie attributes from it: `Secure` as soon as it is `https:` (never on
   * localhost), plus the trusted origin for the CSRF checks.
   */
  readonly baseUrl: string;
  /**
   * Instance secret (`RuntimeConfig.secretKey`), used as the Better Auth secret to sign the
   * cookies and hash the verification values.
   */
  readonly secretKey: KeyObject;
  readonly logger?: Logger;
}

/** Better Auth instance of the server (`createAuth`), with its typed API and HTTP handler. */
export type Auth = ReturnType<typeof createAuth>;

/**
 * Builds the Better Auth instance: email + password authentication on the Drizzle schema of
 * `@sport-cms/db`, sessions as `HttpOnly`/`SameSite=Lax` cookies, `Secure` when the site is
 * served over HTTPS. Everything comes from the dependencies: nothing reads the environment.
 *
 * The public HTTP sign-up is refused by the auth routes; accounts are created by the setup
 * (`auth.api.signUpEmail`) and, later, by the back-office API.
 */
export function createAuth({ db, baseUrl, secretKey, logger = console }: AuthDependencies) {
  const rawKey = secretKey.export();
  return betterAuth({
    appName: "sport-website",
    baseURL: baseUrl,
    secret: (Buffer.isBuffer(rawKey) ? rawKey : Buffer.from(rawKey)).toString("base64"),
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: { enabled: true },
    // `role` is a server-owned field: it never comes from a request body. Accounts start as
    // "member"; the setup gives its owner the "owner" role, and so does the users API later.
    user: {
      additionalFields: {
        role: {
          type: [...ROLES],
          required: true,
          defaultValue: "member",
          input: false,
        },
      },
    },
    advanced: {
      // Better Auth skips the origin check when it detects a test environment; the check is
      // part of the behavior under test (the CSRF decision of the API), so it stays on
      // everywhere: development behaves like production.
      disableOriginCheck: false,
    },
    logger: {
      level: "error",
      log: (level, message, ...args) => {
        logger.error(`Better Auth (${level}) : ${message}`, ...args);
      },
    },
  });
}
