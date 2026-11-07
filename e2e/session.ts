import { expect, type Page } from "@playwright/test";

/** The owner installed by `setup-sign-in.spec.ts`. */
export const OWNER_EMAIL = "jeanne@us-e2e.example";
export const OWNER_PASSWORD = "mot-de-passe-2026";

/** Signs the owner in, waiting for the sign-in rate limiter to free a slot if needed. */
export async function signIn(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.goto("/admin/connexion");
    await page.getByLabel("Adresse électronique").fill(OWNER_EMAIL);
    await page.getByLabel("Mot de passe").fill(OWNER_PASSWORD);
    await page.getByRole("button", { name: "Se connecter" }).click();
    try {
      await expect(page).toHaveURL(/\/admin$/, { timeout: 3_000 });
      return;
    } catch {
      // Not signed in yet: with any luck only the rate limiter stood in the way.
    }
    await expect(page.getByText("Trop de tentatives. Réessayez dans un instant.")).toBeVisible();
    await page.waitForTimeout(10_000);
  }
  throw new Error("Connexion impossible : le limiteur de débit n'a pas libéré de créneau.");
}
