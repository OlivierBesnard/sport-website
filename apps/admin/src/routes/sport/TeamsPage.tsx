import { TEAM_GENDER_LABELS, TEAM_GENDERS, type TeamGender, WEEKDAYS } from "@sport-cms/core";
import { useCallback, useEffect, useState } from "react";
import type { SessionUser } from "../../api/session";
import { userCan } from "../../api/session";
import {
  type Account,
  deleteTeam,
  listCoaches,
  listSeasons,
  listSections,
  listTeams,
  listVenues,
  type Season,
  type Section,
  saveTeam,
  type Team,
  type TrainingSlot,
  type Venue,
} from "../../api/sport";
import { Button, Card, Field, FormError, Input, Select } from "../../components/ui";
import {
  DeleteButton,
  type FormErrors,
  formErrors,
  PageHeader,
  Saved,
  TEXTAREA_CLASS,
} from "./shared";

/**
 * Teams of a season: identity, presentation, training times and coaches. A coach sees every team
 * but edits only the presentation and the training times of the teams assigned to them; the
 * identity and the coaches belong to whoever manages the sports content.
 */

interface SlotDraft {
  readonly key: number;
  readonly weekday: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly venueId: string;
}

interface TeamDraft {
  readonly id?: number;
  readonly seasonId: number;
  readonly sectionId: string;
  readonly name: string;
  readonly category: string;
  readonly level: string;
  readonly gender: TeamGender;
  readonly description: string;
  readonly pagePath: string;
  readonly position: number;
  readonly slots: readonly SlotDraft[];
  readonly coachIds: readonly string[];
}

let nextKey = 1;

function slotDraft(slot?: TrainingSlot): SlotDraft {
  nextKey += 1;
  return {
    key: nextKey,
    weekday: slot === undefined ? "" : String(slot.weekday),
    startsAt: slot?.startsAt ?? "",
    endsAt: slot?.endsAt ?? "",
    venueId: slot?.venueId === null || slot?.venueId === undefined ? "" : String(slot.venueId),
  };
}

function toDraft(team: Team): TeamDraft {
  return {
    id: team.id,
    seasonId: team.seasonId,
    sectionId: team.sectionId === null ? "" : String(team.sectionId),
    name: team.name,
    category: team.category,
    level: team.level,
    gender: team.gender,
    description: team.description,
    pagePath: team.pagePath ?? "",
    position: team.position,
    slots: team.slots.map(slotDraft),
    coachIds: team.coaches.map((coach) => coach.id),
  };
}

export function TeamsPage({ user }: { user: SessionUser }) {
  const manage = userCan(user, "sport.manage");
  const [seasons, setSeasons] = useState<Season[]>();
  const [seasonId, setSeasonId] = useState<number>();
  const [teams, setTeams] = useState<Team[]>();
  const [sections, setSections] = useState<Section[]>([]);
  const [venues, setVenues] = useState<Venue[]>([]);
  const [coaches, setCoaches] = useState<Account[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<TeamDraft>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const reload = useCallback(
    async (season?: number) => {
      try {
        const [seasonList, sectionList, venueList, coachList] = await Promise.all([
          listSeasons(),
          listSections(),
          listVenues(),
          manage ? listCoaches() : Promise.resolve([]),
        ]);
        const chosen = season ?? seasonList.find((row) => row.current)?.id ?? seasonList.at(-1)?.id;
        setSeasons(seasonList);
        setSections(sectionList);
        setVenues(venueList);
        setCoaches(coachList);
        setSeasonId(chosen);
        setTeams(chosen === undefined ? [] : await listTeams(chosen));
        setLoadError(undefined);
      } catch (error) {
        setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
      }
    },
    [manage],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  function update(changes: Partial<TeamDraft>): void {
    setDraft((current) => (current === undefined ? current : { ...current, ...changes }));
  }

  function updateSlot(key: number, changes: Partial<SlotDraft>): void {
    setDraft((current) =>
      current === undefined
        ? current
        : {
            ...current,
            slots: current.slots.map((slot) => (slot.key === key ? { ...slot, ...changes } : slot)),
          },
    );
  }

  async function submit(): Promise<void> {
    if (draft === undefined) {
      return;
    }
    setErrors({});
    try {
      await saveTeam(draft.id, {
        seasonId: draft.seasonId,
        sectionId: draft.sectionId === "" ? null : Number(draft.sectionId),
        name: draft.name,
        category: draft.category,
        level: draft.level,
        gender: draft.gender,
        description: draft.description,
        pagePath: draft.pagePath,
        position: draft.position,
        slots: draft.slots.map((slot) => ({
          weekday: slot.weekday === "" ? 0 : Number(slot.weekday),
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          venueId: slot.venueId === "" ? null : Number(slot.venueId),
        })),
        ...(manage ? { coachIds: draft.coachIds } : {}),
      });
      setSaved(`Équipe « ${draft.name} » enregistrée.`);
      setDraft(undefined);
      await reload(seasonId);
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement de l'équipe a échoué."));
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Équipes" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload(seasonId)}>
          Réessayer
        </Button>
      </section>
    );
  }

  const identityLocked = !manage;
  const fieldError = (name: string) => errors.fields?.[name];

  return (
    <section className="space-y-6">
      <PageHeader title="Équipes">
        {manage
          ? "Les équipes de la saison, leurs horaires d'entraînement et leurs coachs."
          : "Vous pouvez modifier la présentation et les horaires des équipes qui vous sont confiées."}
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />
      {seasons?.length === 0 ? (
        <Card>
          <p className="text-sm text-slate-700">
            Aucune saison n'existe encore : créez-en une dans « Saisons » avant d'ajouter des
            équipes.
          </p>
        </Card>
      ) : (
        <Card className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="w-56">
              <Field label="Saison" htmlFor="teams-season">
                <Select
                  id="teams-season"
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
            {manage && seasonId !== undefined && (
              <Button
                variant="outline"
                onClick={() => {
                  setDraft({
                    seasonId,
                    sectionId: "",
                    name: "",
                    category: "",
                    level: "",
                    gender: "mixed",
                    description: "",
                    pagePath: "",
                    position: teams?.length ?? 0,
                    slots: [],
                    coachIds: [],
                  });
                  setErrors({});
                }}
              >
                Ajouter une équipe
              </Button>
            )}
          </div>
          {teams?.length === 0 && (
            <p className="text-sm text-slate-600">Aucune équipe pour cette saison.</p>
          )}
          <ul className="divide-y divide-slate-200">
            {(teams ?? []).map((team) => (
              <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className="text-sm text-slate-800">
                  <strong>{team.name}</strong>
                  {team.category !== "" && ` — ${team.category}`}
                  <span className="ml-2 text-xs text-slate-500">
                    {team.slots.length} créneau{team.slots.length > 1 ? "x" : ""}
                    {team.coaches.length > 0 &&
                      ` · ${team.coaches.map((coach) => coach.name).join(", ")}`}
                  </span>
                </span>
                {team.canEdit && (
                  <span className="flex gap-1">
                    <Button
                      variant="outline"
                      className="px-3 py-1 text-xs"
                      onClick={() => {
                        setDraft(toDraft(team));
                        setErrors({});
                      }}
                    >
                      Modifier
                    </Button>
                    {manage && (
                      <DeleteButton
                        label={`l'équipe ${team.name}`}
                        onConfirm={async () => {
                          setListError(undefined);
                          try {
                            await deleteTeam(team.id);
                            setSaved(`Équipe « ${team.name} » supprimée.`);
                            await reload(seasonId);
                          } catch (error) {
                            setListError(
                              error instanceof Error ? error.message : "Suppression impossible.",
                            );
                          }
                        }}
                      />
                    )}
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
              {draft.id === undefined ? "Nouvelle équipe" : `Modifier « ${draft.name} »`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom" htmlFor="team-name" error={fieldError("name")}>
                <Input
                  id="team-name"
                  value={draft.name}
                  disabled={identityLocked}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </Field>
              <Field
                label="Catégorie"
                htmlFor="team-category"
                hint="U13, Seniors, Loisirs…"
                error={fieldError("category")}
              >
                <Input
                  id="team-category"
                  value={draft.category}
                  disabled={identityLocked}
                  onChange={(event) => update({ category: event.target.value })}
                />
              </Field>
              <Field label="Niveau" htmlFor="team-level" error={fieldError("level")}>
                <Input
                  id="team-level"
                  value={draft.level}
                  disabled={identityLocked}
                  onChange={(event) => update({ level: event.target.value })}
                />
              </Field>
              <Field label="Genre" htmlFor="team-gender" error={fieldError("gender")}>
                <Select
                  id="team-gender"
                  value={draft.gender}
                  disabled={identityLocked}
                  onChange={(event) => update({ gender: event.target.value as TeamGender })}
                >
                  {TEAM_GENDERS.map((gender) => (
                    <option key={gender} value={gender}>
                      {TEAM_GENDER_LABELS[gender]}
                    </option>
                  ))}
                </Select>
              </Field>
              {sections.length > 0 && (
                <Field label="Section" htmlFor="team-section" error={fieldError("sectionId")}>
                  <Select
                    id="team-section"
                    value={draft.sectionId}
                    disabled={identityLocked}
                    onChange={(event) => update({ sectionId: event.target.value })}
                  >
                    <option value="">Aucune</option>
                    {sections.map((section) => (
                      <option key={section.id} value={section.id}>
                        {section.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              )}
              <Field
                label="Page de l'équipe sur le site"
                htmlFor="team-page"
                hint="Chemin de la page qui présente l'équipe, ex. /equipes/u13"
                error={fieldError("pagePath")}
              >
                <Input
                  id="team-page"
                  value={draft.pagePath}
                  disabled={identityLocked}
                  onChange={(event) => update({ pagePath: event.target.value })}
                />
              </Field>
            </div>
            <Field
              label="Présentation"
              htmlFor="team-description"
              error={fieldError("description")}
            >
              <textarea
                id="team-description"
                rows={4}
                className={TEXTAREA_CLASS}
                value={draft.description}
                onChange={(event) => update({ description: event.target.value })}
              />
            </Field>

            <fieldset className="space-y-2">
              <legend className="text-sm font-medium text-slate-700">Entraînements</legend>
              {draft.slots.length === 0 && (
                <p className="text-sm text-slate-500">Aucun créneau d'entraînement.</p>
              )}
              {draft.slots.map((slot, index) => (
                <div
                  key={slot.key}
                  className="flex flex-wrap items-end gap-2 rounded-md border border-slate-200 p-2"
                >
                  <div className="w-36">
                    <Field
                      label="Jour"
                      htmlFor={`slot-${slot.key}-day`}
                      error={fieldError(`slots.${index}.weekday`)}
                    >
                      <Select
                        id={`slot-${slot.key}-day`}
                        value={slot.weekday}
                        onChange={(event) => updateSlot(slot.key, { weekday: event.target.value })}
                      >
                        <option value="">Choisir…</option>
                        {WEEKDAYS.map((day) => (
                          <option key={day.value} value={day.value}>
                            {day.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field
                      label="Début"
                      htmlFor={`slot-${slot.key}-start`}
                      error={fieldError(`slots.${index}.startsAt`)}
                    >
                      <Input
                        id={`slot-${slot.key}-start`}
                        type="time"
                        value={slot.startsAt}
                        onChange={(event) => updateSlot(slot.key, { startsAt: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="w-28">
                    <Field
                      label="Fin"
                      htmlFor={`slot-${slot.key}-end`}
                      error={fieldError(`slots.${index}.endsAt`)}
                    >
                      <Input
                        id={`slot-${slot.key}-end`}
                        type="time"
                        value={slot.endsAt}
                        onChange={(event) => updateSlot(slot.key, { endsAt: event.target.value })}
                      />
                    </Field>
                  </div>
                  <div className="min-w-40 flex-1">
                    <Field
                      label="Lieu"
                      htmlFor={`slot-${slot.key}-venue`}
                      error={fieldError(`slots.${index}.venueId`)}
                    >
                      <Select
                        id={`slot-${slot.key}-venue`}
                        value={slot.venueId}
                        onChange={(event) => updateSlot(slot.key, { venueId: event.target.value })}
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
                  <Button
                    variant="outline"
                    className="px-3 py-1.5 text-xs"
                    onClick={() =>
                      update({ slots: draft.slots.filter((other) => other.key !== slot.key) })
                    }
                  >
                    Retirer
                  </Button>
                </div>
              ))}
              <Button
                variant="outline"
                onClick={() => update({ slots: [...draft.slots, slotDraft()] })}
              >
                Ajouter un créneau
              </Button>
            </fieldset>

            {manage && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium text-slate-700">Coachs</legend>
                {coaches.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    Aucun compte de rôle « coach » : les coachs pourront être ajoutés dès qu'ils
                    auront un compte.
                  </p>
                ) : (
                  coaches.map((coach) => (
                    <label
                      key={coach.id}
                      className="flex items-center gap-2 text-sm text-slate-800"
                    >
                      <input
                        type="checkbox"
                        checked={draft.coachIds.includes(coach.id)}
                        onChange={(event) =>
                          update({
                            coachIds: event.target.checked
                              ? [...draft.coachIds, coach.id]
                              : draft.coachIds.filter((id) => id !== coach.id),
                          })
                        }
                      />
                      {coach.name} ({coach.email})
                    </label>
                  ))
                )}
              </fieldset>
            )}
            <FormError message={errors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer l'équipe</Button>
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
