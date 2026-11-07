import { expect, type Page, test } from "@playwright/test";
import { signIn } from "./session.js";

/**
 * The pages flow against the compiled server, after `setup-sign-in.spec.ts` installed the
 * instance (the tests share one instance and run in file order): create a page in the
 * back-office, add a block in the Puck editor by clicking the component in the drawer (the
 * drawer items of the instance add the block on click and select it; drag and drop stays
 * possible but is too fragile to drive), publish, and see the page on the public site — then
 * edit the draft without publishing and check that the public site does not move until the
 * next publication.
 */

const PATH = "/notre-club";
const EDITOR_URL = `/admin/pages/edition?chemin=${encodeURIComponent(PATH)}`;

// The first test waits for a free slot of the sign-in rate limiter (the previous spec filled
// it with refused attempts): each test gets a generous budget.
test.setTimeout(120_000);

/** The title field of the selected Hero. Puck renders the fields twice (a hidden sidebar tab
 * and the visible right pane), so only the visible copy matches. */
function heroTitleField(page: Page) {
  return page.getByLabel("Titre", { exact: true }).locator("visible=true");
}

async function openEditor(page: Page): Promise<void> {
  await page.goto(EDITOR_URL);
  await expect(page.getByTestId("drawer-item:Hero")).toBeVisible();
}

/** The publish control of Puck's header (a span, not a button). */
function publishButton(page: Page) {
  return page.getByText("Publier", { exact: true });
}

test("create a page, edit it in Puck, publish it and see it on the public site", async ({
  page,
}) => {
  await signIn(page);

  // The page is created from the list, which replaces the placeholder of the back-office.
  await page.getByRole("link", { name: "Pages" }).click();
  await expect(page.getByRole("heading", { name: "Pages" })).toBeVisible();
  await page.getByLabel("Chemin de la page").fill(PATH);
  await page.getByLabel("Titre de la page").fill("Notre club");
  await page.getByRole("button", { name: "Créer la page" }).click();

  // Creating a page opens its editor, with the drawer of the blocks on the left.
  await expect(page).toHaveURL(new RegExp(`${EDITOR_URL.replace("?", "\\?")}$`));
  await expect(page.getByTestId("drawer-item:Hero")).toBeVisible();

  // One click on « Bannière d'accueil » adds the block at the end of the page and selects it.
  await page.getByTestId("drawer-item:Hero").click();
  const titre = heroTitleField(page);
  await expect(titre).toBeVisible();
  await titre.fill("Bienvenue au club");

  // The preview shows the block with the styles of the site.
  const canvas = page.frameLocator("#preview-frame");
  await expect(canvas.getByRole("heading", { name: "Bienvenue au club" })).toBeVisible();
  await expect(canvas.locator("style[data-cms-theme]")).toHaveCount(1);
  // The rules of the theme apply in the canvas: the system font stack of the default theme.
  await expect(canvas.locator(".cms-hero__title")).toHaveCSS("font-family", /system-ui/);

  // The draft is saved; the page does not exist publicly yet.
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "Page introuvable" })).toBeVisible();

  // Publishing makes it visible, with the title of the published version.
  await openEditor(page);
  await publishButton(page).click();
  await expect(page.getByText("Page publiée : elle est visible sur le site public.")).toBeVisible();
  await page.goto(PATH);
  await expect(page).toHaveTitle("Notre club");
  await expect(page.getByRole("heading", { name: "Bienvenue au club" })).toBeVisible();
});

test("editing the draft without publishing leaves the public site unchanged", async ({ page }) => {
  await signIn(page);
  await openEditor(page);

  // Select the block in the preview to open its fields, then edit the draft only.
  const canvas = page.frameLocator("#preview-frame");
  await canvas.getByRole("heading", { name: "Bienvenue au club" }).click();
  await heroTitleField(page).fill("Bienvenue au club, dès 6 ans");
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Brouillon enregistré.")).toBeVisible();

  // The public page still shows the published content, byte for byte.
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "Bienvenue au club", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "dès 6 ans" })).toHaveCount(0);

  // The next publication brings the new content.
  await openEditor(page);
  await publishButton(page).click();
  await expect(page.getByText("Page publiée : elle est visible sur le site public.")).toBeVisible();
  await page.goto(PATH);
  await expect(page.getByRole("heading", { name: "Bienvenue au club, dès 6 ans" })).toBeVisible();
});

test("the history restores an old version as the draft", async ({ page }) => {
  await signIn(page);
  await openEditor(page);

  await page.getByRole("button", { name: "Historique" }).click();
  await expect(page.getByText("Historique des versions")).toBeVisible();
  await expect(page.getByText("Version 1 — Notre club")).toBeVisible();

  await page
    .getByRole("listitem")
    .filter({ hasText: "Version 1 —" })
    .getByRole("button", { name: "Restaurer" })
    .click();
  await expect(page.getByText("Version 1 restaurée comme brouillon.")).toBeVisible();

  // The restored draft is the first version again: select the block to see its field.
  await openEditor(page);
  const canvas = page.frameLocator("#preview-frame");
  await canvas.getByRole("heading", { name: "Bienvenue au club" }).click();
  await expect(heroTitleField(page)).toHaveValue("Bienvenue au club");
});

test("the navigation is edited in the back-office and rendered on the public site", async ({
  page,
}) => {
  await signIn(page);

  await page.getByRole("link", { name: "Navigation" }).click();
  await expect(page.getByRole("heading", { name: "Navigation" })).toBeVisible();
  await page.getByRole("button", { name: "Ajouter une entrée" }).click();
  await page.getByLabel("Libellé").fill("Notre club");
  await page
    .getByLabel("Page", { exact: true })
    .selectOption({ label: "Notre club (/notre-club)" });
  await page.getByRole("button", { name: "Enregistrer le menu" }).click();
  await expect(
    page.getByText("Menu enregistré : il est visible sur le site public."),
  ).toBeVisible();

  await page.goto(PATH);
  await expect(page.getByRole("navigation", { name: "Menu principal" })).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "Menu principal" })
      .getByRole("link", { name: "Notre club" }),
  ).toBeVisible();
});

test("the home page `/` is published from the editor and served at the root", async ({ page }) => {
  await signIn(page);
  await page.getByRole("link", { name: "Pages" }).click();
  await page.getByLabel("Chemin de la page").fill("/");
  await page.getByLabel("Titre de la page").fill("Accueil");
  await page.getByRole("button", { name: "Créer la page" }).click();
  await expect(page).toHaveURL(/\/admin\/pages\/edition\?chemin=%2F$/);

  await page.getByTestId("drawer-item:Hero").click();
  await heroTitleField(page).fill("US Exemple, le club de la ville");

  // With the Hero selected, a click on « Section » adds the Section right after it, selected;
  // a click on « Titre » then adds the heading inside the Section (insertion in a slot).
  await page.getByTestId("drawer-item:Section").click();
  await page.getByTestId("drawer-item:Heading").click();
  await page.getByLabel("Texte", { exact: true }).locator("visible=true").fill("Nos équipes");
  const canvas = page.frameLocator("#preview-frame");
  await expect(
    canvas.locator(".cms-section").getByRole("heading", { name: "Nos équipes" }),
  ).toBeVisible();

  await publishButton(page).click();
  await expect(page.getByText("Page publiée : elle est visible sur le site public.")).toBeVisible();

  await page.getByRole("button", { name: "Historique" }).click();
  await expect(page.getByText("Version 1 — Accueil")).toBeVisible();

  await page.goto("/");
  await expect(page).toHaveTitle("Accueil");
  await expect(
    page.getByRole("heading", { name: "US Exemple, le club de la ville" }),
  ).toBeVisible();
  await expect(
    page.locator("main .cms-section").getByRole("heading", { name: "Nos équipes", level: 2 }),
  ).toBeVisible();
});
