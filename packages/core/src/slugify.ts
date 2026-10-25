/**
 * Latin letters that Unicode decomposition does not reduce to ASCII
 * (ligatures, letters with a stroke, dotless i, eng, kra…), mapped to their
 * usual transliteration. Keys are lowercase: matching happens after lowercasing.
 */
const LETTER_TRANSLITERATIONS: Readonly<Record<string, string>> = {
  æ: "ae",
  œ: "oe",
  ß: "ss",
  ø: "o",
  đ: "d",
  ð: "d",
  ł: "l",
  þ: "th",
  ı: "i",
  ħ: "h",
  ŧ: "t",
  ŋ: "n",
  ĸ: "k",
};

const TRANSLITERATED_LETTER = /[æœßøđðłþıħŧŋĸ]/g;
const COMBINING_MARK = /\p{M}/gu;
const NON_ALPHANUMERIC_RUN = /[^a-z0-9]+/g;
const EDGE_HYPHEN = /^-|-$/g;

/**
 * Turns free text into a URL-safe slug: lowercase ASCII letters and digits
 * separated by single hyphens.
 *
 * Accents are removed ("Équipe" → "equipe"), ligatures are expanded
 * ("Cœur" → "coeur"), and any other run of characters (spaces, apostrophes,
 * punctuation, symbols, non-Latin scripts) becomes a single hyphen. Leading and
 * trailing hyphens are dropped, so the result is an empty string when the input
 * holds no usable letter or digit.
 *
 * @example slugify("École de rugby — U13 (filles)") // "ecole-de-rugby-u13-filles"
 */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .toLowerCase()
    .replace(COMBINING_MARK, "")
    .replace(TRANSLITERATED_LETTER, (letter) => LETTER_TRANSLITERATIONS[letter] ?? "")
    .replace(NON_ALPHANUMERIC_RUN, "-")
    .replace(EDGE_HYPHEN, "");
}
