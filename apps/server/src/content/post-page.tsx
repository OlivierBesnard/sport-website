import { defineBlock, MediaImage } from "@sport-cms/blocks";
import { POSTS_PATH_PREFIX, type PostView, SLUG_PATTERN } from "@sport-cms/core";
import type { Database } from "@sport-cms/db";
import type { PublishedPage } from "../pages.js";
import { readPost } from "./reader.js";

/**
 * The page of each published news item, `/actualites/<slug>`, made by the server: no page to
 * create, nothing to publish twice. It goes through the rendering of the pages (layout, cache,
 * ETag): its content is one block of the server, {@link postArticleBlock}, which the editor
 * never offers and the API of the pages refuses (it is not in the registry of the blocks).
 */

/** Type of the block of the article; not a type the editor or a module can use. */
export const POST_ARTICLE_TYPE = "_PostArticle";

const dayFormat = new Intl.DateTimeFormat("fr-FR", { dateStyle: "long" });

export const postArticleBlock = defineBlock<{ slug: string }, PostView | null>({
  type: POST_ARTICLE_TYPE,
  label: "Actualité",
  fields: { slug: { type: "text" } },
  defaultProps: { slug: "" },
  dependsOn: ["post.published", "post.updated", "media.updated"],
  loader: ({ slug }, { content }) => content.post(slug),
  render: ({ data: post }) => {
    if (post === null) {
      return null;
    }
    const meta = [
      dayFormat.format(new Date(post.publishedAt)),
      post.category?.name,
      post.team?.name,
    ]
      .filter((part) => part !== undefined && part !== "")
      .join(" · ");
    return (
      <article className="cms-section">
        <div className="cms-container cms-stack">
          <h1 className="cms-heading">{post.title}</h1>
          <p className="cms-post__meta">{meta}</p>
          {post.image !== null && (
            <MediaImage
              className="cms-post__image"
              media={post.image}
              sizes="(min-width: 72rem) 68rem, 100vw"
              eager
            />
          )}
          {post.excerpt !== "" && (
            <p>
              <strong>{post.excerpt}</strong>
            </p>
          )}
          {post.body.trim() !== "" && <p className="cms-plain-text">{post.body.trim()}</p>}
        </div>
      </article>
    );
  },
});

/** The page of the published news item at `path`, when there is one. */
export function findPostPage(db: Database, path: string): PublishedPage | undefined {
  const prefix = `${POSTS_PATH_PREFIX}/`;
  if (!path.startsWith(prefix)) {
    return undefined;
  }
  const slug = path.slice(prefix.length);
  if (!SLUG_PATTERN.test(slug)) {
    return undefined;
  }
  const post = readPost(db, slug);
  if (post === null) {
    return undefined;
  }
  return {
    title: post.title,
    description: post.excerpt === "" ? undefined : post.excerpt,
    image: post.image?.variants.at(-1)?.url,
    data: {
      root: { props: { title: post.title } },
      content: [{ type: POST_ARTICLE_TYPE, props: { id: "post", slug } }],
    },
  };
}
