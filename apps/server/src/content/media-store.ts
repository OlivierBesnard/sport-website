import { randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { StoredVariant } from "@sport-cms/db";
import sharp, { type Metadata } from "sharp";

/**
 * Storage of the uploaded images (PLAN §8.2): the type is read from the bytes, never from the
 * name or the declared type; only the usual photo formats are decoded; the image is turned
 * upright, stripped of its metadata (location, device…) and stored as WebP sizes in
 * `DATA_DIR/media`. The original bytes are never kept nor served.
 */

/** Directory of `DATA_DIR` holding the media files. */
export const MEDIA_DIRECTORY = "media";

/** Largest upload accepted: a photo straight from a phone. */
export const MAX_MEDIA_BYTES = 15 * 1024 * 1024;

/** Largest image decoded (pixels): beyond, an upload is refused before it fills the memory. */
export const MAX_MEDIA_PIXELS = 50_000_000;

/** Widths of the stored sizes; an image smaller than one keeps its own width as its largest. */
export const MEDIA_WIDTHS = [400, 800, 1600] as const;

/** A stored file: 32 hex characters, its width, `.webp`. */
export const MEDIA_FILE_PATTERN = /^[0-9a-f]{32}-[1-9]\d{0,4}\.webp$/;

export const IMAGE_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
} as const;

export type ImageType = keyof typeof IMAGE_TYPES;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return [...text].map((character) => character.charCodeAt(0));
}

/** The image type of `bytes`, by their signature; `undefined` for anything else. */
export function detectImageType(bytes: Uint8Array): ImageType | undefined {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return "jpeg";
  }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "png";
  }
  if (startsWith(bytes, ascii("RIFF")) && startsWith(bytes, ascii("WEBP"), 8)) {
    return "webp";
  }
  if (startsWith(bytes, ascii("GIF87a")) || startsWith(bytes, ascii("GIF89a"))) {
    return "gif";
  }
  if (
    startsWith(bytes, ascii("ftyp"), 4) &&
    (startsWith(bytes, ascii("avif"), 8) || startsWith(bytes, ascii("avis"), 8))
  ) {
    return "avif";
  }
  return undefined;
}

/** sharp's name of the format of each type (AVIF is decoded by its HEIF reader). */
const SHARP_FORMATS: Readonly<Record<ImageType, readonly string[]>> = {
  jpeg: ["jpeg"],
  png: ["png"],
  webp: ["webp"],
  gif: ["gif"],
  avif: ["heif", "avif"],
};

/** An upload refused, with the reason in French. */
export class MediaRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaRejectedError";
  }
}

export const NOT_AN_IMAGE =
  "Ce fichier n'est pas une image JPEG, PNG, WebP, GIF ou AVIF : il a été refusé.";

export interface ProcessedImage {
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  /** WebP sizes, smallest first. */
  readonly variants: readonly { width: number; height: number; data: Buffer }[];
}

/**
 * Checks and converts an upload.
 *
 * @throws {MediaRejectedError} when it is not one of the accepted image types (whatever its
 *   name or declared type), cannot be decoded, or is too large.
 */
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  if (bytes.byteLength > MAX_MEDIA_BYTES) {
    throw new MediaRejectedError(
      `L'image est trop volumineuse (${MAX_MEDIA_BYTES / 1024 / 1024} Mo au maximum).`,
    );
  }
  const type = detectImageType(bytes);
  if (type === undefined) {
    throw new MediaRejectedError(NOT_AN_IMAGE);
  }
  const options = { limitInputPixels: MAX_MEDIA_PIXELS, failOn: "error" as const };
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, options).metadata();
  } catch {
    throw new MediaRejectedError("Cette image est illisible ou trop grande : elle a été refusée.");
  }
  // The signature matched: the decoder must agree, else the file is a disguised one.
  if (metadata.format === undefined || !SHARP_FORMATS[type].includes(metadata.format)) {
    throw new MediaRejectedError(NOT_AN_IMAGE);
  }
  // Upright dimensions (a portrait photo is often stored landscape with an EXIF orientation).
  const rotated = (metadata.orientation ?? 1) >= 5;
  const width = rotated ? metadata.height : metadata.width;
  const height = rotated ? metadata.width : metadata.height;
  if (width === undefined || height === undefined || width < 1 || height < 1) {
    throw new MediaRejectedError("Cette image est illisible : elle a été refusée.");
  }
  const widths = [...new Set(MEDIA_WIDTHS.map((target) => Math.min(target, width)))];
  try {
    const variants = await Promise.all(
      widths.map(async (target) => {
        const { data, info } = await sharp(bytes, options)
          .rotate()
          .resize({ width: target, withoutEnlargement: true })
          .webp({ quality: 80 })
          .toBuffer({ resolveWithObject: true });
        return { width: info.width, height: info.height, data };
      }),
    );
    return { mimeType: IMAGE_TYPES[type], width, height, variants };
  } catch {
    throw new MediaRejectedError("Cette image n'a pas pu être convertie : elle a été refusée.");
  }
}

/** Public URL of a stored file. */
export function mediaUrl(file: string): string {
  return `/media/${file}`;
}

/**
 * Writes the sizes of an image under a fresh random name (temporary files renamed once
 * complete: a crash never leaves a half-written file under a served name).
 */
export async function storeImage(
  directory: string,
  image: ProcessedImage,
): Promise<StoredVariant[]> {
  await mkdir(directory, { recursive: true });
  const base = randomBytes(16).toString("hex");
  const stored: StoredVariant[] = [];
  try {
    for (const variant of image.variants) {
      const file = `${base}-${variant.width}.webp`;
      const temporary = join(directory, `.${file}.tmp`);
      await writeFile(temporary, variant.data);
      await rename(temporary, join(directory, file));
      stored.push({ file, width: variant.width, height: variant.height });
    }
  } catch (error) {
    await removeImage(directory, stored);
    throw error;
  }
  return stored;
}

/** Deletes the files of an image (those already gone are ignored). */
export async function removeImage(
  directory: string,
  variants: readonly StoredVariant[],
): Promise<void> {
  await Promise.all(
    variants
      .filter((variant) => MEDIA_FILE_PATTERN.test(variant.file))
      .map((variant) => rm(join(directory, variant.file), { force: true })),
  );
}
