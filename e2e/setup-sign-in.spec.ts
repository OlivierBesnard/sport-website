import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, type Page, test } from "@playwright/test";
import { DATA_DIR } from "./environment.js";

/**
 * Full first-run flow against the compiled server: installation wizard, sign-in, dashboard,
 * sign-out — then the refusals (second installation, rate-limited sign-in) and the audit log
 * of the fresh instance. All user-visible texts are French; the tests assert them as such.
 * The audit log is read with `node:sqlite` (experimental in Node 24: an `ExperimentalWarning`
 * is printed, harmless) to avoid depending on `@sport-cms/db` from the tests.
 */

const CLUB_NAME = "US E2E";
const OWNER_NAME = "Jeanne Dupont";
const OWNER_EMAIL = "jeanne@us-e2e.example";
const OWNER_PASSWORD = "mot-de-passe-2026";

/** Horizontal position of the sidebar: off-screen while the mobile drawer is folded. */
async function sidebarX(page: Page): Promise<number> {
  const box = await page.locator("aside").boundingBox();
  return box?.x ?? Number.NaN;
}

test("installation, sign-in, dashboard, sign-out", async ({ page }) => {
  // A fresh instance serves the setup wizard on every URL of the back-office.
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/admin\/setup$/);

  // Step 1 — the identity of the club.
  await page.getByLabel("Nom du club").fill(CLUB_NAME);
  await page.getByLabel("Sports pratiqués").fill("handball, basket");
  await page.getByLabel("Couleur principale").fill("#0b5cad");
  await page.getByRole("button", { name: "Continuer" }).click();

  // Step 2 — the account of the person responsible.
  await page.getByLabel("Nom du responsable").fill(OWNER_NAME);
  await page.getByLabel("Adresse électronique").fill(OWNER_EMAIL);
  await page.getByLabel("Mot de passe").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Terminer l'installation" }).click();

  // The installation answer already signs the owner in: straight to the dashboard.
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Tableau de bord" })).toBeVisible();
  await expect(page.locator("aside").getByText(CLUB_NAME)).toBeVisible();
  await expect(page.getByRole("link", { name: "Tableau de bord" })).toBeVisible();
  // The sections to come are grayed out with a « bientôt » badge.
  await expect(page.getByText("bientôt")).toHaveCount(3);

  // Mobile first: the sidebar folds into a drawer, opened by the menu button.
  await page.setViewportSize({ width: 375, height: 800 });
  await expect.poll(sidebarX.bind(null, page)).toBeLessThan(0);
  await page.getByRole("button", { name: "Ouvrir le menu" }).click();
  await expect(
    page.locator("aside").getByRole("button", { name: "Se déconnecter" }),
  ).toBeInViewport();
  await page.getByRole("button", { name: "Fermer le menu" }).click();
  await expect.poll(sidebarX.bind(null, page)).toBeLessThan(0);

  // Sign out from the desktop shell: back to the sign-in.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/admin\/connexion$/);
  await expect(page.getByRole("heading", { name: "Connexion" })).toBeVisible();

  // A wrong password shows a French message (Better Auth answers in English).
  await page.getByLabel("Adresse électronique").fill(OWNER_EMAIL);
  await page.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page.getByText("E-mail ou mot de passe incorrect.")).toBeVisible();

  // Then the real sign-in leads back to the dashboard.
  await page.getByLabel("Mot de passe").fill(OWNER_PASSWORD);
  await page.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.locator("aside").getByText(CLUB_NAME)).toBeVisible();
});

test("refuses a second installation", async ({ page }) => {
  // The instance is installed: the wizard is unreachable, the sign-in takes over.
  await page.goto("/admin/setup");
  await expect(page).toHaveURL(/\/admin\/connexion$/);

  // Even the API refuses — the call comes from the browser, so it carries the right origin.
  const refusal = await page.evaluate(async () => {
    const response = await fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        club: { name: "Seconde fois", sports: ["football"], colors: { primary: "#000000" } },
        owner: {
          name: "Second essai",
          email: "seconde@monclub.example",
          password: "mot-de-passe-2026",
        },
      }),
    });
    return { status: response.status, body: (await response.json()) as { error?: string } };
  });
  expect(refusal.status).toBe(409);
  expect(refusal.body.error).toBe("L'instance est déjà installée.");

  // A browser POST carries the Origin header Better Auth expects: a wrong password gets the
  // credentials refusal (401), never the origin refusal (403, an English-only error).
  const signIn = await page.evaluate(async () => {
    const response = await fetch("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "jeanne@us-e2e.example", password: "mauvais-mot-de-passe" }),
    });
    return { status: response.status, body: (await response.json()) as { code?: string } };
  });
  expect(signIn.status).toBe(401);
  expect(signIn.body.code).toBe("INVALID_EMAIL_OR_PASSWORD");
});

test("limits the sign-in attempts with a French message", async ({ request }) => {
  let lastBody: { error?: string } = {};
  const statuses: number[] = [];
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await request.post("/api/auth/sign-in/email", {
      data: { email: OWNER_EMAIL, password: "mauvais-mot-de-passe" },
    });
    statuses.push(response.status());
    lastBody = (await response.json()) as { error?: string };
    if (response.status() === 429) {
      break;
    }
  }
  expect(statuses.at(-1)).toBe(429);
  expect(lastBody.error).toBe("Trop de tentatives. Réessayez dans un instant.");
});

test("audits the installation and the failed sign-ins", async () => {
  const db = new DatabaseSync(join(DATA_DIR, "database.sqlite"));
  try {
    const rows = db
      .prepare("SELECT action, COUNT(*) AS count FROM audit_log GROUP BY action")
      .all() as Array<{ action: string; count: number }>;
    const byAction = new Map(rows.map((row) => [row.action, Number(row.count)]));
    expect(byAction.get("setup.completed")).toBe(1);
    expect(byAction.get("auth.sign_in_failed")).toBeGreaterThan(0);
  } finally {
    db.close();
  }
});
