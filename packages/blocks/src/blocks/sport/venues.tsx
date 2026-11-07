import type { VenueView } from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import { BlockTitle, PlainText } from "./shared.js";

export type VenuesProps = {
  title: string;
  /** `0`: every venue. */
  venueId: number;
  showMap: boolean;
};

/** Half the side of the area the map shows around a venue, in degrees (a few hundred meters). */
const MAP_SPAN = 0.004;

function coordinates(venue: VenueView): { lat: number; lon: number } | undefined {
  const { latitude: lat, longitude: lon } = venue;
  if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    return undefined;
  }
  return { lat, lon };
}

/** The OpenStreetMap embed of a point (the only frame the public CSP allows). */
export function osmEmbedUrl(lat: number, lon: number): string {
  const bbox = [lon - MAP_SPAN, lat - MAP_SPAN, lon + MAP_SPAN, lat + MAP_SPAN]
    .map((value) => value.toFixed(6))
    .join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat.toFixed(6)},${lon.toFixed(6)}`;
}

export function osmLinkUrl(lat: number, lon: number): string {
  return `https://www.openstreetmap.org/?mlat=${lat.toFixed(6)}&mlon=${lon.toFixed(6)}#map=17/${lat.toFixed(6)}/${lon.toFixed(6)}`;
}

/**
 * The venues of the club (or one of them): address, access, and an OpenStreetMap map when the
 * coordinates are known. The map is a sandboxed frame without the origin of OpenStreetMap
 * (`sandbox` without `allow-same-origin`): it can neither read nor write cookies, nor learn
 * which page it is shown on (`referrerpolicy="no-referrer"`).
 */
export const venuesBlock = defineBlock<VenuesProps, readonly VenueView[]>({
  type: "Venues",
  label: "Lieux et carte",
  fields: {
    title: { type: "text", label: "Titre" },
    venueId: {
      type: "reference",
      source: "venues",
      label: "Lieu",
      emptyLabel: "Tous les lieux",
    },
    showMap: { type: "boolean", label: "Afficher la carte (OpenStreetMap)" },
  },
  defaultProps: { title: "Nos installations", venueId: 0, showMap: true },
  dependsOn: ["venue.updated"],
  loader: ({ venueId }, { sport }) => sport.venues(venueId === 0 ? {} : { ids: [venueId] }),
  render: ({ title, showMap, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      {data.length === 0 ? (
        <p className="cms-sport-empty">Les lieux du club seront bientôt présentés.</p>
      ) : (
        <ul className="cms-venues">
          {data.map((venue) => {
            const point = coordinates(venue);
            const address = [venue.address, `${venue.postalCode} ${venue.city}`.trim()].filter(
              (line) => line !== "",
            );
            return (
              <li key={venue.id} className="cms-venue cms-stack">
                <h3 className="cms-venue__name">{venue.name}</h3>
                {address.length > 0 && (
                  <address className="cms-venue__address">
                    {address.map((line) => (
                      <span key={line} className="cms-venue__line">
                        {line}
                      </span>
                    ))}
                  </address>
                )}
                <PlainText text={venue.accessInfo} />
                {point !== undefined && showMap && (
                  <iframe
                    className="cms-map"
                    title={`Carte : ${venue.name}`}
                    src={osmEmbedUrl(point.lat, point.lon)}
                    loading="lazy"
                    sandbox="allow-scripts"
                    referrerPolicy="no-referrer"
                  />
                )}
                {point !== undefined && (
                  <p>
                    <a href={osmLinkUrl(point.lat, point.lon)} rel="noopener noreferrer">
                      Voir « {venue.name} » sur OpenStreetMap
                    </a>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ),
});
