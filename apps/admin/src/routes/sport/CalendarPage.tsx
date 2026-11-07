import {
  CALENDAR_EVENT_KIND_LABELS,
  CALENDAR_EVENT_KINDS,
  type CalendarEventKind,
} from "@sport-cms/core";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../api/session";
import { userCan } from "../../api/session";
import {
  type CalendarEvent,
  deleteEvent,
  listEvents,
  listSeasons,
  listTeams,
  listVenues,
  type Season,
  saveEvent,
  type Team,
  type Venue,
} from "../../api/sport";
import { Button, Card, Field, FormError, Input, Select } from "../../components/ui";
import {
  DeleteButton,
  dateTimeFormat,
  type FormErrors,
  formErrors,
  fromLocalInput,
  numberOrNull,
  PageHeader,
  Saved,
  TEXTAREA_CLASS,
  toLocalInput,
} from "./shared";

/**
 * The calendar of a season: matches (opponent, home or away, competition, score, report) and the
 * other events of the club. A coach edits the entries of the teams assigned to them, results
 * included; a club event (no team) belongs to whoever manages the sports content.
 */

interface EventDraft {
  readonly id?: number;
  readonly seasonId: number;
  readonly kind: CalendarEventKind;
  readonly teamId: string;
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venueId: string;
  readonly description: string;
  readonly home: boolean;
  readonly opponent: string;
  readonly competition: string;
  readonly scoreFor: string;
  readonly scoreAgainst: string;
  readonly report: string;
}

function toDraft(event: CalendarEvent): EventDraft {
  return {
    id: event.id,
    seasonId: event.seasonId,
    kind: event.kind,
    teamId: event.teamId === null ? "" : String(event.teamId),
    title: event.title,
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    venueId: event.venueId === null ? "" : String(event.venueId),
    description: event.description,
    home: event.match?.home ?? true,
    opponent: event.match?.opponent ?? "",
    competition: event.match?.competition ?? "",
    scoreFor:
      event.match?.scoreFor === null || event.match === null ? "" : String(event.match.scoreFor),
    scoreAgainst:
      event.match?.scoreAgainst === null || event.match === null
        ? ""
        : String(event.match.scoreAgainst),
    report: event.match?.report ?? "",
  };
}

/** What a score field holds: a number, nothing, or text the API will refuse. */
function scoreValue(value: string): number | null {
  const number = numberOrNull(value);
  return number === null || Number.isNaN(number) ? null : number;
}

export function CalendarPage({ user }: { user: SessionUser }) {
  const manage = userCan(user, "sport.manage");
  const [seasons, setSeasons] = useState<Season[]>();
  const [seasonId, setSeasonId] = useState<number>();
  const [events, setEvents] = useState<CalendarEvent[]>();
  const [teams, setTeams] = useState<Team[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<EventDraft>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const reload = useCallback(async (season?: number) => {
    try {
      const [seasonList, venueList] = await Promise.all([listSeasons(), listVenues()]);
      const chosen = season ?? seasonList.find((row) => row.current)?.id ?? seasonList.at(-1)?.id;
      setSeasons(seasonList);
      setVenues(venueList);
      setSeasonId(chosen);
      if (chosen === undefined) {
        setEvents([]);
        setTeams([]);
      } else {
        const [eventList, teamList] = await Promise.all([listEvents(chosen), listTeams(chosen)]);
        setEvents(eventList);
        setTeams(teamList);
      }
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const editableTeams = teams.filter((team) => team.canEdit);
  const teamName = (id: number | null) => teams.find((team) => team.id === id)?.name ?? "";
  const venueName = (id: number | null) => venues.find((venue) => venue.id === id)?.name ?? "";

  function update(changes: Partial<EventDraft>): void {
    setDraft((current) => (current === undefined ? current : { ...current, ...changes }));
  }

  async function submit(): Promise<void> {
    if (draft === undefined) {
      return;
    }
    setErrors({});
    const startsAt = fromLocalInput(draft.startsAt);
    if (startsAt === null) {
      setErrors({
        message: "L'événement contient des champs à corriger.",
        fields: { startsAt: "Choisissez la date et l'heure." },
      });
      return;
    }
    const scoreFields: Record<string, string> = {};
    for (const name of ["scoreFor", "scoreAgainst"] as const) {
      const number = numberOrNull(draft[name]);
      if (number !== null && !Number.isInteger(number)) {
        scoreFields[`match.${name}`] = "Le score est un nombre entier.";
      }
    }
    if (Object.keys(scoreFields).length > 0) {
      setErrors({ message: "Le score est à corriger.", fields: scoreFields });
      return;
    }
    try {
      await saveEvent(draft.id, {
        seasonId: draft.seasonId,
        kind: draft.kind,
        teamId: draft.teamId === "" ? null : Number(draft.teamId),
        title: draft.title,
        startsAt,
        endsAt: fromLocalInput(draft.endsAt),
        venueId: draft.venueId === "" ? null : Number(draft.venueId),
        description: draft.description,
        ...(draft.kind === "match"
          ? {
              match: {
                home: draft.home,
                opponent: draft.opponent,
                competition: draft.competition,
                scoreFor: scoreValue(draft.scoreFor),
                scoreAgainst: scoreValue(draft.scoreAgainst),
                report: draft.report,
              },
            }
          : {}),
      });
      setSaved(
        draft.kind === "match"
          ? `Match contre « ${draft.opponent} » enregistré : le site est mis à jour.`
          : `« ${draft.title} » enregistré.`,
      );
      setDraft(undefined);
      await reload(seasonId);
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement de l'événement a échoué."));
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Calendrier" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload(seasonId)}>
          Réessayer
        </Button>
      </section>
    );
  }

  const fieldError = (name: string) => errors.fields?.[name];
  const now = Date.now();
  const toScore = (events ?? []).filter(
    (event) => event.kind === "match" && event.startsAt < now && event.match?.scoreFor === null,
  );

  return (
    <section className="space-y-6">
      <PageHeader title="Calendrier">
        Matchs, tournois, stages et événements du club. Un score saisi apparaît aussitôt sur le site
        (blocs « Derniers résultats » et « Fiche équipe »).
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />
      {seasons?.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700">
            Aucune saison n'existe encore : créez-en une dans « Saisons » pour remplir le
            calendrier.
          </p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-56">
              <Field label="Saison" htmlFor="calendar-season">
                <Select
                  id="calendar-season"
                  value={seasonId ?? ""}
                  onChange={(event) => {
                    setDraft(undefined);
                    void reload(Number(event.target.value));
                  }}
                >
                  {(seasons ?? []).map((season) => (
                    <option key={season.id} value={season.id}>
                      {season.name}
                      {season.current ? " (en cours)" : ""}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {seasonId !== undefined && (manage || editableTeams.length > 0) && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft({
                    seasonId,
                    kind: "match",
                    teamId: editableTeams.length === 1 ? String(editableTeams[0]?.id) : "",
                    title: "",
                    startsAt: "",
                    endsAt: "",
                    venueId: "",
                    description: "",
                    home: true,
                    opponent: "",
                    competition: "",
                    scoreFor: "",
                    scoreAgainst: "",
                    report: "",
                  });
                  setErrors({});
                }}
              >
                Ajouter au calendrier
              </Button>
            )}
          </div>
          {toScore.length > 0 && (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {toScore.length} match{toScore.length > 1 ? "s" : ""} joué
              {toScore.length > 1 ? "s" : ""} sans score : saisissez le résultat.
            </p>
          )}
          {events?.length === 0 && (
            <p className="text-sm text-slate-600">Le calendrier de cette saison est vide.</p>
          )}
          <ul className="divide-y divide-slate-200">
            {(events ?? []).map((event) => (
              <li key={event.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-800">
                  <span className="text-slate-500">
                    {dateTimeFormat.format(new Date(event.startsAt))}
                  </span>{" "}
                  {event.kind === "match" && event.match !== null ? (
                    <>
                      <strong>{teamName(event.teamId)}</strong>{" "}
                      {event.match.home ? "reçoit" : "se déplace chez"}{" "}
                      <strong>{event.match.opponent}</strong>
                      {event.match.scoreFor !== null && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-semibold">
                          {event.match.scoreFor} – {event.match.scoreAgainst}
                        </span>
                      )}
                    </>
                  ) : (
                    <>
                      <strong>{event.title}</strong>{" "}
                      <span className="text-xs text-slate-500">
                        ({CALENDAR_EVENT_KIND_LABELS[event.kind]}
                        {event.teamId !== null && ` · ${teamName(event.teamId)}`})
                      </span>
                    </>
                  )}
                  {event.venueId !== null && (
                    <span className="text-xs text-slate-500"> · {venueName(event.venueId)}</span>
                  )}
                </span>
                {event.canEdit && (
                  <span className="flex gap-1">
                    <Button
                      variant="outline"
                      className="px-3 py-1 text-xs"
                      onClick={() => {
                        setDraft(toDraft(event));
                        setErrors({});
                      }}
                    >
                      {event.kind === "match" &&
                      event.match?.scoreFor === null &&
                      event.startsAt < now
                        ? "Saisir le score"
                        : "Modifier"}
                    </Button>
                    <DeleteButton
                      label={
                        event.kind === "match"
                          ? `le match contre ${event.match?.opponent ?? ""}`
                          : event.title
                      }
                      onConfirm={async () => {
                        setListError(undefined);
                        try {
                          await deleteEvent(event.id);
                          setSaved("Événement supprimé.");
                          await reload(seasonId);
                        } catch (error) {
                          setListError(
                            error instanceof Error ? error.message : "Suppression impossible.",
                          );
                        }
                      }}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {draft !== undefined && (
        <Card>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2 className="text-lg font-semibold text-slate-900">
              {draft.id === undefined ? "Nouvel événement" : "Modifier l'événement"}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type" htmlFor="event-kind" error={fieldError("kind")}>
                <Select
                  id="event-kind"
                  value={draft.kind}
                  disabled={draft.id !== undefined}
                  onChange={(event) => update({ kind: event.target.value as CalendarEventKind })}
                >
                  {CALENDAR_EVENT_KINDS.map((kind) => (
                    <option key={kind} value={kind}>
                      {CALENDAR_EVENT_KIND_LABELS[kind]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Équipe" htmlFor="event-team" error={fieldError("teamId")}>
                <Select
                  id="event-team"
                  value={draft.teamId}
                  onChange={(event) => update({ teamId: event.target.value })}
                >
                  {(manage || draft.kind !== "match") && (
                    <option value="">{draft.kind === "match" ? "Choisir…" : "Tout le club"}</option>
                  )}
                  {(manage ? teams : editableTeams).map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </Select>
              </Field>
              {draft.kind !== "match" && (
                <Field label="Titre" htmlFor="event-title" error={fieldError("title")}>
                  <Input
                    id="event-title"
                    value={draft.title}
                    onChange={(event) => update({ title: event.target.value })}
                  />
                </Field>
              )}
              <Field label="Début" htmlFor="event-start" error={fieldError("startsAt")}>
                <Input
                  id="event-start"
                  type="datetime-local"
                  value={draft.startsAt}
                  onChange={(event) => update({ startsAt: event.target.value })}
                />
              </Field>
              <Field label="Fin (facultatif)" htmlFor="event-end" error={fieldError("endsAt")}>
                <Input
                  id="event-end"
                  type="datetime-local"
                  value={draft.endsAt}
                  onChange={(event) => update({ endsAt: event.target.value })}
                />
              </Field>
              <Field label="Lieu" htmlFor="event-venue" error={fieldError("venueId")}>
                <Select
                  id="event-venue"
                  value={draft.venueId}
                  onChange={(event) => update({ venueId: event.target.value })}
                >
                  <option value="">Non précisé</option>
                  {venues.map((venue) => (
                    <option key={venue.id} value={venue.id}>
                      {venue.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            {draft.kind === "match" && (
              <fieldset className="space-y-3 rounded-md border border-slate-200 p-3">
                <legend className="px-1 text-sm font-medium text-slate-700">Match</legend>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Adversaire"
                    htmlFor="match-opponent"
                    error={fieldError("match.opponent")}
                  >
                    <Input
                      id="match-opponent"
                      value={draft.opponent}
                      onChange={(event) => update({ opponent: event.target.value })}
                    />
                  </Field>
                  <Field
                    label="Compétition"
                    htmlFor="match-competition"
                    error={fieldError("match.competition")}
                  >
                    <Input
                      id="match-competition"
                      value={draft.competition}
                      onChange={(event) => update({ competition: event.target.value })}
                    />
                  </Field>
                  <Field label="Lieu du match" htmlFor="match-home">
                    <Select
                      id="match-home"
                      value={draft.home ? "home" : "away"}
                      onChange={(event) => update({ home: event.target.value === "home" })}
                    >
                      <option value="home">À domicile</option>
                      <option value="away">À l'extérieur</option>
                    </Select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3 sm:w-80">
                  <Field
                    label="Score du club"
                    htmlFor="match-score-for"
                    error={fieldError("match.scoreFor")}
                  >
                    <Input
                      id="match-score-for"
                      inputMode="numeric"
                      value={draft.scoreFor}
                      onChange={(event) => update({ scoreFor: event.target.value })}
                    />
                  </Field>
                  <Field
                    label="Score de l'adversaire"
                    htmlFor="match-score-against"
                    error={fieldError("match.scoreAgainst")}
                  >
                    <Input
                      id="match-score-against"
                      inputMode="numeric"
                      value={draft.scoreAgainst}
                      onChange={(event) => update({ scoreAgainst: event.target.value })}
                    />
                  </Field>
                </div>
                <Field
                  label="Compte rendu"
                  htmlFor="match-report"
                  error={fieldError("match.report")}
                >
                  <textarea
                    id="match-report"
                    rows={3}
                    className={TEXTAREA_CLASS}
                    value={draft.report}
                    onChange={(event) => update({ report: event.target.value })}
                  />
                </Field>
              </fieldset>
            )}
            {draft.kind !== "match" && (
              <Field
                label="Description"
                htmlFor="event-description"
                error={fieldError("description")}
              >
                <textarea
                  id="event-description"
                  rows={3}
                  className={TEXTAREA_CLASS}
                  value={draft.description}
                  onChange={(event) => update({ description: event.target.value })}
                />
              </Field>
            )}
            <FormError message={errors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer</Button>
              <Button variant="outline" onClick={() => setDraft(undefined)}>
                Annuler
              </Button>
            </div>
          </form>
        </Card>
      )}
    </section>
  );
}
