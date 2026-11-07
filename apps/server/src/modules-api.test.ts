import {
  auditLog,
  type Database,
  type JsonObject,
  moduleCredentials,
  modules,
  pages,
} from "@sport-cms/db";
import exemple from "@sport-cms/module-exemple";
import type { LoadedModule } from "@sport-cms/module-loader";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ApiHarness, createApiHarness } from "./api-testing.js";

const exempleModule: LoadedModule = {
  definition: exemple,
  source: "official",
  manifest: {
    id: exemple.id,
    name: exemple.name,
    version: exemple.version,
    permissions: [],
    dataProcessing: [],
  },
};

let harness: ApiHarness;
let db: Database;
let app: ReturnType<ApiHarness["app"]>;
let ownerCookie: string;
let adminCookie: string;

beforeEach(async () => {
  harness = createApiHarness({ modules: [exempleModule] });
  db = harness.db;
  app = harness.app();
  const owner = await harness.createUser("owner");
  const admin = await harness.createUser("admin");
  ownerCookie = await harness.signIn(owner.email, "mot-de-passe-2026");
  adminCookie = await harness.signIn(admin.email, "mot-de-passe-2026");
});

afterEach(() => {
  if (db.$client.open) {
    db.$client.close();
  }
});

async function call(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  /** `null`: no session. */
  cookie: string | null = ownerCookie,
  body?: unknown,
): Promise<Response> {
  return app.request(path, {
    method,
    headers: {
      ...(cookie === null ? {} : { cookie }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** A published page holding a quotation of the module, inside a section. */
function publishQuotePage(path = "/citation"): void {
  const data: JsonObject = {
    root: { props: { title: "Citation" } },
    content: [
      {
        type: "Section",
        props: {
          id: "s",
          background: "default",
          content: [
            {
              type: "exemple.citation",
              props: { id: "q", text: "Allez le club !", author: "La présidente", align: "left" },
            },
            { type: "Heading", props: { id: "h", text: "Toujours là", level: 2, align: "left" } },
          ],
        },
      },
    ],
    zones: {},
  };
  db.insert(pages)
    .values({
      path,
      title: "Citation",
      draftData: data,
      publishedData: data,
      status: "published",
      publishedAt: new Date(),
    })
    .run();
}

describe("rights", () => {
  it("answer 401 without a session and 403 without modules.manage", async () => {
    expect((await call("GET", "/api/modules", null)).status).toBe(401);
    const forbidden = await call("GET", "/api/modules", adminCookie);
    expect(forbidden.status).toBe(403);
    expect(await forbidden.json()).toEqual({
      error: "Accès refusé : la permission « modules.manage » est requise.",
    });
    for (const [method, path] of [
      ["POST", "/api/modules/exemple/enable"],
      ["POST", "/api/modules/exemple/disable"],
      ["PUT", "/api/modules/exemple/settings"],
      ["PUT", "/api/modules/exemple/credentials"],
      ["DELETE", "/api/modules/exemple/credentials"],
    ] as const) {
      expect((await call(method, path, adminCookie, {})).status, path).toBe(403);
    }
    expect(harness.modules.isEnabled("exemple")).toBe(false);
  });
});

describe("GET /api/modules", () => {
  it("lists the modules, disabled at first, with the refused ones", async () => {
    const response = await call("GET", "/api/modules");
    expect(response.status).toBe(200);
    const body = (await response.json()) as { modules: JsonObject[]; failures: unknown[] };
    expect(body.failures).toEqual([]);
    expect(body.modules).toMatchObject([
      {
        id: "exemple",
        name: "Exemple",
        status: "available",
        enabled: false,
        blocks: [{ type: "exemple.citation", label: "Citation" }],
        credentials: { declared: true, configured: false, fields: ["apiKey"] },
      },
    ]);
  });

  it("gives one module, or 404", async () => {
    expect(await (await call("GET", "/api/modules/exemple")).json()).toMatchObject({
      module: { id: "exemple" },
    });
    for (const path of ["/api/modules/inconnu", "/api/modules/Pas%20un%20id"]) {
      const response = await call("GET", path);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "Module introuvable." });
    }
  });
});

describe("enabling and disabling", () => {
  it("renders the module's block on public pages only while it is enabled", async () => {
    publishQuotePage();
    const before = await (await app.request("/citation")).text();
    expect(before).not.toContain("Allez le club !");
    expect(before).toContain("Toujours là");
    expect(harness.logger.error).not.toHaveBeenCalled();

    const enabled = await call("POST", "/api/modules/exemple/enable");
    expect(enabled.status).toBe(200);
    expect(await enabled.json()).toMatchObject({ module: { id: "exemple", enabled: true } });
    const shown = await (await app.request("/citation")).text();
    expect(shown).toContain("<blockquote><p>Allez le club !</p></blockquote>");
    expect(shown).toContain("<figcaption>La présidente</figcaption>");

    const disabled = await call("POST", "/api/modules/exemple/disable");
    expect(disabled.status).toBe(200);
    const hidden = await (await app.request("/citation")).text();
    expect(hidden).not.toContain("Allez le club !");
    expect(hidden).toContain("Toujours là");
    expect(harness.logger.error).not.toHaveBeenCalled();
  });

  it("clears the HTML cache when the blocks change, not otherwise", async () => {
    publishQuotePage();
    await app.request("/citation");
    expect(harness.htmlCache.size).toBe(1);
    await call("POST", "/api/modules/exemple/disable");
    expect(harness.htmlCache.size).toBe(1);
    await call("POST", "/api/modules/exemple/enable");
    expect(harness.htmlCache.size).toBe(0);
  });

  it("accepts the module's block in a page draft once enabled", async () => {
    await call("POST", "/api/modules/exemple/enable");
    expect((await call("POST", "/api/pages", ownerCookie, { path: "/c", title: "C" })).status).toBe(
      201,
    );
    const saved = await call("PUT", "/api/pages/page?path=%2Fc", ownerCookie, {
      data: {
        root: { props: {} },
        content: [
          {
            type: "Section",
            props: {
              id: "s",
              background: "default",
              content: [{ type: "exemple.citation", props: { id: "q", text: "x" } }],
            },
          },
        ],
      },
    });
    expect(saved.status).toBe(200);
  });

  it("are audited with the account behind them", async () => {
    await call("POST", "/api/modules/exemple/enable");
    await call("POST", "/api/modules/exemple/disable");
    expect(db.select().from(auditLog).all()).toMatchObject([
      { action: "modules.enabled", targetType: "module", targetId: "exemple" },
      { action: "modules.disabled", targetType: "module", targetId: "exemple" },
    ]);
    expect(db.select().from(auditLog).all()[0]?.actorId).toEqual(expect.any(String));
  });

  it("answers 404 for an unknown module", async () => {
    expect((await call("POST", "/api/modules/inconnu/enable")).status).toBe(404);
    expect((await call("POST", "/api/modules/inconnu/disable")).status).toBe(404);
  });

  it("answers 409 for a module known to the database but not loaded", async () => {
    harness = createApiHarness({ modules: [] });
    db.$client.close();
    db = harness.db;
    app = harness.app();
    const owner = await harness.createUser("owner");
    ownerCookie = await harness.signIn(owner.email, "mot-de-passe-2026");
    db.insert(modules).values({ id: "parti", version: "1.0.0" }).run();
    const response = await call("POST", "/api/modules/parti/enable");
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("n'est pas chargé");
  });
});

describe("PUT /api/modules/:id/settings", () => {
  it("saves settings validated by the module's schema", async () => {
    const response = await call("PUT", "/api/modules/exemple/settings", ownerCookie, {
      signature: "  Le bureau  ",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      module: { settings: { signature: "Le bureau" } },
    });
    expect(db.select().from(auditLog).get()).toMatchObject({ action: "modules.settings_updated" });
  });

  it("refuses invalid settings with a French message per field", async () => {
    const response = await call("PUT", "/api/modules/exemple/settings", ownerCookie, {
      signature: "x".repeat(101),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Réglages invalides.",
      fields: { signature: "La signature est trop longue (100 caractères maximum)." },
    });
  });

  it("refuses a body that is not JSON", async () => {
    const response = await call("PUT", "/api/modules/exemple/settings", ownerCookie, "{ pas json");
    expect(response.status).toBe(400);
  });
});

describe("credentials", () => {
  it("are saved encrypted and never sent back", async () => {
    const response = await call("PUT", "/api/modules/exemple/credentials", ownerCookie, {
      apiKey: "clé-très-secrète",
    });
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain("clé-très-secrète");
    expect(JSON.parse(text)).toMatchObject({ module: { credentials: { configured: true } } });
    const listed = await (await call("GET", "/api/modules")).text();
    expect(listed).not.toContain("clé-très-secrète");
    const stored = db.select().from(moduleCredentials).get();
    expect(stored?.encryptedValue).not.toContain("clé");
    expect(await harness.modules.context("exemple")?.credentials()).toEqual({
      apiKey: "clé-très-secrète",
    });
    expect(JSON.stringify(db.select().from(auditLog).all())).not.toContain("secrète");
  });

  it("are refused when invalid", async () => {
    const response = await call("PUT", "/api/modules/exemple/credentials", ownerCookie, {
      apiKey: " ",
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Identifiants invalides.",
      fields: { apiKey: "La clé d'API est requise." },
    });
  });

  it("can be deleted", async () => {
    await call("PUT", "/api/modules/exemple/credentials", ownerCookie, { apiKey: "k" });
    const response = await call("DELETE", "/api/modules/exemple/credentials");
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ module: { credentials: { configured: false } } });
    expect(db.select().from(moduleCredentials).all()).toEqual([]);
  });
});

describe("origin and identifiers (tester)", () => {
  it("refuses a change coming from another origin, and leaves the module as it was", async () => {
    for (const origin of ["https://evil.example", "null"]) {
      const response = await app.request("/api/modules/exemple/enable", {
        method: "POST",
        headers: { cookie: ownerCookie, origin },
      });
      expect(response.status, origin).toBe(403);
      expect(((await response.json()) as { error: string }).error).toMatch(/instance/);
    }
    expect(harness.modules.isEnabled("exemple")).toBe(false);
    expect(db.select().from(auditLog).all()).toEqual([]);
  });

  it("answers 404 for identifiers that are not module identifiers (case, traversal)", async () => {
    for (const path of [
      "/api/modules/EXEMPLE",
      "/api/modules/Exemple/enable",
      "/api/modules/..%2F..%2Fsecret",
      "/api/modules/%2e%2e/enable",
      "/api/modules/exemple%00/enable",
    ]) {
      const method = path.endsWith("/enable") ? "POST" : "GET";
      expect((await call(method, path)).status, path).toBe(404);
    }
    expect(harness.modules.isEnabled("exemple")).toBe(false);
  });
});
