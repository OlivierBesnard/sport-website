import { useCallback, useEffect, useState } from "react";
import {
  deleteSeason,
  deleteSection,
  listSeasons,
  listSections,
  makeSeasonCurrent,
  type Season,
  type Section,
  saveSeason,
  saveSection,
} from "../../api/sport";
import { Button, Card, Field, FormError, Input } from "../../components/ui";
import { DeleteButton, type FormErrors, formatDay, formErrors, PageHeader, Saved } from "./shared";

/**
 * Seasons of the club (the current one is what the site shows) and sections of an omnisports
 * club. Reserved to whoever manages the sports content.
 */

interface SeasonDraft {
  readonly id?: number;
  readonly name: string;
  readonly startsOn: string;
  readonly endsOn: string;
}

/** A season starting this September (or last one, before July). */
export function suggestedSeason(today = new Date()): SeasonDraft {
  const start = today.getMonth() >= 6 ? today.getFullYear() : today.getFullYear() - 1;
  return {
    name: `${start}-${start + 1}`,
    startsOn: `${start}-09-01`,
    endsOn: `${start + 1}-06-30`,
  };
}

interface SectionDraft {
  readonly id?: number;
  readonly name: string;
  readonly sport: string;
}

export function SeasonsPage() {
  const [seasons, setSeasons] = useState<Season[]>();
  const [sections, setSections] = useState<Section[]>();
  const [loadError, setLoadError] = useState<string>();
  const [season, setSeason] = useState<SeasonDraft>();
  const [seasonErrors, setSeasonErrors] = useState<FormErrors>({});
  const [section, setSection] = useState<SectionDraft>();
  const [sectionErrors, setSectionErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [seasonList, sectionList] = await Promise.all([listSeasons(), listSections()]);
      setSeasons(seasonList);
      setSections(sectionList);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submitSeason(): Promise<void> {
    if (season === undefined) {
      return;
    }
    setSeasonErrors({});
    try {
      await saveSeason(season.id, {
        name: season.name,
        startsOn: season.startsOn,
        endsOn: season.endsOn,
      });
      setSaved(`Saison « ${season.name} » enregistrée.`);
      setSeason(undefined);
      await reload();
    } catch (error) {
      setSeasonErrors(formErrors(error, "L'enregistrement de la saison a échoué."));
    }
  }

  async function submitSection(): Promise<void> {
    if (section === undefined) {
      return;
    }
    setSectionErrors({});
    try {
      await saveSection(section.id, {
        name: section.name,
        sport: section.sport,
        position: sections?.find((row) => row.id === section.id)?.position ?? sections?.length ?? 0,
      });
      setSaved(`Section « ${section.name} » enregistrée.`);
      setSection(undefined);
      await reload();
    } catch (error) {
      setSectionErrors(formErrors(error, "L'enregistrement de la section a échoué."));
    }
  }

  async function run(action: () => Promise<unknown>, done: string): Promise<void> {
    setListError(undefined);
    setSaved(undefined);
    try {
      await action();
      setSaved(done);
      await reload();
    } catch (error) {
      setListError(error instanceof Error ? error.message : "L'opération a échoué.");
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Saisons et sections" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Saisons et sections">
        Les équipes, les horaires et le calendrier appartiennent à une saison. Le site public
        présente la saison en cours.
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-slate-900">Saisons</h2>
          <Button
            variant="outline"
            onClick={() => {
              setSeason(suggestedSeason());
              setSeasonErrors({});
            }}
          >
            Ajouter une saison
          </Button>
        </div>
        {seasons?.length === 0 && (
          <p className="text-sm text-slate-600">Aucune saison : commencez par en créer une.</p>
        )}
        <ul className="divide-y divide-slate-200">
          {(seasons ?? []).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-slate-800">
                <strong>{row.name}</strong> — du {formatDay(row.startsOn)} au{" "}
                {formatDay(row.endsOn)}
                {row.current && (
                  <span className="ml-2 rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-800">
                    en cours
                  </span>
                )}
              </span>
              <span className="flex flex-wrap gap-1">
                {!row.current && (
                  <Button
                    variant="outline"
                    className="px-3 py-1 text-xs"
                    onClick={() =>
                      void run(
                        () => makeSeasonCurrent(row.id),
                        `La saison ${row.name} est maintenant celle du site.`,
                      )
                    }
                  >
                    Rendre en cours
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    setSeason(row);
                    setSeasonErrors({});
                  }}
                >
                  Modifier
                </Button>
                <DeleteButton
                  label={`la saison ${row.name}`}
                  onConfirm={() => run(() => deleteSeason(row.id), `Saison ${row.name} supprimée.`)}
                />
              </span>
            </li>
          ))}
        </ul>
        {season !== undefined && (
          <form
            className="space-y-3 rounded-md border border-slate-200 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSeason();
            }}
          >
            <h3 className="font-medium text-slate-900">
              {season.id === undefined ? "Nouvelle saison" : `Modifier la saison ${season.name}`}
            </h3>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Nom" htmlFor="season-name" error={seasonErrors.fields?.name}>
                <Input
                  id="season-name"
                  value={season.name}
                  onChange={(event) => setSeason({ ...season, name: event.target.value })}
                />
              </Field>
              <Field label="Début" htmlFor="season-start" error={seasonErrors.fields?.startsOn}>
                <Input
                  id="season-start"
                  type="date"
                  value={season.startsOn}
                  onChange={(event) => setSeason({ ...season, startsOn: event.target.value })}
                />
              </Field>
              <Field label="Fin" htmlFor="season-end" error={seasonErrors.fields?.endsOn}>
                <Input
                  id="season-end"
                  type="date"
                  value={season.endsOn}
                  onChange={(event) => setSeason({ ...season, endsOn: event.target.value })}
                />
              </Field>
            </div>
            <FormError message={seasonErrors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer la saison</Button>
              <Button variant="outline" onClick={() => setSeason(undefined)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>

      <Card className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Sections</h2>
            <p className="text-sm text-slate-600">
              Pour un club omnisports (Football, Judo…). Un club d'un seul sport n'en a pas besoin.
            </p>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setSection({ name: "", sport: "" });
              setSectionErrors({});
            }}
          >
            Ajouter une section
          </Button>
        </div>
        <ul className="divide-y divide-slate-200">
          {(sections ?? []).map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-slate-800">
                <strong>{row.name}</strong>
                {row.sport !== "" && ` — ${row.sport}`}
              </span>
              <span className="flex gap-1">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    setSection(row);
                    setSectionErrors({});
                  }}
                >
                  Modifier
                </Button>
                <DeleteButton
                  label={`la section ${row.name}`}
                  onConfirm={() =>
                    run(() => deleteSection(row.id), `Section ${row.name} supprimée.`)
                  }
                />
              </span>
            </li>
          ))}
        </ul>
        {section !== undefined && (
          <form
            className="space-y-3 rounded-md border border-slate-200 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submitSection();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Nom de la section"
                htmlFor="section-name"
                error={sectionErrors.fields?.name}
              >
                <Input
                  id="section-name"
                  value={section.name}
                  onChange={(event) => setSection({ ...section, name: event.target.value })}
                />
              </Field>
              <Field label="Sport" htmlFor="section-sport" error={sectionErrors.fields?.sport}>
                <Input
                  id="section-sport"
                  value={section.sport}
                  onChange={(event) => setSection({ ...section, sport: event.target.value })}
                />
              </Field>
            </div>
            <FormError message={sectionErrors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer la section</Button>
              <Button variant="outline" onClick={() => setSection(undefined)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}
