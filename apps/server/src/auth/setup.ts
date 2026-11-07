import { type Database, settings, user, writeAudit } from "@sport-cms/db";
import { and, eq, ne, sql } from "drizzle-orm";
import type { Context } from "hono";
import { z } from "zod";
import type { Logger } from "../app.js";
import { fieldsOf } from "../fields.js";
import type { Auth } from "./create-auth.js";

/** Key of the settings row that serializes concurrent setups; removed once completed. */
const SETUP_CLAIM_KEY = "instance.setup";
/** A claim older than this is considered abandoned by a crashed server, and taken over. */
const SETUP_CLAIM_MAX_AGE_MS = 15 * 60_000;
/** Settings keys written by the setup. */
export const CLUB_NAME_KEY = "club.name";
export const CLUB_SPORTS_KEY = "club.sports";
export const CLUB_COLORS_KEY = "club.colors";

/** Club colors as chosen at the installation (E16 will extract a palette from the logo). */
export interface ClubColors {
  readonly primary: string;
  readonly secondary?: string;
  readonly accent?: string;
}

const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
const COLOR_MESSAGE = "La couleur attend un code hexadécimal sous la forme #rrggbb.";

const colorSchema = z.string().regex(COLOR_PATTERN, COLOR_MESSAGE);

const nameSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} est requis.`)
    .max(200, `${label} est trop long (200 caractères maximum).`);

/** Body of `POST /api/setup`: the identity of the club and the owner's account. */
export const setupSchema = z.object({
  club: z.object({
    name: nameSchema("Le nom du club"),
    sports: z
      .array(
        z
          .string()
          .trim()
          .min(1, "Chaque sport doit être nommé.")
          .max(50, "Le nom d'un sport est trop long (50 caractères maximum)."),
      )
      .min(1, "Choisissez au moins un sport.")
      .max(10, "Choisissez au plus 10 sports."),
    colors: z.object({
      primary: colorSchema,
      secondary: colorSchema.optional(),
      accent: colorSchema.optional(),
    }),
  }),
  owner: z.object({
    name: nameSchema("Le nom du responsable"),
    email: z.email("L'adresse électronique du responsable est invalide."),
    password: z
      .string()
      .min(8, "Le mot de passe doit contenir au moins 8 caractères.")
      .max(128, "Le mot de passe doit contenir au plus 128 caractères."),
  }),
});

export type SetupInput = z.infer<typeof setupSchema>;

function readClubName(db: Database): string | null {
  const value = db.select().from(settings).where(eq(settings.key, CLUB_NAME_KEY)).get()?.value;
  return typeof value === "string" && value !== "" ? value : null;
}

/** Whether the instance has an owner account, and the club name it chose at the setup. */
export function setupStatus(db: Database): { installed: boolean; clubName: string | null } {
  const owner = db.select({ id: user.id }).from(user).where(eq(user.role, "owner")).get();
  return { installed: owner !== undefined, clubName: readClubName(db) };
}

export interface SetupDependencies {
  readonly auth: Auth;
  readonly db: Database;
  readonly logger?: Logger;
  /** Writer of the audit entry; a test replaces it to fail the installation halfway. */
  readonly audit?: typeof writeAudit;
}

function conflict(context: Context, message: string): Response {
  return context.json({ error: message }, 409);
}

/**
 * Better Auth writes the account and its credentials separately: on a failure between the two
 * writes, an account can exist while the installation failed. The setup creates the first
 * account, so such an orphan (never an owner) is removed, letting a new attempt use the email.
 */
function removeOrphanAccount(db: Database, email: string): void {
  db.delete(user)
    .where(and(eq(user.email, email.toLowerCase()), ne(user.role, "owner")))
    .run();
}

/**
 * Handler of `POST /api/setup`. Validates the payload, refuses a second installation, creates
 * the owner's account (email + password, session cookie in the response), gives it the
 * `owner` role, writes the identity of the club in the settings and logs the action.
 *
 * The installation is serialized by a claim row in the settings (`instance.setup`): two
 * simultaneous requests cannot both install the instance, and a claim left over by a crashed
 * server is taken over after {@link SETUP_CLAIM_MAX_AGE_MS}. Everything after the account
 * creation is synchronous on the SQLite connection: if anything fails, the half-created
 * account is deleted (its session and credentials go with it) and the claim is released, so
 * the instance stays installable.
 */
export function setupPostHandler({
  auth,
  db,
  logger = console,
  audit = writeAudit,
}: SetupDependencies) {
  return async (context: Context): Promise<Response> => {
    const raw = await context.req.json().catch(() => undefined);
    const parsed = setupSchema.safeParse(raw);
    if (!parsed.success) {
      return context.json({ error: "Requête invalide.", fields: fieldsOf(parsed.error) }, 400);
    }
    const input = parsed.data;

    const claim = db
      .insert(settings)
      .values({ key: SETUP_CLAIM_KEY, value: { startedAt: Date.now() } })
      .onConflictDoNothing()
      .run();
    if (claim.changes === 0) {
      // Someone else holds the claim: refused, unless it is older than the takeover delay — a
      // server crashed mid-install. The takeover is a conditional update, so two racing
      // servers cannot both take the claim over.
      const startedAt = sql`json_extract(${settings.value}, '$.startedAt')`;
      const takeover = db
        .update(settings)
        .set({ value: { startedAt: Date.now() } })
        .where(
          and(
            eq(settings.key, SETUP_CLAIM_KEY),
            sql`${startedAt} is null or ${startedAt} < ${Date.now() - SETUP_CLAIM_MAX_AGE_MS}`,
          ),
        )
        .run();
      if (takeover.changes === 0) {
        return conflict(context, "Une installation est déjà en cours.");
      }
    }

    try {
      if (setupStatus(db).installed) {
        return conflict(context, "L'instance est déjà installée.");
      }

      let authResponse: Response;
      try {
        authResponse = await auth.api.signUpEmail({
          body: {
            name: input.owner.name,
            email: input.owner.email,
            password: input.owner.password,
          },
          asResponse: true,
        });
      } catch (error) {
        logger.error("Échec de la création du compte propriétaire", error);
        removeOrphanAccount(db, input.owner.email);
        return context.json({ error: "La création du compte a échoué." }, 500);
      }
      if (authResponse.status !== 200) {
        // Only user creation can fail here, and Better Auth throws for it: an error response
        // means something unexpected happened, logged and reported as a failed installation.
        logger.error(`Installation : réponse inattendue de Better Auth (${authResponse.status})`);
        removeOrphanAccount(db, input.owner.email);
        return context.json({ error: "La création du compte a échoué." }, 500);
      }
      const payload = (await authResponse.json()) as {
        token?: unknown;
        user?: { id?: unknown; name?: unknown; email?: unknown };
      };
      const ownerId = typeof payload.user?.id === "string" ? payload.user.id : null;
      if (ownerId === null) {
        logger.error("Installation : Better Auth n'a pas renvoyé l'identifiant du compte créé");
        removeOrphanAccount(db, input.owner.email);
        return context.json({ error: "La création du compte a échoué." }, 500);
      }
      const ownerName =
        typeof payload.user?.name === "string" ? payload.user.name : input.owner.name;
      const ownerEmail =
        typeof payload.user?.email === "string" ? payload.user.email : input.owner.email;

      // From here on everything runs synchronously on the SQLite connection: no other request
      // can interleave. Sports are deduplicated; colors and name are stored as given.
      const sports = [...new Set(input.club.sports)];
      try {
        // One transaction: an owner without the identity of the club, or the reverse, must
        // never be stored — the three writes commit together or are rolled back together.
        // (`writeAudit` runs on the same connection as the transaction: its statement is part
        // of it, and its failure rolls the whole installation back.)
        db.transaction(() => {
          db.update(user).set({ role: "owner" }).where(eq(user.id, ownerId)).run();
          db.insert(settings)
            .values([
              { key: CLUB_NAME_KEY, value: input.club.name },
              { key: CLUB_SPORTS_KEY, value: sports },
              { key: CLUB_COLORS_KEY, value: input.club.colors },
            ])
            .onConflictDoUpdate({ target: settings.key, set: { value: sql`excluded.value` } })
            .run();
          audit(db, {
            actorId: ownerId,
            action: "setup.completed",
            targetType: "instance",
            targetId: "self",
            details: { clubName: input.club.name, sports, ownerEmail },
          });
        });
      } catch (error) {
        // The account must not survive a half-installed instance without its owner role.
        db.delete(user).where(eq(user.id, ownerId)).run();
        throw error;
      }

      const response = context.json(
        {
          club: { name: input.club.name, sports, colors: input.club.colors },
          owner: { id: ownerId, name: ownerName, email: ownerEmail },
        },
        201,
      );
      for (const cookie of authResponse.headers.getSetCookie()) {
        response.headers.append("set-cookie", cookie);
      }
      return response;
    } catch (error) {
      logger.error("Échec de l'installation", error);
      return context.json({ error: "L'installation a échoué." }, 500);
    } finally {
      db.delete(settings).where(eq(settings.key, SETUP_CLAIM_KEY)).run();
    }
  };
}
