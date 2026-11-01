import { ROLES } from "@sport-cms/core";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiEnv, requirePermission, requireUser } from "./middlewares.js";
import { type AuthHarness, createAuthHarness } from "./testing.js";

let harness: AuthHarness;

beforeEach(() => {
  harness = createAuthHarness();
});

afterEach(() => {
  if (harness.db.$client.open) {
    harness.db.$client.close();
  }
});

/** A small protected API to exercise the middlewares with real session cookies. */
function protectedApp(): Hono<ApiEnv> {
  const app = new Hono<ApiEnv>();
  app.get("/me", requireUser(harness.auth), (context) =>
    context.json({ user: context.get("user") }),
  );
  app.get("/users", requirePermission(harness.auth, "users.manage"), (context) =>
    context.json({ user: context.get("user") }),
  );
  app.get("/pages", requirePermission(harness.auth, "pages.edit"), (context) =>
    context.json({ user: context.get("user") }),
  );
  app.get("/finance", requirePermission(harness.auth, "finance.manage"), (context) =>
    context.json({ user: context.get("user") }),
  );
  return app;
}

describe("requireUser", () => {
  it("answers 401 in French without a session", async () => {
    const response = await protectedApp().request("/me");
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Authentification requise." });
  });

  it("answers 401 for a made-up cookie", async () => {
    const response = await protectedApp().request("/me", {
      headers: { cookie: "better-auth.session_token=pas-vrai" },
    });
    expect(response.status).toBe(401);
  });

  it("puts the session user on the context, with its role", async () => {
    const { email } = await harness.createUser("editor");
    const cookie = await harness.signIn(email, "mot-de-passe-2026");
    const response = await protectedApp().request("/me", { headers: { cookie } });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: expect.objectContaining({ email, role: "editor" }),
    });
  });
});

describe("requirePermission", () => {
  it("answers 401 before checking the permission, then 403 in French", async () => {
    const { email } = await harness.createUser("member");
    const cookie = await harness.signIn(email, "mot-de-passe-2026");
    const anonymous = await protectedApp().request("/users");
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toEqual({ error: "Authentification requise." });

    const refused = await protectedApp().request("/users", { headers: { cookie } });
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({
      error: "Accès refusé : la permission « users.manage » est requise.",
    });
  });

  it.each(ROLES)("checks users.manage for %s", async (role) => {
    const { email } = await harness.createUser(role);
    const cookie = await harness.signIn(email, "mot-de-passe-2026");
    const response = await protectedApp().request("/users", { headers: { cookie } });
    expect(response.status).toBe(role === "owner" || role === "admin" ? 200 : 403);
  });

  it.each([
    ["owner", 200],
    ["editor", 200],
    ["treasurer", 403],
    ["coach", 403],
  ] as const)("checks pages.edit for %s (status %s)", async (role, status) => {
    const { email } = await harness.createUser(role);
    const cookie = await harness.signIn(email, "mot-de-passe-2026");
    expect((await protectedApp().request("/pages", { headers: { cookie } })).status).toBe(status);
  });

  it.each([
    ["treasurer", 200],
    ["admin", 200],
    ["editor", 403],
  ] as const)("checks finance.manage for %s (status %s)", async (role, status) => {
    const { email } = await harness.createUser(role);
    const cookie = await harness.signIn(email, "mot-de-passe-2026");
    expect((await protectedApp().request("/finance", { headers: { cookie } })).status).toBe(status);
  });
});
