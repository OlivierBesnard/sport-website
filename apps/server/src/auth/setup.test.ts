import {
  auditLog,
  type Database,
  type StoredJson,
  settings,
  user as userTable,
  writeAudit,
} from "@sport-cms/db";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CLUB_COLORS_KEY, CLUB_NAME_KEY, CLUB_SPORTS_KEY } from "./setup.js";
import { type AuthHarness, createAuthHarness, setupBody } from "./testing.js";

let harness: AuthHarness;

beforeEach(() => {
  harness = createAuthHarness();
});

afterEach(() => {
  if (harness.db.$client.open) {
    harness.db.$client.close();
  }
});

function post(body: unknown): Promise<Response> {
  return Promise.resolve(
    harness.app().request("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function readSetting(db: Database, key: string): StoredJson | undefined {
  return db.select().from(settings).where(eq(settings.key, key)).get()?.value;
}

describe("GET /api/setup", () => {
  it("answers that a fresh instance is not installed", async () => {
    const response = await harness.app().request("/api/setup");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ installed: false, clubName: null });
  });

  it("answers that the instance is installed, with the club name", async () => {
    await post(setupBody());
    const response = await harness.app().request("/api/setup");
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ installed: true, clubName: "US Exemple" });
  });
});

describe("POST /api/setup", () => {
  it("creates the owner account, the club identity in the settings and an audit entry", async () => {
    const response = await post(setupBody());

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      club: {
        name: "US Exemple",
        sports: ["rugby", "football"],
        colors: { primary: "#0b5cad", secondary: "#ffffff" },
      },
      owner: { id: expect.any(String), name: "Jeanne Dupont", email: "jeanne@monclub.example" },
    });
    const owner = harness.db.select().from(userTable).get();
    expect(owner).toMatchObject({
      name: "Jeanne Dupont",
      email: "jeanne@monclub.example",
      role: "owner",
      emailVerified: false,
    });
    expect(readSetting(harness.db, CLUB_NAME_KEY)).toBe("US Exemple");
    expect(readSetting(harness.db, CLUB_SPORTS_KEY)).toEqual(["rugby", "football"]);
    expect(readSetting(harness.db, CLUB_COLORS_KEY)).toEqual({
      primary: "#0b5cad",
      secondary: "#ffffff",
    });
    const entries = harness.db.select().from(auditLog).all();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "setup.completed",
      actorId: owner?.id,
      targetType: "instance",
      targetId: "self",
      details: {
        clubName: "US Exemple",
        sports: ["rugby", "football"],
        ownerEmail: "jeanne@monclub.example",
      },
    });
  });

  it("signs the owner in with the same cookie attributes as a sign-in", async () => {
    const response = await post(setupBody());
    const cookies = response.headers.getSetCookie();
    const sessionCookie = cookies.find((value) => value.includes("session_token"));
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain("better-auth.session_token=");
    expect(sessionCookie).toContain("HttpOnly");
    expect(sessionCookie).toContain("SameSite=Lax");
    expect(sessionCookie).not.toContain("Secure"); // http://localhost: sign-in only.

    // The owner can use the session right away (the back-office wizard signs them in).
    const signedIn = await harness
      .app()
      .request("/api/auth/get-session", { headers: { cookie: sessionCookie ?? "" } });
    expect(signedIn.status).toBe(200);
    const session = (await signedIn.json()) as { user?: { role?: string } };
    expect(session.user?.role).toBe("owner");
  });

  it("deduplicates the sports", async () => {
    await post(
      setupBody({
        club: {
          name: "US Exemple",
          sports: ["rugby", "rugby", " foot "],
          colors: { primary: "#0b5cad" },
        },
      }),
    );
    expect(readSetting(harness.db, CLUB_SPORTS_KEY)).toEqual(["rugby", "foot"]);
  });

  it("replaces settings left over by a failed first attempt", async () => {
    // A first run that crashed after writing the club identity but before the owner: the
    // instance is still installable and the settings are rewritten.
    harness.db
      .insert(settings)
      .values({ key: CLUB_NAME_KEY, value: "Ancien club" })
      .onConflictDoNothing()
      .run();
    const response = await post(setupBody());
    expect(response.status).toBe(201);
    expect(readSetting(harness.db, CLUB_NAME_KEY)).toBe("US Exemple");
    expect(harness.db.select().from(userTable).all()).toHaveLength(1);
  });

  it("refuses a second installation once an owner exists (409)", async () => {
    expect((await post(setupBody())).status).toBe(201);
    const second = await post(
      setupBody({
        owner: {
          name: "Paul Martin",
          email: "paul@monclub.example",
          password: "autre-mot-de-passe",
        },
      }),
    );
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({ error: "L'instance est déjà installée." });
    expect(harness.db.select().from(userTable).all()).toHaveLength(1);
    expect(harness.db.select().from(auditLog).all()).toHaveLength(1);
    // The claim row is gone, whether the installation succeeded or not.
    expect(readSetting(harness.db, "instance.setup")).toBeUndefined();
  });

  it("refuses while another installation holds a fresh claim", async () => {
    harness.db
      .insert(settings)
      .values({ key: "instance.setup", value: { startedAt: Date.now() - 1_000 } })
      .onConflictDoNothing()
      .run();
    const response = await post(setupBody());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "Une installation est déjà en cours." });
    expect(harness.db.select().from(userTable).all()).toEqual([]);
  });

  it("takes over a claim abandoned more than 15 minutes ago", async () => {
    // A server crashed mid-install: its claim must not block the installation forever.
    harness.db
      .insert(settings)
      .values({ key: "instance.setup", value: { startedAt: Date.now() - 16 * 60_000 } })
      .onConflictDoNothing()
      .run();
    const response = await post(setupBody());
    expect(response.status).toBe(201);
    expect(readSetting(harness.db, "instance.setup")).toBeUndefined();
    expect(harness.db.select().from(userTable).all()).toHaveLength(1);
  });

  it("removes the account and releases the claim when the installation fails halfway", async () => {
    const audit = vi.fn(writeAudit).mockImplementationOnce(() => {
      throw new Error("Écriture impossible (test).");
    });
    harness = createAuthHarness({ audit });
    const failed = await post(setupBody());
    expect(failed.status).toBe(500);
    // Nothing half-installed: no account, no club identity, and the claim is released.
    expect(harness.db.select().from(userTable).all()).toEqual([]);
    expect(readSetting(harness.db, CLUB_NAME_KEY)).toBeUndefined();
    expect(readSetting(harness.db, "instance.setup")).toBeUndefined();
    // The instance stays installable: a new attempt succeeds, audit included.
    const retried = await post(setupBody());
    expect(retried.status).toBe(201);
    expect(harness.db.select().from(auditLog).all()).toHaveLength(1);
  });

  it("never lets two simultaneous installations both succeed", async () => {
    const first = post(setupBody());
    const second = post(
      setupBody({
        owner: {
          name: "Paul Martin",
          email: "paul@monclub.example",
          password: "autre-mot-de-passe",
        },
      }),
    );
    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    const statuses = [firstResponse.status, secondResponse.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(harness.db.select().from(userTable).all()).toHaveLength(1);
  });

  it.each([
    ["sans corps", undefined],
    ["corps non objet", "chaîne"],
    [
      "sans club",
      { owner: { name: "Jeanne", email: "jeanne@monclub.example", password: "mot-de-passe" } },
    ],
    ["nom du club vide", { club: { name: "", sports: ["rugby"], colors: { primary: "#0b5cad" } } }],
    ["sans sport", { club: { name: "US Exemple", sports: [], colors: { primary: "#0b5cad" } } }],
    [
      "couleur invalide",
      { club: { name: "US Exemple", sports: ["rugby"], colors: { primary: "bleu" } } },
    ],
    [
      "responsable sans adresse",
      {
        club: { name: "US Exemple", sports: ["rugby"], colors: { primary: "#0b5cad" } },
        owner: { name: "Jeanne", password: "mot-de-passe" },
      },
    ],
    [
      "mot de passe trop court",
      {
        club: { name: "US Exemple", sports: ["rugby"], colors: { primary: "#0b5cad" } },
        owner: { name: "Jeanne", email: "jeanne@monclub.example", password: "court" },
      },
    ],
  ])("refuses %s with French messages (400), touching nothing", async (_label, body) => {
    const response = await post(body);
    expect(response.status).toBe(400);
    const payload = (await response.json()) as { error: string; fields: Record<string, string> };
    expect(payload.error).toBe("Requête invalide.");
    expect(Object.values(payload.fields).every((message) => message.length > 0)).toBe(true);
    expect(Object.keys(payload.fields).length).toBeGreaterThan(0);
    expect(harness.db.select().from(userTable).all()).toEqual([]);
    expect(harness.db.select().from(auditLog).all()).toEqual([]);
    expect(harness.db.select().from(settings).all()).toEqual([]);
  });

  it("answers 429 beyond the rate limit of the setup", async () => {
    harness = createAuthHarness({ limits: { setup: { windowMs: 60_000, max: 1 } } });
    const first = await post(setupBody());
    expect(first.status).toBe(201);
    const second = await post(
      setupBody({ club: { name: "Autre", sports: ["hand"], colors: { primary: "#111111" } } }),
    );
    expect(second.status).toBe(429);
    expect(second.headers.get("Retry-After")).toBeDefined();
    expect(await second.json()).toEqual({
      error: "Trop de tentatives. Réessayez dans un instant.",
    });
    expect(harness.db.select().from(userTable).all()).toHaveLength(1);
  });
});

describe("POST /api/auth/sign-up/email", () => {
  it("is refused: visitors cannot create accounts", async () => {
    const response = await harness.app().request("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "X", email: "x@x.example", password: "mot-de-passe" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "L'inscription publique est désactivée." });
    expect(harness.db.select().from(userTable).all()).toEqual([]);
  });
});
