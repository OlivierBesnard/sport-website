import { expect, test } from "@playwright/test";
import { signIn } from "./session.js";

/**
 * The editorial content against the compiled server: an image uploaded from the Media screen (a
 * file disguised as an image is refused there), then a news item with that image written,
 * published, and shown on its own page of the public site.
 */

test.setTimeout(120_000);

/** A real PNG of 64 × 48 pixels. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAEAAAAAwCAIAAAAuKetIAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAQ0lEQVRo3u3PQQkAAAgEsPtb0Yp2tIJfYbACS/W8FgEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQGBqwXD1PC1sUIoWwAAAABJRU5ErkJggg==",
  "base64",
);

test("upload an image, publish a news item with it, and see its page", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));

  await signIn(page);
  await page.getByRole("link", { name: "Médias", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Médias", level: 1 })).toBeVisible();

  // Disguised as a JPEG, refused by its content.
  await page.getByLabel(/^Image \(JPEG/).setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from("ceci n'est pas une image"),
  });
  await page.getByLabel("Aucune personne reconnaissable").check();
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(
    page.getByText(
      "Ce fichier n'est pas une image JPEG, PNG, WebP, GIF ou AVIF : il a été refusé.",
    ),
  ).toBeVisible();

  await page.getByLabel(/^Image \(JPEG/).setInputFiles({
    name: "tournoi.png",
    mimeType: "image/png",
    buffer: PNG,
  });
  await page.getByLabel("Texte alternatif", { exact: true }).first().fill("Le tournoi de Noël");
  await page.getByLabel("Aucune personne reconnaissable").first().check();
  await page.getByRole("button", { name: "Téléverser" }).click();
  await expect(page.getByText("Image « tournoi.png » ajoutée.")).toBeVisible();

  await page.getByRole("link", { name: "Actualités", exact: true }).click();
  await page.getByRole("button", { name: "Écrire une actualité" }).click();
  await page.getByLabel("Titre", { exact: true }).fill("Le tournoi de Noël");
  await page.getByLabel("Résumé").fill("Une belle journée pour nos jeunes.");
  await page.getByLabel("Texte", { exact: true }).fill("Merci aux bénévoles.");
  await page.getByLabel("Image", { exact: true }).selectOption({ label: "Le tournoi de Noël" });
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByText("« Le tournoi de Noël » enregistrée comme brouillon.")).toBeVisible();
  await page.getByRole("button", { name: "Publier", exact: true }).click();
  await expect(
    page.getByText("« Le tournoi de Noël » est publiée : elle est visible sur le site."),
  ).toBeVisible();

  await page.goto("/actualites/le-tournoi-de-noel");
  await expect(page.getByRole("heading", { name: "Le tournoi de Noël", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: "Le tournoi de Noël" })).toBeVisible();
  await expect(page.getByText("Merci aux bénévoles.")).toBeVisible();

  expect(errors).toEqual([]);
});
