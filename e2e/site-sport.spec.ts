import { expect, test } from "@playwright/test";
import { signIn } from "./session.js";

/**
 * The sports content against the compiled server: a season, a team and a match entered in the
 * back-office, its score entered afterwards, then a page with the block « Derniers résultats »
 * — previewed in the editor with the real data — published, and the score on the public site.
 */

const PATH = "/resultats";
const OPPONENT = "FC Rival E2E";

test.setTimeout(120_000);

/** `datetime-local` value of yesterday at 15:00, local time. */
function yesterdayAfternoon(): string {
  const date = new Date(Date.now() - 86_400_000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T15:00`;
}

test("enter a match and its score, and see the result on the site", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Known and harmless: the web font Puck's stylesheet imports, blocked by the CSP.
    if (message.type() === "error" && !message.text().includes("rsms.me/inter")) {
      errors.push(message.text());
    }
  });

  await signIn(page);

  await page.getByRole("link", { name: "Saisons", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une saison" }).click();
  await page.getByRole("button", { name: "Enregistrer la saison" }).click();
  await expect(page.getByText("en cours", { exact: true })).toBeVisible();

  await page.getByRole("link", { name: "Équipes", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter une équipe" }).click();
  await page.getByLabel("Nom", { exact: true }).fill("Seniors A");
  await page.getByLabel("Catégorie").fill("Seniors");
  await page.getByRole("button", { name: "Enregistrer l'équipe" }).click();
  await expect(page.getByText("Équipe « Seniors A » enregistrée.")).toBeVisible();

  await page.getByRole("link", { name: "Calendrier", exact: true }).click();
  await page.getByRole("button", { name: "Ajouter au calendrier" }).click();
  await page.getByLabel("Équipe", { exact: true }).selectOption({ label: "Seniors A" });
  await page.getByLabel("Début", { exact: true }).fill(yesterdayAfternoon());
  await page.getByLabel("Adversaire", { exact: true }).fill(OPPONENT);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("1 match joué sans score : saisissez le résultat.")).toBeVisible();

  await page.getByRole("button", { name: "Saisir le score" }).click();
  await page.getByLabel("Score du club").fill("3");
  await page.getByLabel("Score de l'adversaire").fill("1");
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText(`Match contre « ${OPPONENT} » enregistré`)).toBeVisible();

  await page.getByRole("link", { name: "Pages", exact: true }).click();
  await page.getByLabel("Chemin de la page").fill(PATH);
  await page.getByLabel("Titre de la page").fill("Résultats");
  await page.getByRole("button", { name: "Créer la page" }).click();
  await page.getByTestId("drawer-item:Hero").click();
  await page.getByLabel("Titre", { exact: true }).locator("visible=true").fill("Nos résultats");
  await page.getByTestId("drawer-item:Section").click();
  await page.getByTestId("drawer-item:LatestResults").click();
  // The preview shows the real data, loaded through the API.
  const canvas = page.frameLocator("#preview-frame");
  await expect(canvas.getByText(OPPONENT)).toBeVisible();
  await expect(canvas.getByText("Victoire")).toBeVisible();

  await page.getByText("Publier", { exact: true }).click();
  await expect(page.getByText("Page publiée : elle est visible sur le site public.")).toBeVisible();
  await page.goto(PATH);
  await expect(page.locator("main .cms-match__score")).toHaveText(" 3 – 1 ");
  await expect(page.locator("main").getByText(OPPONENT)).toBeVisible();

  expect(errors).toEqual([]);
});
