import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./session.js";

/**
 * The modules flow against the compiled server, after the pages specs (file order): enable the
 * official module « Exemple » from the back-office (consent screen), open its page, save its
 * credentials, then add its block « Citation » from the drawer of the editor — loaded from the
 * module's `client.js`, with the React of the back-office shared through the import map —,
 * publish, and see the block on the public site. Disabling the module takes the block off the
 * site, and the editor shows the block as unavailable.
 */

const PATH = "/citations";
const EDITOR_URL = `/admin/pages/edition?chemin=${encodeURIComponent(PATH)}`;
const QUOTE = "Le sport, c'est la vie.";

test.setTimeout(120_000);

/** The card of the module « Exemple » on the Modules screen. */
function exempleCard(page: Page) {
  return page.getByRole("region", { name: "Module Exemple" });
}

async function openModules(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Modules", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Modules", level: 1 })).toBeVisible();
}

test("enable the module « Exemple », use its block in the editor and see it on the site", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // Known and harmless: the stylesheet of Puck imports a web font from another site, which
    // the CSP of the back-office blocks (the editor falls back to the system fonts).
    if (message.type() === "error" && !message.text().includes("rsms.me/inter")) {
      errors.push(message.text());
    }
  });

  await signIn(page);
  await openModules(page);
  const card = exempleCard(page);
  await expect(card.getByText("Désactivé", { exact: true })).toBeVisible();

  // Enabling asks first, showing what the module asks for.
  await card.getByRole("button", { name: "Activer…" }).click();
  await expect(
    card.getByText("Ce module ne demande aucun accès aux données du club."),
  ).toBeVisible();
  await card.getByRole("button", { name: "Activer le module" }).click();
  await expect(card.getByText("Activé", { exact: true })).toBeVisible();

  // Its page joins the menu of the back-office (its client entry is loaded).
  await page.getByRole("link", { name: "À propos (Exemple)" }).click();
  await expect(page.getByRole("heading", { name: "À propos du module Exemple" })).toBeVisible();

  // Credentials are saved, never shown back.
  await openModules(page);
  const apiKey = exempleCard(page).getByLabel("Clé d'API (obligatoire)");
  await apiKey.fill("cle-de-test-generee");
  await exempleCard(page).getByRole("button", { name: "Enregistrer les identifiants" }).click();
  await expect(exempleCard(page).getByText("Identifiants enregistrés.")).toBeVisible();
  await expect(apiKey).toHaveValue("");
  await page.reload();
  await expect(exempleCard(page).getByText(/^Identifiants enregistrés le /)).toBeVisible();
  await expect(page.locator("body")).not.toContainText("cle-de-test-generee");

  // A page with the block of the module, added from the drawer of the editor.
  await page.getByRole("link", { name: "Pages" }).click();
  await page.getByLabel("Chemin de la page").fill(PATH);
  await page.getByLabel("Titre de la page").fill("Citations");
  await page.getByRole("button", { name: "Créer la page" }).click();
  await expect(page).toHaveURL(new RegExp(`${EDITOR_URL.replace("?", "\\?")}$`));
  await page.getByTestId("drawer-item:Hero").click();
  await page.getByLabel("Titre", { exact: true }).locator("visible=true").fill("Nos citations");
  await page.getByTestId("drawer-item:Section").click();
  await page.getByTestId("drawer-item:exemple.citation").click();
  await page.getByLabel("Citation", { exact: true }).locator("visible=true").fill(QUOTE);
  const canvas = page.frameLocator("#preview-frame");
  await expect(canvas.locator("blockquote").getByText(QUOTE)).toBeVisible();

  await page.getByText("Publier", { exact: true }).click();
  await expect(page.getByText("Page publiée : elle est visible sur le site public.")).toBeVisible();
  await page.goto(PATH);
  await expect(page.locator("main blockquote").getByText(QUOTE)).toBeVisible();

  expect(errors).toEqual([]);
});

test("a disabled module's block leaves the site, and the editor says it is unavailable", async ({
  page,
}) => {
  await signIn(page);
  await openModules(page);
  await exempleCard(page).getByRole("button", { name: "Désactiver" }).click();
  await expect(exempleCard(page).getByText("Désactivé", { exact: true })).toBeVisible();

  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "Nos citations" })).toBeVisible();
  await expect(page.locator("main blockquote")).toHaveCount(0);

  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("drawer-item:Hero")).toBeVisible();
  await expect(page.getByTestId("drawer-item:exemple.citation")).toHaveCount(0);
  const canvas = page.frameLocator("#preview-frame");
  await expect(canvas.getByText(/Bloc indisponible \(« exemple\.citation »\)/)).toBeVisible();
});
