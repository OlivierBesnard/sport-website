import { auditLog } from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_AUTH_LIMITS } from "./routes.js";
import { type AuthHarness, BASE_URL, createAuthHarness } from "./testing.js";

let harness: AuthHarness;

beforeEach(() => {
  harness = createAuthHarness();
});

afterEach(() => {
  if (harness.db.$client.open) {
    harness.db.$client.close();
  }
});

function postSignIn(body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return Promise.resolve(
    harness.app().request("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/auth/sign-in/email", () => {
  it("signs a created account in and returns its session cookie", async () => {
    const { email } = await harness.createUser("editor");
    const response = await postSignIn({ email, password: "mot-de-passe-2026" });
    expect(response.status).toBe(200);
    const cookie = response.headers.getSetCookie().find((value) => value.includes("session_token"));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("better-auth.session_token=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
  });

  it("refuses a wrong password with 401 and audits the attempt", async () => {
    const { email } = await harness.createUser("editor");
    const response = await postSignIn({ email, password: "mauvais-mot-de-passe" });
    expect(response.status).toBe(401);
    const entries = harness.db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "auth.sign_in_failed",
      actorId: null,
      details: { email },
    });
  });

  it("refuses an unknown email with 401 and audits it without revealing anything else", async () => {
    const response = await postSignIn({
      email: "inconnu@monclub.example",
      password: "peu-importe",
    });
    expect(response.status).toBe(401);
    expect(harness.db.select().from(auditLog).all()).toHaveLength(1);
  });

  it("does not audit a successful sign-in", async () => {
    const { email } = await harness.createUser("member");
    await postSignIn({ email, password: "mot-de-passe-2026" });
    expect(harness.db.select().from(auditLog).all()).toEqual([]);
  });

  it("answers 429 beyond the rate limit, with the time to wait", async () => {
    harness = createAuthHarness({ limits: { signIn: { windowMs: 60_000, max: 1 } } });
    const { email } = await harness.createUser("member");
    const first = await postSignIn({ email, password: "mot-de-passe-2026" });
    expect(first.status).toBe(200);
    const second = await postSignIn({ email, password: "mauvais-mot-de-passe" });
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeDefined();
    expect(await second.json()).toEqual({
      error: "Trop de tentatives. Réessayez dans un instant.",
    });
  });
});

describe("session cookies", () => {
  it("are Secure when the site is served over HTTPS, plain on localhost", async () => {
    const secure = createAuthHarness({ baseUrl: "https://monclub.example" });
    try {
      const { email } = await secure.createUser("member");
      const https = await secure.app().request("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password: "mot-de-passe-2026" }),
      });
      const cookie = https.headers.getSetCookie().find((value) => value.includes("session_token"));
      expect(cookie).toContain("__Secure-better-auth.session_token=");
      expect(cookie).toContain("Secure");
      expect(cookie).toContain("HttpOnly");
      expect(cookie).toContain("SameSite=Lax");
    } finally {
      if (secure.db.$client.open) {
        secure.db.$client.close();
      }
    }
  });
});

describe("GET /api/auth/get-session and POST /api/auth/sign-out", () => {
  it("return the session while signed in, and nothing after signing out", async () => {
    const { email } = await harness.createUser("editor");
    const signIn = await postSignIn({ email, password: "mot-de-passe-2026" });
    const cookie = signIn.headers.getSetCookie().find((value) => value.includes("session_token"));

    const app = harness.app();
    const session = await app.request("/api/auth/get-session", {
      headers: { cookie: cookie ?? "" },
    });
    expect(session.status).toBe(200);
    expect(await session.json()).toEqual({
      session: expect.objectContaining({ userId: expect.any(String) }),
      user: expect.objectContaining({ email, role: "editor" }),
    });

    const signOut = await app.request("/api/auth/sign-out", {
      method: "POST",
      // The browser sends the origin of the site with its cookies (CSRF check of Better Auth).
      headers: { cookie: cookie ?? "", origin: BASE_URL },
    });
    expect(signOut.status).toBe(200);
    // The cookie is expired by the response.
    const cleared = signOut.headers.getSetCookie().find((value) => value.includes("session_token"));
    expect(cleared).toContain("Max-Age=0");

    const after = await app.request("/api/auth/get-session", { headers: { cookie: cookie ?? "" } });
    expect(after.status).toBe(200);
    expect(await after.json()).toBeNull();
  });
});

describe("CSRF: the origin of the requests", () => {
  it("accepts the origin of the site, and a client without any origin hint", async () => {
    const { email } = await harness.createUser("member");
    const sameOrigin = await postSignIn(
      { email, password: "mot-de-passe-2026" },
      {
        origin: BASE_URL,
      },
    );
    expect(sameOrigin.status).toBe(200);
    // A bare client (curl, a server-to-server call) sends neither Origin nor fetch-metadata.
    const bare = await postSignIn({ email, password: "mot-de-passe-2026" });
    expect(bare.status).toBe(200);
  });

  it("refuses a foreign origin with 403", async () => {
    const foreign = await postSignIn(
      { email: "x@monclub.example", password: "peu-importe" },
      { origin: "https://evil.example" },
    );
    expect(foreign.status).toBe(403);
    expect(await foreign.json()).toMatchObject({ code: "INVALID_ORIGIN" });
    expect(harness.db.select().from(auditLog).all()).toEqual([]);
  });

  it("refuses a browser-like request without origin with 403", async () => {
    // A browser request always carries the fetch-metadata headers; the fetch of Node sends
    // `Origin: null` too. Both are refused: no cookie-less client may act with credentials.
    const fetchLike = await postSignIn(
      { email: "x@monclub.example", password: "peu-importe" },
      { "sec-fetch-mode": "cors" },
    );
    expect(fetchLike.status).toBe(403);
    expect(await fetchLike.json()).toMatchObject({ code: "MISSING_OR_NULL_ORIGIN" });
  });
});

describe("default limits", () => {
  it("limit the sign-in to 10 attempts per minute and the setup to 5", () => {
    expect(DEFAULT_AUTH_LIMITS.signIn).toEqual({ windowMs: 60_000, max: 10 });
    expect(DEFAULT_AUTH_LIMITS.setup).toEqual({ windowMs: 60_000, max: 5 });
  });

  it("refuse the 11th sign-in of a minute with a French 429, without auditing it", async () => {
    for (let i = 0; i < DEFAULT_AUTH_LIMITS.signIn.max; i++) {
      const attempt = await postSignIn({
        email: `tentative-${i}@monclub.example`,
        password: "mauvais-mot-de-passe",
      });
      expect(attempt.status).toBe(401);
    }
    const beyond = await postSignIn({ email: "trop@monclub.example", password: "mauvais" });
    expect(beyond.status).toBe(429);
    expect(beyond.headers.get("Retry-After")).toBeDefined();
    expect(await beyond.json()).toEqual({
      error: "Trop de tentatives. Réessayez dans un instant.",
    });
    // The 10 failed sign-ins are audited, the 429 is not: it is refused before the handler.
    expect(harness.db.select().from(auditLog).all()).toHaveLength(DEFAULT_AUTH_LIMITS.signIn.max);
  });
});
