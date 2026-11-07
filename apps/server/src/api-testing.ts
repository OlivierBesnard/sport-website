import { createSecretKey, type KeyObject, randomBytes } from "node:crypto";
import { type BlockRegistry, coreBlocks, createBlockRegistry } from "@sport-cms/blocks";
import type { Role } from "@sport-cms/core";
import {
  createTestDatabase,
  type Database,
  type JsonObject,
  user as userTable,
} from "@sport-cms/db";
import { eq } from "drizzle-orm";
import type { Hono } from "hono";
import { type Mock, vi } from "vitest";
import { type AppDependencies, createApp, type Logger } from "./app.js";
import { type Auth, createAuth } from "./auth/create-auth.js";
import { authRoutes } from "./auth/routes.js";
import { HtmlCache } from "./html-cache.js";
import { navigationApiRoutes } from "./navigation-api.js";
import { pagesApiRoutes } from "./pages-api.js";

/**
 * Test helpers for the admin API of the pages and the navigation: the auth routes are absent
 * here, but the sessions come from the same Better Auth instance (a session cookie is created
 * by `signIn`). No secret is written anywhere: a fresh 256-bit key is generated per harness.
 */

/** `http://`, so the session cookie is not `__Secure-`-prefixed. */
export const BASE_URL = "http://localhost:3000";

export interface ApiHarness {
  readonly db: Database;
  readonly auth: Auth;
  readonly htmlCache: HtmlCache;
  readonly blocks: BlockRegistry;
  readonly logger: { error: Mock<Logger["error"]> };
  readonly secretKey: KeyObject;
  /** The full instance application, with the admin API of the pages and the navigation. */
  readonly app: (overrides?: Partial<AppDependencies>) => Hono;
  /** Creates an account of the given role via Better Auth, to sign in with `email`. */
  readonly createUser: (role: Role) => Promise<{ id: string; email: string }>;
  /** Signs in and returns the value of the session cookie, to send in `Cookie`. */
  readonly signIn: (email: string, password: string) => Promise<string>;
}

const PASSWORD = "mot-de-passe-2026";

export function createApiHarness(): ApiHarness {
  const db = createTestDatabase();
  const logger = { error: vi.fn<Logger["error"]>() };
  const secretKey = createSecretKey(randomBytes(32));
  const auth = createAuth({ db, baseUrl: BASE_URL, secretKey, logger });
  const htmlCache = new HtmlCache();
  const registry = createBlockRegistry(coreBlocks);
  const blocks = () => registry;
  const routes = (app: Hono): void => {
    authRoutes({ auth, db })(app);
    pagesApiRoutes({ auth, db, blocks, htmlCache })(app);
    navigationApiRoutes({ auth, db, htmlCache })(app);
  };

  const harness: ApiHarness = {
    db,
    auth,
    htmlCache,
    blocks: registry,
    logger,
    secretKey,
    app: (overrides: Partial<AppDependencies> = {}) =>
      createApp({ db, baseUrl: BASE_URL, secretKey, logger, routes, htmlCache, ...overrides }),
    createUser: async (role) => {
      const email = `${role}.${Date.now()}.${randomBytes(4).toString("hex")}@monclub.example`;
      await auth.api.signUpEmail({
        body: { name: `Compte ${role}`, email, password: PASSWORD },
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

/** Content with one Hero and one Section, as a small valid page. */
export function sampleData(headingText = "Bienvenue"): JsonObject {
  return {
    root: { props: { title: "Page d'exemple", description: "Une page de test." } },
    content: [
      {
        type: "Hero",
        props: {
          id: "hero-1",
          title: "US Exemple",
          subtitle: "",
          imageSrc: "",
          imageAlt: "",
          decorative: false,
          ctaLabel: "",
          ctaHref: "",
        },
      },
      {
        type: "Section",
        props: {
          id: "section-1",
          background: "default",
          content: [
            {
              type: "Heading",
              props: { id: "heading-1", text: headingText, level: 2, align: "left" },
            },
          ],
        },
      },
    ],
    zones: {},
  };
}
