import { describe, expect, it } from "vitest";
import { slugify } from "./index.js";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Hello World")).toBe("hello-world");
    expect(slugify("Club Sportif Municipal")).toBe("club-sportif-municipal");
  });

  it("removes every French accent and the cedilla", () => {
    expect(slugify("àâä éèêë îï ôö ùûü ÿ ç")).toBe("aaa-eeee-ii-oo-uuu-y-c");
    expect(slugify("ÀÂÄ ÉÈÊË ÎÏ ÔÖ ÙÛÜ Ÿ Ç")).toBe("aaa-eeee-ii-oo-uuu-y-c");
    expect(slugify("École de rugby")).toBe("ecole-de-rugby");
    expect(slugify("Fête du club à Montréal")).toBe("fete-du-club-a-montreal");
  });

  it("expands the French ligatures", () => {
    expect(slugify("Cœur de Bœuf")).toBe("coeur-de-boeuf");
    expect(slugify("ŒUVRE")).toBe("oeuvre");
    expect(slugify("Lætitia et Æsop")).toBe("laetitia-et-aesop");
  });

  it("transliterates other Latin letters that have no decomposition", () => {
    expect(slugify("Straße")).toBe("strasse");
    expect(slugify("Søren Ødegaard")).toBe("soren-odegaard");
    expect(slugify("Łódź")).toBe("lodz");
    expect(slugify("Đorđe")).toBe("dorde");
    expect(slugify("Þór Guðmundsson")).toBe("thor-gudmundsson");
    expect(slugify("Altıntop")).toBe("altintop");
    expect(slugify("Ħamrun Spartans")).toBe("hamrun-spartans");
    expect(slugify("ŧ ŋ ĸ Ŧ Ŋ")).toBe("t-n-k-t-n");
  });

  it("turns straight and typographic apostrophes into hyphens", () => {
    expect(slugify("L'Étoile d’Or")).toBe("l-etoile-d-or");
    expect(slugify("Aujourd'hui")).toBe("aujourd-hui");
  });

  it("turns punctuation, dashes and slashes into single hyphens", () => {
    expect(slugify("Saison 2025/2026 — U13 (filles)")).toBe("saison-2025-2026-u13-filles");
    expect(slugify("Tournoi : « Les Petits As » !")).toBe("tournoi-les-petits-as");
    expect(slugify("Match 3–1, victoire.")).toBe("match-3-1-victoire");
    expect(slugify("Sport & Loisirs")).toBe("sport-loisirs");
  });

  it("handles every kind of whitespace, including French non-breaking spaces", () => {
    expect(slugify("Prêts ? Partez !")).toBe("prets-partez");
    expect(slugify("ligne 1\nligne 2\tfin")).toBe("ligne-1-ligne-2-fin");
  });

  it("collapses repeated separators and trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello   World!!--  ")).toBe("hello-world");
    expect(slugify("a - - b")).toBe("a-b");
    expect(slugify("-déjà-")).toBe("deja");
  });

  it("keeps digits", () => {
    expect(slugify("U13")).toBe("u13");
    expect(slugify("2025")).toBe("2025");
  });

  it("gives the same result for composed and decomposed input", () => {
    const composed = "Été".normalize("NFC");
    const decomposed = "Été".normalize("NFD");
    expect(decomposed).not.toBe(composed);
    expect(slugify(decomposed)).toBe(slugify(composed));
    expect(slugify(decomposed)).toBe("ete");
  });

  it("folds compatibility characters to plain ASCII", () => {
    expect(slugify("ﬁnale")).toBe("finale");
    expect(slugify("ＵＳ　Ｕ１３")).toBe("us-u13");
    expect(slugify("İstanbul")).toBe("istanbul");
  });

  it("returns an empty string when nothing can be kept", () => {
    expect(slugify("")).toBe("");
    expect(slugify("   ")).toBe("");
    expect(slugify("!?—…")).toBe("");
    expect(slugify("😀")).toBe("");
    expect(slugify("日本")).toBe("");
  });

  it("returns an empty string for ASCII punctuation and symbols only", () => {
    expect(slugify("@#$%^&*()_+=[]{}|\\;:'\",.<>/?`~")).toBe("");
    expect(slugify("---")).toBe("");
    expect(slugify("___")).toBe("");
    expect(slugify("€ £ ¥ © ® °")).toBe("");
  });

  it("drops non-Latin characters but keeps the Latin ones around them", () => {
    expect(slugify("Club 日本 Paris")).toBe("club-paris");
    expect(slugify("Victoire 🏆 3-0")).toBe("victoire-3-0");
  });

  it("always produces a valid slug and is idempotent", () => {
    const samples = [
      "Équipe première — Saison 2025/2026",
      "L’Union Sportive de Saint-Étienne-du-Rouvray",
      "  Œuvres   & Cœurs  ",
      "Prêts ? Partez !",
      "ﬁnale ＵＳ",
      "a",
    ];
    for (const sample of samples) {
      const slug = slugify(sample);
      expect(slug).toMatch(SLUG_PATTERN);
      expect(slugify(slug)).toBe(slug);
    }
  });

  it("handles very long input", () => {
    const words = 100_000;
    const slug = slugify("Équipe ".repeat(words));
    expect(slug).toMatch(SLUG_PATTERN);
    expect(slug).toBe(Array.from({ length: words }, () => "equipe").join("-"));
  });

  it("reduces a huge run of separators around a single letter to that letter", () => {
    const separators = "!-".repeat(500_000);
    expect(slugify(`${separators}a${separators}`)).toBe("a");
  });
});

describe("slugify on real club names", () => {
  it.each([
    ["AS Saint-Étienne", "as-saint-etienne"],
    ["Stade Français Paris", "stade-francais-paris"],
    ["US Créteil-Lusitanos", "us-creteil-lusitanos"],
    ["Olympique de Marseille", "olympique-de-marseille"],
    ["Union Bordeaux-Bègles", "union-bordeaux-begles"],
    ["Stade Rennais F.C.", "stade-rennais-f-c"],
    ["Montpellier Hérault SC", "montpellier-herault-sc"],
    ["Section Paloise Béarn Pyrénées", "section-paloise-bearn-pyrenees"],
    ["Club Athlétique Brive Corrèze Limousin", "club-athletique-brive-correze-limousin"],
    ["Racing 92", "racing-92"],
    ["Association sportive d'Œuilly", "association-sportive-d-oeuilly"],
    ["L’Isle-d’Abeau", "l-isle-d-abeau"],
  ])("%s → %s", (name, expected) => {
    expect(slugify(name)).toBe(expected);
  });
});
