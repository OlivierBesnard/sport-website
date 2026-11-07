import {
  CALENDAR_EVENT_KINDS,
  isDay,
  normalizePagePath,
  TEAM_GENDERS,
  TIME_OF_DAY_PATTERN,
} from "@sport-cms/core";
import { z } from "zod";

/*
 * Bodies of the admin API of the sports content, validated with French messages. Every id
 * pointing at another row is checked against the database by the routes.
 */

function text(max: number, label: string) {
  return z
    .string({ error: `${label} doit être un texte.` })
    .trim()
    .max(max, `${label} est trop long (${max} caractères maximum).`);
}

function requiredText(max: number, label: string) {
  return text(max, label).min(1, `${label} est requis.`);
}

const id = (label: string) =>
  z
    .number({ error: `${label} est invalide.` })
    .int(`${label} est invalide.`)
    .positive(`${label} est invalide.`);

const optionalId = (label: string) => id(label).nullable().default(null);

const day = (label: string) =>
  z
    .string({ error: `${label} est requise.` })
    .refine(isDay, `${label} doit être une date valide (AAAA-MM-JJ).`);

export const sectionSchema = z.object({
  name: requiredText(100, "Le nom de la section"),
  sport: text(100, "Le sport").default(""),
  position: z.number().int().min(0).max(10_000).default(0),
});

export const seasonSchema = z
  .object({
    name: requiredText(50, "Le nom de la saison"),
    startsOn: day("La date de début"),
    endsOn: day("La date de fin"),
  })
  // Only once both days are valid: an invalid day has its own message.
  .refine(
    (season) => !isDay(season.startsOn) || !isDay(season.endsOn) || season.startsOn < season.endsOn,
    {
      message: "La saison doit finir après son début.",
      path: ["endsOn"],
    },
  );

const latitude = z
  .number({ error: "La latitude doit être un nombre." })
  .min(-90, "La latitude est comprise entre -90 et 90.")
  .max(90, "La latitude est comprise entre -90 et 90.");
const longitude = z
  .number({ error: "La longitude doit être un nombre." })
  .min(-180, "La longitude est comprise entre -180 et 180.")
  .max(180, "La longitude est comprise entre -180 et 180.");

export const venueSchema = z
  .object({
    name: requiredText(150, "Le nom du lieu"),
    address: text(200, "L'adresse").default(""),
    postalCode: text(20, "Le code postal").default(""),
    city: text(100, "La ville").default(""),
    accessInfo: text(2000, "L'accès").default(""),
    latitude: latitude.nullable().default(null),
    longitude: longitude.nullable().default(null),
  })
  .refine((venue) => (venue.latitude === null) === (venue.longitude === null), {
    message: "Renseignez la latitude et la longitude, ou aucune des deux.",
    path: ["longitude"],
  });

export const MAX_TRAINING_SLOTS = 30;

const slotSchema = z
  .object({
    weekday: z
      .number({ error: "Choisissez un jour." })
      .int("Choisissez un jour.")
      .min(1, "Choisissez un jour.")
      .max(7, "Choisissez un jour."),
    startsAt: z
      .string({ error: "L'heure de début est requise." })
      .regex(TIME_OF_DAY_PATTERN, "L'heure de début doit être de la forme 18:30."),
    endsAt: z
      .string({ error: "L'heure de fin est requise." })
      .regex(TIME_OF_DAY_PATTERN, "L'heure de fin doit être de la forme 20:00."),
    venueId: optionalId("Le lieu"),
  })
  .refine(
    (slot) =>
      !TIME_OF_DAY_PATTERN.test(slot.startsAt) ||
      !TIME_OF_DAY_PATTERN.test(slot.endsAt) ||
      slot.startsAt < slot.endsAt,
    {
      message: "L'entraînement doit finir après son début.",
      path: ["endsAt"],
    },
  );

const pagePath = z
  .string({ error: "La page de l'équipe doit être un chemin." })
  .trim()
  .max(500, "Le chemin de la page est trop long (500 caractères maximum).")
  .refine((path) => path === "" || path.startsWith("/"), {
    message: "Le chemin de la page commence par / (ex. /equipes/u13).",
  })
  .transform((path) => (path === "" ? null : normalizePagePath(path)));

/** Team fields only an account with `sport.manage` may change. */
export const TEAM_IDENTITY_FIELDS = [
  "seasonId",
  "sectionId",
  "name",
  "category",
  "level",
  "gender",
  "pagePath",
  "position",
] as const;

export const teamSchema = z.object({
  seasonId: id("La saison"),
  sectionId: optionalId("La section"),
  name: requiredText(100, "Le nom de l'équipe"),
  category: text(50, "La catégorie").default(""),
  level: text(100, "Le niveau").default(""),
  gender: z.enum(TEAM_GENDERS, { error: "Le genre de l'équipe est invalide." }).default("mixed"),
  description: text(5000, "La présentation").default(""),
  pagePath: pagePath.nullable().default(null),
  position: z.number().int().min(0).max(10_000).default(0),
  slots: z
    .array(slotSchema)
    .max(MAX_TRAINING_SLOTS, `Une équipe a au plus ${MAX_TRAINING_SLOTS} créneaux.`)
    .default([]),
  /** Accounts coaching the team (`sport.manage` only). */
  coachIds: z
    .array(z.string({ error: "Un coach est invalide." }).min(1, "Un coach est invalide."))
    .max(20, "Une équipe a au plus 20 coachs.")
    .optional(),
});

export type TeamInput = z.output<typeof teamSchema>;

const score = z
  .number({ error: "Le score doit être un nombre." })
  .int("Le score doit être un nombre entier.")
  .min(0, "Le score ne peut pas être négatif.")
  .max(999, "Le score est trop grand.");

export const matchSchema = z
  .object({
    home: z.boolean({ error: "Précisez si le match est à domicile." }).default(true),
    opponent: requiredText(100, "L'adversaire"),
    competition: text(100, "La compétition").default(""),
    scoreFor: score.nullable().default(null),
    scoreAgainst: score.nullable().default(null),
    report: text(10_000, "Le compte rendu").default(""),
  })
  .refine((match) => (match.scoreFor === null) === (match.scoreAgainst === null), {
    message: "Saisissez les deux scores, ou aucun.",
    path: ["scoreAgainst"],
  });

const instant = (label: string) =>
  z
    .number({ error: `${label} est requise.` })
    .int(`${label} est invalide.`)
    .min(0, `${label} est invalide.`)
    .max(8_640_000_000_000_000, `${label} est invalide.`);

export const calendarEventSchema = z
  .object({
    seasonId: id("La saison"),
    teamId: optionalId("L'équipe"),
    kind: z.enum(CALENDAR_EVENT_KINDS, { error: "Le type d'événement est invalide." }),
    title: text(150, "Le titre").default(""),
    startsAt: instant("La date de début"),
    endsAt: instant("La date de fin").nullable().default(null),
    venueId: optionalId("Le lieu"),
    description: text(5000, "La description").default(""),
    match: matchSchema.optional(),
  })
  .superRefine((event, context) => {
    if (event.endsAt !== null && event.endsAt < event.startsAt) {
      context.addIssue({
        code: "custom",
        message: "L'événement doit finir après son début.",
        path: ["endsAt"],
      });
    }
    if (event.kind === "match") {
      if (event.teamId === null) {
        context.addIssue({
          code: "custom",
          message: "Choisissez l'équipe qui joue le match.",
          path: ["teamId"],
        });
      }
      if (event.match === undefined) {
        context.addIssue({
          code: "custom",
          message: "Les informations du match sont requises.",
          path: ["match"],
        });
      }
    } else if (event.title === "") {
      context.addIssue({ code: "custom", message: "Le titre est requis.", path: ["title"] });
    }
  });

export type CalendarEventInput = z.output<typeof calendarEventSchema>;
