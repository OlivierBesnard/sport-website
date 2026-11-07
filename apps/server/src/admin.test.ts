import { createHash, createSecretKey, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTestDatabase } from "@sport-cms/db";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN_CONTENT_SECURITY_POLICY,
  adminIndexContentSecurityPolicy,
  adminRoutes,
  decodeAdminPath,
  fileWithin,
} from "./admin.js";
import { createApp, type Logger } from "./app.js";
import { CONTENT_SECURITY_POLICY } from "./security-headers.js";

let directory: string;
const logger = { error: vi.fn<Logger["error"]>() };

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "sport-cms-admin-"));
  mkdirSync(join(directory, "assets"));
  writeFileSync(join(directory, "index.html"), "<!DOCTYPE html><title>admin</title>");
  writeFileSync(join(directory, "favicon.svg"), "<svg/>");
  writeFileSync(join(directory, "assets", "app-B1h23.js"), "console.log(1)");
  writeFileSync(join(directory, "assets", "style-Ab2cd.css"), "body{}");
});

afterEach(() => {
  rmSync(directory, { recursive: true, force: true });
  logger.error.mockClear();
});

function buildApp(): ReturnType<typeof createApp> {
  return createApp({
    db: createTestDatabase(),
    baseUrl: "http://localhost:3000",
    secretKey: createSecretKey(randomBytes(32)),
    logger,
    routes: adminRoutes({ directory, logger }),
  });
}

function expectAdminHeaders(response: Response): void {
  expect(response.headers.get("Content-Security-Policy")).toBe(ADMIN_CONTENT_SECURITY_POLICY);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
}

describe("GET /admin", () => {
  it("serves index.html of the build, revalidated on every request", async () => {
    const response = await buildApp().request("/admin");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/html");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(await response.text()).toContain("<title>admin</title>");
    expectAdminHeaders(response);
  });

  it("serves the same index on /admin/", async () => {
    const response = await buildApp().request("/admin/");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>admin</title>");
  });

  it("serves a hashed asset as immutable, with its content type", async () => {
    const script = await buildApp().request("/admin/assets/app-B1h23.js");
    expect(script.status).toBe(200);
    expect(script.headers.get("Content-Type")).toContain("text/javascript");
    expect(script.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
    expect(await script.text()).toBe("console.log(1)");
    expectAdminHeaders(script);
  });

  it("serves the other files of the build, revalidated", async () => {
    const favicon = await buildApp().request("/admin/favicon.svg");
    expect(favicon.status).toBe(200);
    expect(favicon.headers.get("Content-Type")).toContain("image/svg+xml");
    expect(favicon.headers.get("Cache-Control")).toBe("no-cache");
  });

  it("falls back to index.html for the routes of the SPA", async () => {
    const response = await buildApp().request("/admin/reglages/utilisateurs");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<title>admin</title>");
  });

  it("answers 404 for a missing hashed asset", async () => {
    const response = await buildApp().request("/admin/assets/app-00000.js");
    expect(response.status).toBe(404);
  });

  it("answers 404 for a malformed percent-encoding", async () => {
    const response = await buildApp().request("/admin/%E0%A4%A");
    expect(response.status).toBe(404);
  });

  it("answers 503 with a French page when the build is missing", async () => {
    const missing = join(directory, "..", "sans-build");
    const app = createApp({
      db: createTestDatabase(),
      baseUrl: "http://localhost:3000",
      secretKey: createSecretKey(randomBytes(32)),
      logger,
      routes: adminRoutes({ directory: missing }),
    });
    const response = await app.request("/admin");
    expect(response.status).toBe(503);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const html = await response.text();
    expect(html).toContain("Back-office indisponible");
    expect(html).toContain("pnpm build");
    expectAdminHeaders(response);
  });

  it("answers 503 when the directory exists without index.html", async () => {
    const empty = join(directory, "vide");
    mkdirSync(empty);
    const app = createApp({
      db: createTestDatabase(),
      baseUrl: "http://localhost:3000",
      secretKey: createSecretKey(randomBytes(32)),
      logger,
      routes: adminRoutes({ directory: empty }),
    });
    expect((await app.request("/admin")).status).toBe(503);
    expect((await app.request("/admin/reglages")).status).toBe(503);
  });

  it("never leaks its CSP on the public site, nor the other way round", async () => {
    const server = buildApp();
    const admin = await server.request("/admin");
    expect(admin.headers.get("Content-Security-Policy")).toBe(ADMIN_CONTENT_SECURITY_POLICY);
    const home = await server.request("/");
    expect(home.headers.get("Content-Security-Policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).not.toBe(ADMIN_CONTENT_SECURITY_POLICY);
  });
});

describe("import map of the back-office", () => {
  const map = '{"imports":{"react":"/admin/assets/react-Ab12.js"}}';
  const html = `<!DOCTYPE html><head><script type="importmap">${map}</script></head>`;
  const hash = `'sha256-${createHash("sha256").update(map).digest("base64")}'`;

  it("allows exactly the inline import map of index.html, by its hash", () => {
    const policy = adminIndexContentSecurityPolicy(html);
    expect(policy).toContain(`script-src 'self' ${hash};`);
    expect(policy.replace(` ${hash}`, "")).toBe(ADMIN_CONTENT_SECURITY_POLICY);
  });

  it("keeps the plain policy without an import map", () => {
    expect(adminIndexContentSecurityPolicy("<title>admin</title>")).toBe(
      ADMIN_CONTENT_SECURITY_POLICY,
    );
  });

  it("sends that policy with index.html, by its route or by its name", async () => {
    writeFileSync(join(directory, "index.html"), html);
    for (const path of ["/admin", "/admin/pages", "/admin/index.html"]) {
      const response = await buildApp().request(path);
      expect(response.headers.get("Content-Security-Policy"), path).toContain(hash);
    }
    const asset = await buildApp().request("/admin/assets/app-B1h23.js");
    expect(asset.headers.get("Content-Security-Policy")).toBe(ADMIN_CONTENT_SECURITY_POLICY);
  });
});

describe("path resolution of the back-office", () => {
  it("decodes the path under /admin", () => {
    expect(decodeAdminPath("/admin")).toBe("");
    expect(decodeAdminPath("/admin/")).toBe("/");
    expect(decodeAdminPath("/admin/assets/app%2Db1.js")).toBe("/assets/app-b1.js");
    expect(decodeAdminPath("/autre")).toBeUndefined();
  });

  it("keeps a requested file inside the build directory", () => {
    expect(fileWithin(directory, "/index.html")).toBe(join(directory, "index.html"));
    expect(fileWithin(directory, "/assets/app-B1h23.js")).toBe(
      join(directory, "assets", "app-B1h23.js"),
    );
  });

  it("refuses any path that escapes the build directory", () => {
    expect(fileWithin(directory, "/..")).toBeUndefined();
    expect(fileWithin(directory, "/../secret.txt")).toBeUndefined();
    expect(fileWithin(directory, "/a/b/../../../secret.txt")).toBeUndefined();
    expect(fileWithin(directory, "/..\\secret.txt")).toBeUndefined();
    expect(fileWithin(directory, "/nul\0.txt")).toBeUndefined();
  });

  it("refuses the encoded variants of the same escapes", () => {
    expect(decodeAdminPath("/admin/..%2Fsecret.txt")).toBe("/../secret.txt");
    expect(fileWithin(directory, decodeAdminPath("/admin/..%2Fsecret.txt") ?? "/")).toBeUndefined();
    expect(
      fileWithin(directory, decodeAdminPath("/admin/%2E%2E%5Csecret.txt") ?? "/"),
    ).toBeUndefined();
  });

  it("refuses the names the Win32 layer would read differently", () => {
    // A trailing dot or space is stripped, a colon opens an NTFS stream, a device name is a
    // device: none of them can be a file of the build, so the request is refused.
    expect(fileWithin(directory, "/index.html.")).toBeUndefined();
    expect(fileWithin(directory, "/index.html ")).toBeUndefined();
    expect(fileWithin(directory, "/a:b")).toBeUndefined();
    expect(fileWithin(directory, "/index.html:hidden")).toBeUndefined();
    expect(fileWithin(directory, "/CON")).toBeUndefined();
    expect(fileWithin(directory, "/con.txt")).toBeUndefined();
    expect(fileWithin(directory, "/NUL")).toBeUndefined();
    expect(fileWithin(directory, "/COM1")).toBeUndefined();
    expect(fileWithin(directory, "/lpt4.log")).toBeUndefined();
  });
});
