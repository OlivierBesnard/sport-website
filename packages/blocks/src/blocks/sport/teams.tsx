import type { MatchView, TeamSummaryView, TeamView, TrainingSlotView } from "@sport-cms/core";
import { defineBlock } from "../../types.js";
import {
  BlockTitle,
  MATCH_EVENTS,
  MatchList,
  PlainText,
  pageHref,
  ScheduleTable,
  TEAM_EVENTS,
  teamMeta,
} from "./shared.js";

export type TeamGridProps = {
  title: string;
  /** `0`: every section. */
  sectionId: number;
};

/** The teams of the current season, as cards linking to their pages. */
export const teamGridBlock = defineBlock<TeamGridProps, readonly TeamSummaryView[]>({
  type: "TeamGrid",
  label: "Grille d'équipes",
  fields: {
    title: { type: "text", label: "Titre" },
    sectionId: {
      type: "reference",
      source: "sections",
      label: "Section",
      emptyLabel: "Toutes les sections",
    },
  },
  defaultProps: { title: "Nos équipes", sectionId: 0 },
  dependsOn: TEAM_EVENTS,
  loader: ({ sectionId }, { sport }) => sport.teams(sectionId === 0 ? {} : { sectionId }),
  render: ({ title, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      {data.length === 0 ? (
        <p className="cms-sport-empty">Les équipes de la saison seront bientôt présentées.</p>
      ) : (
        <ul className="cms-team-grid">
          {data.map((team) => {
            const href = pageHref(team.pagePath);
            const meta = teamMeta(team);
            return (
              <li key={team.id} className="cms-team-card">
                <h3 className="cms-team-card__name">
                  {href === undefined ? team.name : <a href={href}>{team.name}</a>}
                </h3>
                {meta !== "" && <p className="cms-team-card__meta">{meta}</p>}
                {team.section !== null && (
                  <p className="cms-team-card__meta">{team.section.name}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  ),
});

export type TeamProfileProps = {
  teamId: number;
  showSchedule: boolean;
  showMatches: boolean;
};

export interface TeamProfileData {
  readonly team: TeamView | null;
  readonly upcoming: readonly MatchView[];
  readonly results: readonly MatchView[];
}

/** Matches shown by each list of a team profile. */
const PROFILE_MATCHES = 3;

/**
 * Presentation of one team: its category, its description, its training times, and its next
 * matches and latest results. Nothing when the team was not chosen or was deleted.
 */
export const teamProfileBlock = defineBlock<TeamProfileProps, TeamProfileData>({
  type: "TeamProfile",
  label: "Fiche équipe",
  fields: {
    teamId: { type: "reference", source: "teams", label: "Équipe" },
    showSchedule: { type: "boolean", label: "Afficher les horaires d'entraînement" },
    showMatches: { type: "boolean", label: "Afficher les prochains matchs et les résultats" },
  },
  defaultProps: { teamId: 0, showSchedule: true, showMatches: true },
  dependsOn: [...new Set([...TEAM_EVENTS, ...MATCH_EVENTS])],
  loader: async ({ teamId, showMatches }, { sport, expiresAt }) => {
    if (teamId === 0) {
      return { team: null, upcoming: [], results: [] };
    }
    const [team, upcoming, results] = await Promise.all([
      sport.team(teamId),
      showMatches
        ? sport.matches({ teamId, when: "upcoming", limit: PROFILE_MATCHES })
        : Promise.resolve([]),
      showMatches
        ? sport.matches({ teamId, when: "results", limit: PROFILE_MATCHES })
        : Promise.resolve([]),
    ]);
    const first = upcoming[0];
    if (first !== undefined) {
      expiresAt(new Date(first.startsAt));
    }
    return { team, upcoming, results };
  },
  render: ({ showSchedule, showMatches, data }) => {
    const { team } = data;
    if (team === null) {
      return null;
    }
    const meta = teamMeta(team);
    return (
      <article className="cms-stack">
        <h2 className="cms-heading">{team.name}</h2>
        {meta !== "" && <p className="cms-team-card__meta">{meta}</p>}
        <PlainText text={team.description} />
        {showSchedule && team.slots.length > 0 && (
          <section className="cms-stack">
            <h3>Entraînements</h3>
            <ScheduleTable
              slots={team.slots}
              showTeam={false}
              caption={`Entraînements de l'équipe ${team.name}`}
            />
          </section>
        )}
        {showMatches && (
          <section className="cms-stack">
            <h3>Prochains matchs</h3>
            <MatchList matches={data.upcoming} empty="Aucun match à venir pour le moment." />
          </section>
        )}
        {showMatches && data.results.length > 0 && (
          <section className="cms-stack">
            <h3>Derniers résultats</h3>
            <MatchList matches={data.results} empty="" />
          </section>
        )}
      </article>
    );
  },
});

export type TrainingScheduleProps = {
  title: string;
  sectionId: number;
  teamId: number;
};

/** Training times of the current season, of every team, one section or one team. */
export const trainingScheduleBlock = defineBlock<
  TrainingScheduleProps,
  readonly TrainingSlotView[]
>({
  type: "TrainingSchedule",
  label: "Horaires d'entraînement",
  fields: {
    title: { type: "text", label: "Titre" },
    sectionId: {
      type: "reference",
      source: "sections",
      label: "Section",
      emptyLabel: "Toutes les sections",
    },
    teamId: {
      type: "reference",
      source: "teams",
      label: "Équipe",
      emptyLabel: "Toutes les équipes",
    },
  },
  defaultProps: { title: "Horaires d'entraînement", sectionId: 0, teamId: 0 },
  dependsOn: TEAM_EVENTS,
  loader: ({ sectionId, teamId }, { sport }) =>
    sport.trainingSlots({
      ...(sectionId === 0 ? {} : { sectionId }),
      ...(teamId === 0 ? {} : { teamId }),
    }),
  render: ({ title, teamId, data }) => (
    <div className="cms-stack">
      <BlockTitle title={title} />
      {data.length === 0 ? (
        <p className="cms-sport-empty">Les horaires de la saison seront bientôt publiés.</p>
      ) : (
        <ScheduleTable
          slots={data}
          showTeam={teamId === 0}
          caption={title.trim() === "" ? "Horaires d'entraînement" : title}
        />
      )}
    </div>
  ),
});
