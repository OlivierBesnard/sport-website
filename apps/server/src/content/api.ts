import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { safeLinkUrl } from "@sport-cms/blocks";
import {
  isDay,
  MEDIA_RIGHTS,
  PARTNER_LEVELS,
  postPath,
  SLUG_PATTERN,
  slugify,
} from "@sport-cms/core";
import {
  calendarEvents,
  type Database,
  emitEvent,
  type JsonObject,
  media,
  partners,
  postCategories,
  posts,
  teams,
  writeAudit,
} from "@sport-cms/db";
import { asc, desc, eq, like } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { Logger } from "../app.js";
import type { Auth } from "../auth/create-auth.js";
import { type ApiEnv, requirePermission } from "../auth/middlewares.js";
import { fieldsOf } from "../fields.js";
import {
  MAX_MEDIA_BYTES,
  MEDIA_DIRECTORY,
  MEDIA_FILE_PATTERN,
  MediaRejectedError,
  mediaUrl,
  processImage,
  removeImage,
  storeImage,
} from "./media-store.js";

/**
 * Admin API of the editorial content (`pages.edit`, like the pages):
 *
 * - `/api/media`: `GET` (list), `POST` (multipart upload: `file`, `alt`, `rights` — the image
 *   rights are asked at once, never assumed), `PUT /:id` (`{ alt, rights }`), `DELETE /:id`;
 * - `/api/post-categories`: `GET`, `POST`, `PUT /:id`, `DELETE /:id`;
 * - `/api/posts`: `GET`, `GET /:id`, `POST` (a draft), `PUT /:id`, `POST /:id/publish`,
 *   `POST /:id/unpublish`, `DELETE /:id`;
 * - `/api/partners`: `GET`, `POST`, `PUT /:id`, `DELETE /:id`.
 *
 * And the public files of the media, `GET /media/<file>.webp`: cached for good, except those of
 * a medium whose image rights were not checked, served only to a signed-in account.
 *
 * Events (source `core`, in the transaction of the change): `media.uploaded`, `media.updated`
 * (alt text, rights, deletion), `post.published`, `post.updated` (a published news item edited,
 * unpublished or deleted, a category renamed or deleted), `partner.updated`.
 */

/** Paths of this API under `/api`. */
export const CONTENT_API_PREFIXES = ["/media", "/post-categories", "/posts", "/partners"] as const;

export interface ContentApiDependencies {
  readonly auth: Auth;
  readonly db: Database;
  /** `DATA_DIR`: the files go to its `media` directory. */
  readonly dataDir: string;
  readonly logger?: Logger;
  /** Called after a change emitted events: the dispatcher delivers them without waiting. */
  readonly onEmitted?: () => void;
}

const INVALID = "Requête invalide.";

class HttpError extends Error {
  readonly status: 400 | 404 | 409 | 413;
  readonly fields: Record<string, string> | undefined;

  constructor(status: 400 | 404 | 409 | 413, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

function invalidField(field: string, message: string): HttpError {
  return new HttpError(400, INVALID, { [field]: message });
}

function isUniqueViolation(error: unknown): boolean {
  for (let current = error; current instanceof Error; current = current.cause) {
    if ((current as { code?: unknown }).code === "SQLITE_CONSTRAINT_UNIQUE") {
      return true;
    }
  }
  return false;
}

function parse<Schema extends z.ZodType>(schema: Schema, raw: unknown): z.output<Schema> {
  const parsed = schema.safeParse(raw, { reportInput: true });
  if (!parsed.success) {
    throw new HttpError(400, INVALID, fieldsOf(parsed.error));
  }
  return parsed.data;
}

async function parseBody<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  return parse(schema, await context.req.json().catch(() => undefined));
}

function idParam(context: Context): number {
  const text = context.req.param("id") ?? "";
  if (!/^[1-9]\d{0,15}$/.test(text)) {
    throw new HttpError(404, "Élément introuvable.");
  }
  return Number(text);
}

function emit(db: Database, type: string, payload: JsonObject): void {
  emitEvent(db, { type, source: "core", payload });
}

function text(max: number, label: string) {
  return z
    .string({ error: `${label} doit être un texte.` })
    .trim()
    .max(max, `${label} est trop long (${max} caractères maximum).`);
}

const optionalId = (label: string) =>
  z
    .number({ error: `${label} est invalide.` })
    .int(`${label} est invalide.`)
    .positive(`${label} est invalide.`)
    .nullable()
    .default(null);

const mediaUpdateSchema = z.object({
  alt: text(300, "Le texte alternatif").default(""),
  rights: z.enum(MEDIA_RIGHTS, { error: "Précisez si des personnes sont reconnaissables." }),
});

const categorySchema = z.object({
  name: text(60, "Le nom de la catégorie").min(1, "Le nom de la catégorie est requis."),
  position: z.number().int().min(0).max(10_000).default(0),
});

const postSchema = z.object({
  title: text(150, "Le titre").min(1, "Le titre est requis."),
  /** Derived from the title when empty. */
  slug: text(100, "L'adresse").default(""),
  excerpt: text(300, "Le résumé").default(""),
  body: text(50_000, "Le texte").default(""),
  categoryId: optionalId("La catégorie"),
  imageId: optionalId("L'image"),
  teamId: optionalId("L'équipe"),
  matchId: optionalId("Le match"),
  featured: z.boolean({ error: "« Mise en avant » est invalide." }).default(false),
});

type PostInput = z.output<typeof postSchema>;

const day = (label: string) =>
  z
    .string({ error: `${label} est invalide.` })
    .refine((value) => value === "" || isDay(value), `${label} doit être une date valide.`)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .default(null);

const partnerSchema = z
  .object({
    name: text(100, "Le nom du partenaire").min(1, "Le nom du partenaire est requis."),
    url: text(500, "L'adresse du site").default(""),
    logoId: optionalId("Le logo"),
    level: z.enum(PARTNER_LEVELS, { error: "Le niveau est invalide." }).default("other"),
    startsOn: day("La date de début"),
    endsOn: day("La date de fin"),
    position: z.number().int().min(0).max(10_000).default(0),
  })
  .refine(
    (partner) =>
      partner.startsOn === null || partner.endsOn === null || partner.startsOn <= partner.endsOn,
    { message: "La période doit finir après son début.", path: ["endsOn"] },
  );

export function contentApiRoutes({
  auth,
  db,
  dataDir,
  logger = console,
  onEmitted,
}: ContentApiDependencies): (app: Hono) => void {
  const directory = join(dataDir, MEDIA_DIRECTORY);
  const api = new Hono<ApiEnv>();
  // Mounted on `/api`: the check covers its own prefixes only, never the rest of the API.
  const requireEditor = requirePermission(auth, "pages.edit");
  for (const prefix of CONTENT_API_PREFIXES) {
    api.use(prefix, requireEditor);
    api.use(`${prefix}/*`, requireEditor);
  }
  api.onError((error, context) => {
    if (error instanceof HttpError) {
      return context.json(
        error.fields === undefined
          ? { error: error.message }
          : { error: error.message, fields: error.fields },
        error.status,
      );
    }
    logger.error(`Contenus : échec de ${context.req.method} ${context.req.path}`, error);
    return context.json({ error: "L'opération a échoué. Réessayez." }, 500);
  });

  function change<T>(conflict: string, run: () => T): T {
    let result: T;
    try {
      result = db.transaction(run);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new HttpError(409, conflict);
      }
      throw error;
    }
    onEmitted?.();
    return result;
  }

  const actor = (context: Context<ApiEnv>) => context.get("user").id;

  // Media ------------------------------------------------------------------------------------

  function mediaViews(id?: number) {
    return db
      .select()
      .from(media)
      .where(id === undefined ? undefined : eq(media.id, id))
      .orderBy(desc(media.createdAt), desc(media.id))
      .all()
      .map((row) => {
        const sorted = [...row.variants].sort((a, b) => a.width - b.width);
        return {
          id: row.id,
          originalName: row.originalName,
          mimeType: row.mimeType,
          size: row.size,
          width: row.width,
          height: row.height,
          alt: row.alt,
          rights: row.rights,
          url: mediaUrl(sorted.at(-1)?.file ?? ""),
          thumbnailUrl: mediaUrl(sorted[0]?.file ?? ""),
          createdAt: row.createdAt.getTime(),
        };
      });
  }

  function findMedia(id: number) {
    const row = db.select().from(media).where(eq(media.id, id)).get();
    if (row === undefined) {
      throw new HttpError(404, "Image introuvable.");
    }
    return row;
  }

  api.get("/media", (context) => context.json({ media: mediaViews() }));

  api.post(
    "/media",
    bodyLimit({
      // The image plus the other fields of the form and the multipart framing.
      maxSize: MAX_MEDIA_BYTES + 64 * 1024,
      onError: (context) =>
        context.json(
          {
            error: `L'image est trop volumineuse (${MAX_MEDIA_BYTES / 1024 / 1024} Mo au maximum).`,
          },
          413,
        ),
    }),
    async (context) => {
      const form = await context.req.parseBody().catch(() => undefined);
      const file = form?.file;
      if (!(file instanceof File)) {
        throw invalidField("file", "Choisissez une image à téléverser.");
      }
      const input = parse(mediaUpdateSchema, {
        alt: typeof form?.alt === "string" ? form.alt : "",
        rights: form?.rights,
      });
      let image: Awaited<ReturnType<typeof processImage>>;
      try {
        image = await processImage(new Uint8Array(await file.arrayBuffer()));
      } catch (error) {
        if (error instanceof MediaRejectedError) {
          throw invalidField("file", error.message);
        }
        throw error;
      }
      const variants = await storeImage(directory, image);
      let id: number;
      try {
        id = change("Cette image existe déjà.", () => {
          const row = db
            .insert(media)
            .values({
              originalName: file.name.slice(0, 200) || "image",
              mimeType: image.mimeType,
              size: file.size,
              width: image.width,
              height: image.height,
              variants,
              alt: input.alt,
              rights: input.rights,
            })
            .returning({ id: media.id })
            .get();
          emit(db, "media.uploaded", { mediaId: row.id });
          return row.id;
        });
      } catch (error) {
        await removeImage(directory, variants);
        throw error;
      }
      return context.json({ media: mediaViews(id)[0] }, 201);
    },
  );

  api.put("/media/:id", async (context) => {
    const id = idParam(context);
    const input = await parseBody(context, mediaUpdateSchema);
    findMedia(id);
    change("", () => {
      db.update(media).set(input).where(eq(media.id, id)).run();
      emit(db, "media.updated", { mediaId: id });
    });
    return context.json({ media: mediaViews(id)[0] });
  });

  api.delete("/media/:id", async (context) => {
    const id = idParam(context);
    const row = findMedia(id);
    change("", () => {
      db.delete(media).where(eq(media.id, id)).run();
      emit(db, "media.updated", { mediaId: id, deleted: true });
      writeAudit(db, {
        actorId: actor(context),
        action: "media.deleted",
        targetType: "media",
        targetId: String(id),
        details: { name: row.originalName },
      });
    });
    await removeImage(directory, row.variants);
    return context.body(null, 204);
  });

  // Categories -------------------------------------------------------------------------------

  const CATEGORY_CONFLICT = "Une catégorie porte déjà ce nom.";
  const listCategories = () =>
    db
      .select({
        id: postCategories.id,
        name: postCategories.name,
        position: postCategories.position,
      })
      .from(postCategories)
      .orderBy(asc(postCategories.position), asc(postCategories.name))
      .all();

  function requireCategory(id: number): void {
    if (
      db
        .select({ id: postCategories.id })
        .from(postCategories)
        .where(eq(postCategories.id, id))
        .get() === undefined
    ) {
      throw new HttpError(404, "Catégorie introuvable.");
    }
  }

  api.get("/post-categories", (context) => context.json({ categories: listCategories() }));

  api.post("/post-categories", async (context) => {
    const input = await parseBody(context, categorySchema);
    const id = change(
      CATEGORY_CONFLICT,
      () => db.insert(postCategories).values(input).returning({ id: postCategories.id }).get().id,
    );
    return context.json({ category: listCategories().find((row) => row.id === id) }, 201);
  });

  api.put("/post-categories/:id", async (context) => {
    const id = idParam(context);
    const input = await parseBody(context, categorySchema);
    requireCategory(id);
    change(CATEGORY_CONFLICT, () => {
      db.update(postCategories).set(input).where(eq(postCategories.id, id)).run();
      emit(db, "post.updated", { categoryId: id });
    });
    return context.json({ category: listCategories().find((row) => row.id === id) });
  });

  api.delete("/post-categories/:id", (context) => {
    const id = idParam(context);
    requireCategory(id);
    change(CATEGORY_CONFLICT, () => {
      db.delete(postCategories).where(eq(postCategories.id, id)).run();
      emit(db, "post.updated", { categoryId: id, deleted: true });
    });
    return context.body(null, 204);
  });

  // Posts ------------------------------------------------------------------------------------

  const POST_CONFLICT = "Une actualité utilise déjà cette adresse : choisissez-en une autre.";

  function postViews(id?: number) {
    return db
      .select()
      .from(posts)
      .where(id === undefined ? undefined : eq(posts.id, id))
      .orderBy(desc(posts.updatedAt), desc(posts.id))
      .all()
      .map((row) => ({
        id: row.id,
        slug: row.slug,
        path: postPath(row.slug),
        title: row.title,
        excerpt: row.excerpt,
        body: row.body,
        categoryId: row.categoryId,
        imageId: row.imageId,
        teamId: row.teamId,
        matchId: row.matchId,
        featured: row.featured,
        status: row.status,
        publishedAt: row.publishedAt === null ? null : row.publishedAt.getTime(),
        updatedAt: row.updatedAt.getTime(),
      }));
  }

  function findPost(id: number) {
    const row = db.select().from(posts).where(eq(posts.id, id)).get();
    if (row === undefined) {
      throw new HttpError(404, "Actualité introuvable.");
    }
    return row;
  }

  /** Checks the references of a news item and gives its slug. */
  function checkPost(input: PostInput, ownId?: number): string {
    const slug =
      input.slug === "" ? slugify(input.title).slice(0, 100).replace(/-+$/, "") : input.slug;
    if (!SLUG_PATTERN.test(slug)) {
      throw invalidField(
        "slug",
        input.slug === ""
          ? "Le titre ne donne pas d'adresse : saisissez-en une (lettres, chiffres et tirets)."
          : "L'adresse ne contient que des lettres minuscules, des chiffres et des tirets.",
      );
    }
    const taken = db.select({ id: posts.id }).from(posts).where(eq(posts.slug, slug)).get();
    if (taken !== undefined && taken.id !== ownId) {
      throw new HttpError(409, POST_CONFLICT, { slug: POST_CONFLICT });
    }
    if (input.categoryId !== null) {
      requireReference(
        db
          .select({ id: postCategories.id })
          .from(postCategories)
          .where(eq(postCategories.id, input.categoryId))
          .get(),
        "categoryId",
        "Cette catégorie n'existe pas.",
      );
    }
    if (input.imageId !== null) {
      requireReference(
        db.select({ id: media.id }).from(media).where(eq(media.id, input.imageId)).get(),
        "imageId",
        "Cette image n'existe pas.",
      );
    }
    if (input.teamId !== null) {
      requireReference(
        db.select({ id: teams.id }).from(teams).where(eq(teams.id, input.teamId)).get(),
        "teamId",
        "Cette équipe n'existe pas.",
      );
    }
    if (input.matchId !== null) {
      const match = db
        .select({ kind: calendarEvents.kind })
        .from(calendarEvents)
        .where(eq(calendarEvents.id, input.matchId))
        .get();
      if (match?.kind !== "match") {
        throw invalidField("matchId", "Ce match n'existe pas.");
      }
    }
    return slug;
  }

  function requireReference(row: unknown, field: string, message: string): void {
    if (row === undefined) {
      throw invalidField(field, message);
    }
  }

  api.get("/posts", (context) => context.json({ posts: postViews() }));

  api.get("/posts/:id", (context) => {
    const id = idParam(context);
    findPost(id);
    return context.json({ post: postViews(id)[0] });
  });

  api.post("/posts", async (context) => {
    const input = await parseBody(context, postSchema);
    const slug = checkPost(input);
    const id = change(
      POST_CONFLICT,
      () =>
        db
          .insert(posts)
          .values({ ...input, slug })
          .returning({ id: posts.id })
          .get().id,
    );
    return context.json({ post: postViews(id)[0] }, 201);
  });

  api.put("/posts/:id", async (context) => {
    const id = idParam(context);
    const input = await parseBody(context, postSchema);
    const stored = findPost(id);
    const slug = checkPost(input, id);
    change(POST_CONFLICT, () => {
      db.update(posts)
        .set({ ...input, slug })
        .where(eq(posts.id, id))
        .run();
      if (stored.status === "published") {
        emit(db, "post.updated", { postId: id, slug, previousSlug: stored.slug });
      }
    });
    return context.json({ post: postViews(id)[0] });
  });

  api.post("/posts/:id/publish", (context) => {
    const id = idParam(context);
    const stored = findPost(id);
    change(POST_CONFLICT, () => {
      db.update(posts)
        .set({ status: "published", publishedAt: stored.publishedAt ?? new Date() })
        .where(eq(posts.id, id))
        .run();
      emit(db, "post.published", { postId: id, slug: stored.slug });
      writeAudit(db, {
        actorId: actor(context),
        action: "posts.published",
        targetType: "post",
        targetId: String(id),
      });
    });
    return context.json({ post: postViews(id)[0] });
  });

  api.post("/posts/:id/unpublish", (context) => {
    const id = idParam(context);
    const stored = findPost(id);
    change(POST_CONFLICT, () => {
      db.update(posts).set({ status: "draft" }).where(eq(posts.id, id)).run();
      if (stored.status === "published") {
        emit(db, "post.updated", { postId: id, slug: stored.slug, unpublished: true });
      }
    });
    return context.json({ post: postViews(id)[0] });
  });

  api.delete("/posts/:id", (context) => {
    const id = idParam(context);
    const stored = findPost(id);
    change(POST_CONFLICT, () => {
      db.delete(posts).where(eq(posts.id, id)).run();
      if (stored.status === "published") {
        emit(db, "post.updated", { postId: id, slug: stored.slug, deleted: true });
      }
      writeAudit(db, {
        actorId: actor(context),
        action: "posts.deleted",
        targetType: "post",
        targetId: String(id),
        details: { title: stored.title },
      });
    });
    return context.body(null, 204);
  });

  // Partners ---------------------------------------------------------------------------------

  const LINK_MESSAGE =
    "L'adresse du site est invalide : utilisez une adresse de la forme https://exemple.fr.";

  function partnerViews(id?: number) {
    return db
      .select()
      .from(partners)
      .where(id === undefined ? undefined : eq(partners.id, id))
      .orderBy(asc(partners.position), asc(partners.name), asc(partners.id))
      .all()
      .map(({ createdAt: _created, updatedAt: _updated, ...row }) => row);
  }

  async function partnerInput(context: Context) {
    const input = await parseBody(context, partnerSchema);
    if (input.url !== "" && !/^https?:\/\//i.test(safeLinkUrl(input.url) ?? "")) {
      throw invalidField("url", LINK_MESSAGE);
    }
    if (
      input.logoId !== null &&
      db.select({ id: media.id }).from(media).where(eq(media.id, input.logoId)).get() === undefined
    ) {
      throw invalidField("logoId", "Cette image n'existe pas.");
    }
    return input;
  }

  function requirePartner(id: number): void {
    if (
      db.select({ id: partners.id }).from(partners).where(eq(partners.id, id)).get() === undefined
    ) {
      throw new HttpError(404, "Partenaire introuvable.");
    }
  }

  api.get("/partners", (context) => context.json({ partners: partnerViews() }));

  api.post("/partners", async (context) => {
    const input = await partnerInput(context);
    const id = change("", () => {
      const row = db.insert(partners).values(input).returning({ id: partners.id }).get();
      emit(db, "partner.updated", { partnerId: row.id });
      return row.id;
    });
    return context.json({ partner: partnerViews(id)[0] }, 201);
  });

  api.put("/partners/:id", async (context) => {
    const id = idParam(context);
    const input = await partnerInput(context);
    requirePartner(id);
    change("", () => {
      db.update(partners).set(input).where(eq(partners.id, id)).run();
      emit(db, "partner.updated", { partnerId: id });
    });
    return context.json({ partner: partnerViews(id)[0] });
  });

  api.delete("/partners/:id", (context) => {
    const id = idParam(context);
    requirePartner(id);
    change("", () => {
      db.delete(partners).where(eq(partners.id, id)).run();
      emit(db, "partner.updated", { partnerId: id, deleted: true });
      writeAudit(db, {
        actorId: actor(context),
        action: "partners.deleted",
        targetType: "partner",
        targetId: String(id),
      });
    });
    return context.body(null, 204);
  });

  // Public files -----------------------------------------------------------------------------

  const files = new Hono();
  files.get("/:file", async (context) => {
    const file = context.req.param("file");
    if (!MEDIA_FILE_PATTERN.test(file)) {
      return context.notFound();
    }
    // The pattern leaves no LIKE wildcard in the name.
    const row = db
      .select({ rights: media.rights, variants: media.variants })
      .from(media)
      .where(like(media.variants, `%"file":"${file}"%`))
      .get();
    if (row === undefined || !row.variants.some((variant) => variant.file === file)) {
      return context.notFound();
    }
    const unverified = row.rights === "unverified";
    if (unverified) {
      // Not on the public site until its image rights are checked: the back-office only.
      const session = await auth.api.getSession({ headers: context.req.raw.headers });
      if (session === null) {
        return context.notFound();
      }
    }
    let data: Buffer;
    try {
      data = await readFile(join(directory, file));
    } catch (error) {
      logger.error(`Fichier du média ${file} illisible`, error);
      return context.notFound();
    }
    return context.body(new Uint8Array(data), 200, {
      "Content-Type": "image/webp",
      "Cache-Control": unverified ? "private, no-store" : "public, max-age=31536000, immutable",
    });
  });

  return (app) => {
    app.route("/api", api);
    app.route("/media", files);
  };
}
