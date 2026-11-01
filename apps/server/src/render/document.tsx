import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/** Metadata of a page, for browsers, search engines and social networks. */
export interface PageHead {
  readonly title: string;
  readonly description?: string | undefined;
  /** Absolute URL of the page; when set, the OpenGraph tags are added. */
  readonly canonicalUrl?: string | undefined;
  /** Absolute URL of the image shown when the page is shared. */
  readonly imageUrl?: string | undefined;
  /** Keeps the page out of search engines (error pages). */
  readonly noIndex?: boolean;
}

interface DocumentProps {
  readonly head: PageHead;
  /** Stylesheet of the theme; absent only for the error page shown when the theme is broken. */
  readonly stylesheetHref: string | undefined;
  readonly children: ReactNode;
}

function Document({ head, stylesheetHref, children }: DocumentProps) {
  const { title, description, canonicalUrl, imageUrl, noIndex = false } = head;
  return (
    <html lang="fr">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{title}</title>
        {description !== undefined && <meta name="description" content={description} />}
        {noIndex && <meta name="robots" content="noindex" />}
        {canonicalUrl !== undefined && (
          <>
            <link rel="canonical" href={canonicalUrl} />
            <meta property="og:type" content="website" />
            <meta property="og:locale" content="fr_FR" />
            <meta property="og:url" content={canonicalUrl} />
            <meta property="og:title" content={title} />
            {description !== undefined && <meta property="og:description" content={description} />}
            {imageUrl !== undefined && <meta property="og:image" content={imageUrl} />}
          </>
        )}
        {stylesheetHref !== undefined && <link rel="stylesheet" href={stylesheetHref} />}
      </head>
      <body>
        <main id="contenu">{children}</main>
      </body>
    </html>
  );
}

/** Complete HTML document of a public page: static markup, no script. */
export function renderDocument(
  head: PageHead,
  stylesheetHref: string | undefined,
  content: ReactNode,
): string {
  const markup = renderToStaticMarkup(
    <Document head={head} stylesheetHref={stylesheetHref}>
      {content}
    </Document>,
  );
  return `<!DOCTYPE html>${markup}`;
}

/** Body of a page that only shows a message (not found, server error). */
function MessagePage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="cms-section">
      <div className="cms-container cms-stack">
        <h1>{title}</h1>
        {children}
      </div>
    </section>
  );
}

/** Page sent with a 404, kept out of search engines. */
export function renderNotFoundPage(stylesheetHref: string | undefined): string {
  return renderDocument(
    { title: "Page introuvable", noIndex: true },
    stylesheetHref,
    <MessagePage title="Page introuvable">
      <p>La page demandée n'existe pas, ou n'est plus en ligne.</p>
      <p>
        <a href="/">Revenir à l'accueil</a>
      </p>
    </MessagePage>,
  );
}

/** Page sent with a 500: nothing about the cause reaches the visitor. */
export function renderServerErrorPage(stylesheetHref: string | undefined): string {
  return renderDocument(
    { title: "Erreur du serveur", noIndex: true },
    stylesheetHref,
    <MessagePage title="Une erreur est survenue">
      <p>Le site rencontre un problème. Réessayez dans quelques instants.</p>
    </MessagePage>,
  );
}
