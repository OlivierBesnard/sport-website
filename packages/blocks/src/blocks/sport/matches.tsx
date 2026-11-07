import type { MatchView } from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import { BlockTitle, MATCH_EVENTS, MatchList, matchCountField } from "./shared.js";

export type MatchesProps = {
  title: string;
  /** `0`: every team. */
  teamId: number;
  count: number;
};

const fields = {
  title: { type: "text", label: "Titre" },
  teamId: {
    type: "reference",
    source: "teams",
    label: "Équipe",
    emptyLabel: "Toutes les équipes",
  },
  count: matchCountField,
} as const;

/**
 * The next matches of the club (or of one team), from the calendar: soonest first, until their
 * kick-off (the page is rendered again then, without waiting for an event).
 */
export const upcomingMatchesBlock = defineBlock<MatchesProps, readonly MatchView[]>({
  type: "UpcomingMatches",
  label: "Prochains matchs",
  fields,
  defaultProps: { title: "Prochains matchs", teamId: 0, count: 5 },
  dependsOn: MATCH_EVENTS,
  loader: async ({ teamId, count }, { sport, expiresAt }) => {
    const matches = await sport.matches({
      when: "upcoming",
      limit: count,
      ...(teamId === 0 ? {} : { teamId }),
    });
    const first = matches[0];
    if (first !== undefined) {
      expiresAt(new Date(first.startsAt));
    }
    return matches;
  },
  render: ({ title, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      <MatchList matches={data} empty="Aucun match à venir pour le moment." />
    </div>
  ),
});

/** The latest results published, latest first. */
export const latestResultsBlock = defineBlock<MatchesProps, readonly MatchView[]>({
  type: "LatestResults",
  label: "Derniers résultats",
  fields,
  defaultProps: { title: "Derniers résultats", teamId: 0, count: 5 },
  dependsOn: MATCH_EVENTS,
  loader: ({ teamId, count }, { sport }) =>
    sport.matches({ when: "results", limit: count, ...(teamId === 0 ? {} : { teamId }) }),
  render: ({ title, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      <MatchList matches={data} empty="Aucun résultat pour le moment." />
    </div>
  ),
});
