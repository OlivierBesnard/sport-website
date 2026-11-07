import { PARTNER_LEVEL_LABELS, PARTNER_LEVELS, type PartnerLevel } from "@sport-cms/core";
import { useCallback, useEffect, useState } from "react";
import { fetchReferences, NO_REFERENCES, type ReferenceOptions } from "../../api/block-data";
import { deletePartner, listPartners, type Partner, savePartner } from "../../api/content";
import { Button, Card, Field, FormError, Input, Select } from "../../components/ui";
import {
  DeleteButton,
  type FormErrors,
  formatDay,
  formErrors,
  PageHeader,
  Saved,
} from "../sport/shared";

/** Partners and sponsors: logo, site, level, period during which the site shows them. */

interface PartnerDraft {
  readonly id?: number;
  readonly name: string;
  readonly url: string;
  readonly logoId: string;
  readonly level: PartnerLevel;
  readonly startsOn: string;
  readonly endsOn: string;
  readonly position: number;
}

function toDraft(partner: Partner): PartnerDraft {
  return {
    ...partner,
    logoId: partner.logoId === null ? "" : String(partner.logoId),
    startsOn: partner.startsOn ?? "",
    endsOn: partner.endsOn ?? "",
  };
}

function period(partner: Partner): string {
  if (partner.startsOn === null && partner.endsOn === null) {
    return "toujours affiché";
  }
  if (partner.startsOn === null) {
    return `jusqu'au ${formatDay(partner.endsOn ?? "")}`;
  }
  if (partner.endsOn === null) {
    return `à partir du ${formatDay(partner.startsOn)}`;
  }
  return `du ${formatDay(partner.startsOn)} au ${formatDay(partner.endsOn)}`;
}

export function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>();
  const [references, setReferences] = useState<ReferenceOptions>(NO_REFERENCES);
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<PartnerDraft>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const reload = useCallback(async () => {
    try {
      const [list, options] = await Promise.all([listPartners(), fetchReferences()]);
      setPartners(list);
      setReferences(options);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  function update(changes: Partial<PartnerDraft>): void {
    setDraft((current) => (current === undefined ? current : { ...current, ...changes }));
  }

  async function submit(): Promise<void> {
    if (draft === undefined) {
      return;
    }
    setErrors({});
    try {
      await savePartner(draft.id, {
        name: draft.name,
        url: draft.url,
        logoId: draft.logoId === "" ? null : Number(draft.logoId),
        level: draft.level,
        startsOn: draft.startsOn,
        endsOn: draft.endsOn,
        position: draft.position,
      });
      setSaved(`Partenaire « ${draft.name} » enregistré.`);
      setDraft(undefined);
      await reload();
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement du partenaire a échoué."));
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Partenaires" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  const fieldError = (name: string) => errors.fields?.[name];

  return (
    <section className="space-y-6">
      <PageHeader title="Partenaires">
        Les partenaires apparaissent dans les blocs « Partenaires » pendant leur période, puis
        disparaissent d'eux-mêmes.
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />
      <Card className="space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setDraft({
                name: "",
                url: "",
                logoId: "",
                level: "other",
                startsOn: "",
                endsOn: "",
                position: partners?.length ?? 0,
              });
              setErrors({});
            }}
          >
            Ajouter un partenaire
          </Button>
        </div>
        {partners?.length === 0 && (
          <p className="text-sm text-slate-600">Aucun partenaire pour l'instant.</p>
        )}
        <ul className="divide-y divide-slate-200">
          {(partners ?? []).map((partner) => (
            <li key={partner.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-slate-800">
                <strong>{partner.name}</strong>
                <span className="text-slate-500">
                  {" "}
                  · {PARTNER_LEVEL_LABELS[partner.level]} · {period(partner)}
                </span>
              </span>
              <span className="flex gap-1">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    setDraft(toDraft(partner));
                    setErrors({});
                  }}
                >
                  Modifier
                </Button>
                <DeleteButton
                  label={`le partenaire ${partner.name}`}
                  onConfirm={async () => {
                    setListError(undefined);
                    try {
                      await deletePartner(partner.id);
                      setSaved(`Partenaire « ${partner.name} » supprimé.`);
                      await reload();
                    } catch (error) {
                      setListError(
                        error instanceof Error ? error.message : "Suppression impossible.",
                      );
                    }
                  }}
                />
              </span>
            </li>
          ))}
        </ul>
      </Card>

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
              {draft.id === undefined ? "Nouveau partenaire" : `Modifier « ${draft.name} »`}
            </h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Nom" htmlFor="partner-name" error={fieldError("name")}>
                <Input
                  id="partner-name"
                  value={draft.name}
                  onChange={(event) => update({ name: event.target.value })}
                />
              </Field>
              <Field label="Site" htmlFor="partner-url" hint="https://…" error={fieldError("url")}>
                <Input
                  id="partner-url"
                  value={draft.url}
                  onChange={(event) => update({ url: event.target.value })}
                />
              </Field>
              <Field label="Niveau" htmlFor="partner-level" error={fieldError("level")}>
                <Select
                  id="partner-level"
                  value={draft.level}
                  onChange={(event) => update({ level: event.target.value as PartnerLevel })}
                >
                  {PARTNER_LEVELS.map((level) => (
                    <option key={level} value={level}>
                      {PARTNER_LEVEL_LABELS[level]}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Logo"
                htmlFor="partner-logo"
                hint="Une image de la médiathèque."
                error={fieldError("logoId")}
              >
                <Select
                  id="partner-logo"
                  value={draft.logoId}
                  onChange={(event) => update({ logoId: event.target.value })}
                >
                  <option value="">Aucun (le nom est affiché)</option>
                  {references.media.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label="Début (facultatif)"
                htmlFor="partner-start"
                error={fieldError("startsOn")}
              >
                <Input
                  id="partner-start"
                  type="date"
                  value={draft.startsOn}
                  onChange={(event) => update({ startsOn: event.target.value })}
                />
              </Field>
              <Field label="Fin (facultative)" htmlFor="partner-end" error={fieldError("endsOn")}>
                <Input
                  id="partner-end"
                  type="date"
                  value={draft.endsOn}
                  onChange={(event) => update({ endsOn: event.target.value })}
                />
              </Field>
            </div>
            <FormError message={errors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer le partenaire</Button>
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
