import type { MediaView } from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import { BlockTitle } from "../sport/shared.js";
import { MEDIA_EVENTS, MediaImage } from "./shared.js";

export type GalleryProps = {
  title: string;
  images: { mediaId: number }[];
};

/** Most images in one gallery. */
export const MAX_GALLERY_IMAGES = 30;

/**
 * A grid of images of the media library, with their alternative text. An image deleted since,
 * or whose image rights were not checked, is left out; an image chosen twice shows once.
 */
export const galleryBlock = defineBlock<GalleryProps, readonly MediaView[]>({
  type: "Gallery",
  label: "Galerie",
  fields: {
    title: { type: "text", label: "Titre" },
    images: {
      type: "array",
      label: "Images",
      max: MAX_GALLERY_IMAGES,
      arrayFields: { mediaId: { type: "reference", source: "media", label: "Image" } },
      defaultItemProps: { mediaId: 0 },
    },
  },
  defaultProps: { title: "", images: [] },
  dependsOn: MEDIA_EVENTS,
  loader: ({ images }, { content }) => {
    const ids = [...new Set(images.map((image) => image.mediaId).filter((id) => id > 0))];
    return ids.length === 0 ? Promise.resolve([]) : content.media(ids);
  },
  render: ({ title, data }) =>
    data.length === 0 ? null : (
      <div className="cms-stack">
        <BlockTitle title={title} />
        <ul className="cms-gallery">
          {data.map((media) => (
            <li key={media.id}>
              <MediaImage
                className="cms-gallery__image"
                media={media}
                sizes="(min-width: 48rem) 33vw, 50vw"
              />
            </li>
          ))}
        </ul>
      </div>
    ),
});
