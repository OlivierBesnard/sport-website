import {
  type MatchView,
  TEAM_GENDER_LABELS,
  type TeamSummaryView,
  type TrainingSlotView,
  weekdayLabel,
} from "@sport-cms/core";
import type { ReactNode } from "react";
import type { NumberField } from "../../types.js";
import { safeLinkUrl } from "../../url.js";

/*
 * Pieces shared by the blocks of the sports content: dates in French, the line of a match, the
 * description of a team. Dates show in the time zone of the renderer: the server's for the
 * public site (`TZ` of the instance), the browser's in the editor.
 */

/** Events after which the matches shown are out of date. */
export const MATCH_EVENTS = [
  "match.scheduled",
  "match.updated",
  "match.deleted",
  "match.result_published",
  "team.updated",
  "venue.updated",
] as const;

/** Events after which the teams of the current season are out of date. */
export const TEAM_EVENTS = [
  "team.updated",
  "season.updated",
  "section.updated",
  "venue.updated",
] as const;

export const matchCountField: NumberField = {
  type: "number",
  label: "Nombre de matchs",
  min: 1,
  max: 20,
};

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
});

const shortDateFormat = new Intl.DateTimeFormat("fr-FR", {
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** « samedi 14 novembre à 15:00 », capitalized. */
export function formatMatchDate(startsAt: number): string {
  const text = dateFormat.format(new Date(startsAt));
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** « sam. 14 nov. ». */
export function formatShortDate(startsAt: number): string {
  return shortDateFormat.format(new Date(startsAt));
}

/** Link to a page of the site, when the path is a safe one. */
export function pageHref(path: string | null | undefined): string | undefined {
  return path === null || path === undefined ? undefined : safeLinkUrl(path);
}

/** Name of the club's team, linked to its page when it has one. */
function TeamName({ team }: { team: MatchView["team"] }): ReactNode {
  if (team === null) {
    return <span>Le club</span>;
  }
  const href = pageHref(team.pagePath);
  return href === undefined ? <span>{team.name}</span> : <a href={href}>{team.name}</a>;
}

/** Outcome of a match for the club, in words (never conveyed by a color alone). */
export function outcome(match: MatchView): "win" | "draw" | "loss" | undefined {
  if (match.scoreFor === null || match.scoreAgainst === null) {
    return undefined;
  }
  if (match.scoreFor > match.scoreAgainst) {
    return "win";
  }
  return match.scoreFor === match.scoreAgainst ? "draw" : "loss";
}

const OUTCOME_LABELS = { win: "Victoire", draw: "Match nul", loss: "Défaite" } as const;

/**
 * One match: when, who against whom (the home side first), the score once published, the
 * competition and the place.
 */
export function MatchItem({ match }: { match: MatchView }): ReactNode {
  const club = <TeamName team={match.team} />;
  const opponent = <span>{match.opponent}</span>;
  const result = outcome(match);
  const homeScore = match.home ? match.scoreFor : match.scoreAgainst;
  const awayScore = match.home ? match.scoreAgainst : match.scoreFor;
  const details = [
    match.competition,
    match.home ? "À domicile" : "À l'extérieur",
    match.venue === null
      ? ""
      : `${match.venue.name}${match.venue.city === "" ? "" : `, ${match.venue.city}`}`,
  ].filter((part) => part !== "");
  return (
    <li className="cms-match">
      <time className="cms-match__date" dateTime={new Date(match.startsAt).toISOString()}>
        {formatMatchDate(match.startsAt)}
      </time>
      <p className="cms-match__teams">
        {match.home ? club : opponent}
        {result === undefined ? (
          <span className="cms-match__versus"> – </span>
        ) : (
          <span className="cms-match__score">
            {" "}
            {homeScore} – {awayScore}{" "}
          </span>
        )}
        {match.home ? opponent : club}
      </p>
      {result !== undefined && (
        <p className={`cms-match__outcome cms-match__outcome--${result}`}>
          {OUTCOME_LABELS[result]}
        </p>
      )}
      {details.length > 0 && <p className="cms-match__details">{details.join(" · ")}</p>}
    </li>
  );
}

export function MatchList({
  matches,
  empty,
}: {
  matches: readonly MatchView[];
  empty: string;
}): ReactNode {
  if (matches.length === 0) {
    return <p className="cms-sport-empty">{empty}</p>;
  }
  return (
    <ul className="cms-matches">
      {matches.map((match) => (
        <MatchItem key={match.id} match={match} />
      ))}
    </ul>
  );
}

/** « U13 · Départemental 1 · Mixte ». */
export function teamMeta(team: TeamSummaryView): string {
  return [team.category, team.level, TEAM_GENDER_LABELS[team.gender]]
    .filter((part) => part !== "")
    .join(" · ");
}

/** Plain text typed in the back-office, line breaks kept (`.cms-plain-text`). */
export function PlainText({ text }: { text: string }): ReactNode {
  return text.trim() === "" ? null : <p className="cms-plain-text">{text.trim()}</p>;
}

/** Training times as a table, by day then time. */
export function ScheduleTable({
  slots,
  showTeam,
  caption,
}: {
  slots: readonly TrainingSlotView[];
  showTeam: boolean;
  caption?: string;
}): ReactNode {
  const sorted = [...slots].sort(
    (a, b) =>
      a.weekday - b.weekday ||
      a.startsAt.localeCompare(b.startsAt) ||
      a.team.name.localeCompare(b.team.name, "fr"),
  );
  return (
    <div className="cms-table-wrap">
      <table className="cms-table">
        {caption !== undefined && <caption className="cms-visually-hidden">{caption}</caption>}
        <thead>
          <tr>
            <th scope="col">Jour</th>
            <th scope="col">Horaire</th>
            {showTeam && <th scope="col">Équipe</th>}
            <th scope="col">Lieu</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((slot) => (
            <tr key={slot.id}>
              <td>{weekdayLabel(slot.weekday)}</td>
              <td>
                {slot.startsAt.replace(":", " h ")} – {slot.endsAt.replace(":", " h ")}
              </td>
              {showTeam && <td>{slot.team.name}</td>}
              <td>{slot.venue?.name ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BlockTitle({ title }: { title: string }): ReactNode {
  return title.trim() === "" ? null : <h2 className="cms-heading">{title}</h2>;
}
