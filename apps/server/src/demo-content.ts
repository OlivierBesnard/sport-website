import { type Database, type JsonObject, type JsonValue, pages } from "@sport-cms/db";

/** One page of the demonstration site. */
export interface DemoPage {
  readonly path: string;
  /** Name of the page in the back-office. */
  readonly title: string;
  /** Content in Puck's format; its root props hold the title and description shown publicly. */
  readonly data: JsonObject;
}

function block(type: string, id: string, props: Record<string, JsonValue>): JsonObject {
  return { type, props: { id: `${type}-demo-${id}`, ...props } };
}

function heading(id: string, text: string, level: number, align = "left"): JsonObject {
  return block("Heading", id, { text, level, align });
}

function richText(id: string, body: string): JsonObject {
  return block("RichText", id, { body });
}

function section(id: string, background: string, content: JsonObject[]): JsonObject {
  return block("Section", id, { background, content });
}

function pageData(title: string, description: string, content: JsonObject[]): JsonObject {
  return { root: { props: { title, description } }, content, zones: {} };
}

/** Pages of a fictional club, to see the public site with real content during development. */
export const DEMO_PAGES: readonly DemoPage[] = [
  {
    path: "/",
    title: "Accueil",
    data: pageData(
      "US Exemple – Club de rugby",
      "Club de rugby amateur : école de rugby, équipes jeunes, seniors et loisirs.",
      [
        block("Hero", "1", {
          title: "US Exemple",
          subtitle:
            "Club de rugby amateur depuis 1920. École de rugby, jeunes, seniors ou loisirs : il y a une place pour chacun.",
          imageSrc: "",
          imageAlt: "",
          ctaLabel: "Découvrir le club",
          ctaHref: "/le-club",
        }),
        section("1", "default", [
          heading("1", "Bienvenue au club", 2),
          richText(
            "1",
            "<p>Licenciés, parents, bénévoles et partenaires font vivre le club chaque semaine. " +
              "Retrouvez ici nos équipes, nos horaires et toute l'actualité du club.</p>",
          ),
          block("Columns", "1", {
            layout: "thirds",
            first: [
              heading("2", "École de rugby", 3),
              richText("2", "<p>De 5 à 14 ans, pour découvrir le rugby en s'amusant.</p>"),
            ],
            second: [
              heading("3", "Seniors", 3),
              richText("3", "<p>Deux équipes engagées en championnat régional.</p>"),
            ],
            third: [
              heading("4", "Loisirs", 3),
              richText("4", "<p>Le rugby à toucher, sans plaquage, ouvert à tous.</p>"),
            ],
            fourth: [],
          }),
        ]),
        section("2", "muted", [
          heading("5", "Nous rejoindre", 2),
          richText(
            "5",
            "<p>Les entraînements ont lieu au stade municipal :</p>" +
              "<ul><li><p>École de rugby : <strong>mercredi</strong> de 14 h à 16 h</p></li>" +
              "<li><p>Seniors : <strong>mardi et jeudi</strong> de 19 h à 21 h</p></li></ul>" +
              "<p>Deux séances d'essai sont offertes.</p>",
          ),
          block("Button", "1", {
            label: "Écrire au club",
            href: "mailto:contact@club.example",
            variant: "primary",
            align: "left",
          }),
        ]),
        section("3", "primary", [
          heading("6", "Le club recrute des bénévoles", 2, "center"),
          richText(
            "6",
            '<p style="text-align: center">Arbitrage, buvette, transport, communication : ' +
              "chaque coup de main compte.</p>",
          ),
          block("Button", "2", {
            label: "En savoir plus",
            href: "/le-club",
            variant: "secondary",
            align: "center",
          }),
        ]),
      ],
    ),
  },
  {
    path: "/le-club",
    title: "Le club",
    data: pageData("Le club – US Exemple", "Histoire, projet et contact de l'US Exemple.", [
      section("4", "default", [
        heading("7", "Le club", 1),
        richText(
          "7",
          "<p>Fondée en 1920, l'US Exemple est une association loi 1901 animée par des bénévoles.</p>",
        ),
        block("Columns", "2", {
          layout: "two-one",
          first: [
            heading("8", "Notre projet", 2),
            richText(
              "8",
              "<p>Former des joueuses et des joueurs, transmettre les valeurs du rugby " +
                "et ouvrir le club à tous les publics.</p>",
            ),
          ],
          second: [
            heading("9", "Contact", 2),
            richText(
              "9",
              '<p>Stade municipal<br>1 rue du Stade<br><a href="mailto:contact@club.example">contact@club.example</a></p>',
            ),
          ],
          third: [],
          fourth: [],
        }),
        block("Button", "3", {
          label: "Retour à l'accueil",
          href: "/",
          variant: "secondary",
          align: "left",
        }),
      ]),
    ]),
  },
];

/**
 * Adds the demonstration pages, published, to `db`; a page whose path is taken is left as it is.
 * Returns how many pages were added (0 when run again). Development only: never called by the
 * server itself.
 */
export function seedDemoContent(db: Database): number {
  return db.transaction((tx) => {
    let added = 0;
    for (const page of DEMO_PAGES) {
      const result = tx
        .insert(pages)
        .values({
          path: page.path,
          title: page.title,
          draftData: page.data,
          publishedData: page.data,
          status: "published",
          publishedAt: new Date(),
        })
        .onConflictDoNothing({ target: pages.path })
        .run();
      added += result.changes;
    }
    return added;
  });
}
