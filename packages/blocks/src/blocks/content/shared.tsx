import type { MediaView } from "@sport-cms/core";
import type { ReactNode } from "react";
import { safeImageUrl } from "../../url.js";

/** Events after which media shown by a block are out of date (alt text, rights, deletion). */
export const MEDIA_EVENTS = ["media.updated"] as const;

/**
 * An image of the media library, in the size the browser needs (`srcset` of its WebP sizes),
 * lazily loaded, its proportions known before it arrives (`width`/`height`).
 */
export function MediaImage({
  media,
  sizes,
  className,
  eager = false,
}: {
  media: MediaView;
  /** Width the image takes on the page, for the browser to pick a size (`sizes`). */
  sizes: string;
  className?: string;
  eager?: boolean;
}): ReactNode {
  const variants = media.variants.filter((variant) => safeImageUrl(variant.url) !== undefined);
  const largest = variants.at(-1);
  if (largest === undefined) {
    return null;
  }
  return (
    <img
      className={className}
      src={largest.url}
      srcSet={variants.map((variant) => `${variant.url} ${variant.width}w`).join(", ")}
      sizes={sizes}
      width={largest.width}
      height={largest.height}
      alt={media.alt}
      loading={eager ? undefined : "lazy"}
      decoding="async"
    />
  );
}

const dayFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

/** « 7 novembre 2026 ». */
export function formatDay(time: number): string {
  return dayFormat.format(new Date(time));
}
