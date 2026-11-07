import { MAX_POSTS_PER_QUERY, type PostSummaryView } from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import { safeLinkUrl } from "../../url.js";
import { BlockTitle } from "../sport/shared.js";
import { formatDay, MEDIA_EVENTS, MediaImage } from "./shared.js";

/** Events after which the news shown are out of date. */
export const POST_EVENTS = ["post.published", "post.updated", ...MEDIA_EVENTS] as const;

export type NewsListProps = {
  title: string;
  count: number;
  /** `0`: every category. */
  categoryId: number;
  /** `0`: every team. */
  teamId: number;
  featuredOnly: boolean;
};

/** The latest published news, as cards linking to their pages. */
export const newsListBlock = defineBlock<NewsListProps, readonly PostSummaryView[]>({
  type: "NewsList",
  label: "Liste d'actualités",
  fields: {
    title: { type: "text", label: "Titre" },
    count: { type: "number", label: "Nombre d'actualités", min: 1, max: MAX_POSTS_PER_QUERY },
    categoryId: {
      type: "reference",
      source: "postCategories",
      label: "Catégorie",
      emptyLabel: "Toutes les catégories",
    },
    teamId: {
      type: "reference",
      source: "teams",
      label: "Équipe",
      emptyLabel: "Toutes les équipes",
    },
    featuredOnly: { type: "boolean", label: "Seulement les actualités mises en avant" },
  },
  defaultProps: { title: "Actualités", count: 6, categoryId: 0, teamId: 0, featuredOnly: false },
  dependsOn: POST_EVENTS,
  loader: ({ count, categoryId, teamId, featuredOnly }, { content }) =>
    content.posts({
      limit: count,
      ...(categoryId === 0 ? {} : { categoryId }),
      ...(teamId === 0 ? {} : { teamId }),
      ...(featuredOnly ? { featuredOnly } : {}),
    }),
  render: ({ title, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      {data.length === 0 ? (
        <p className="cms-sport-empty">Aucune actualité pour le moment.</p>
      ) : (
        <ul className="cms-news">
          {data.map((post) => {
            const href = safeLinkUrl(post.path);
            return (
              <li key={post.id} className="cms-news-card">
                {post.image !== null && (
                  <MediaImage
                    className="cms-news-card__image"
                    media={post.image}
                    sizes="(min-width: 48rem) 22rem, 100vw"
                  />
                )}
                <div className="cms-news-card__body">
                  <p className="cms-news-card__meta">
                    <time dateTime={new Date(post.publishedAt).toISOString()}>
                      {formatDay(post.publishedAt)}
                    </time>
                    {post.category !== null && ` · ${post.category.name}`}
                  </p>
                  <h3 className="cms-news-card__title">
                    {href === undefined ? post.title : <a href={href}>{post.title}</a>}
                  </h3>
                  {post.excerpt !== "" && <p>{post.excerpt}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ),
});
