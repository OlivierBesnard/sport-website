import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { NavigationLink } from "../navigation.js";

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
  /** Entries of the main menu, rendered above the content of every page. */
  readonly navigation?: readonly NavigationLink[] | undefined;
  readonly children: ReactNode;
}

/** The main menu of the site, above the page content; nothing at all when it is empty. */
function SiteNavigation({ links }: { links: readonly NavigationLink[] | undefined }) {
  if (links === undefined || links.length === 0) {
    return null;
  }
  // Two entries may share a target: each one keeps its own stable key.
  const seen = new Map<string, number>();
  return (
    <nav className="cms-nav" aria-label="Menu principal">
      <div className="cms-container cms-nav__inner">
        <ul className="cms-nav__list">
          {links.map((link) => {
            const count = seen.get(link.href) ?? 0;
            seen.set(link.href, count + 1);
            return (
              <li key={count === 0 ? link.href : `${link.href}#${count}`}>
                <a className="cms-nav__link" href={link.href}>
                  {link.label}
                </a>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}

function Document({ head, stylesheetHref, navigation, children }: DocumentProps) {
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
        <SiteNavigation links={navigation} />
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
  navigation?: readonly NavigationLink[],
): string {
  const markup = renderToStaticMarkup(
    <Document head={head} stylesheetHref={stylesheetHref} navigation={navigation}>
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
