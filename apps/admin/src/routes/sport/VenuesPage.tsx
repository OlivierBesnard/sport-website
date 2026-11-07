import { useCallback, useEffect, useState } from "react";
import { deleteVenue, listVenues, saveVenue, type Venue } from "../../api/sport";
import { Button, Card, Field, FormError, Input } from "../../components/ui";
import {
  DeleteButton,
  type FormErrors,
  formErrors,
  numberOrNull,
  PageHeader,
  Saved,
  TEXTAREA_CLASS,
} from "./shared";

/** Gyms, stadiums, swimming pools: where the teams train and play. */

interface VenueDraft {
  readonly id?: number;
  readonly name: string;
  readonly address: string;
  readonly postalCode: string;
  readonly city: string;
  readonly accessInfo: string;
  readonly latitude: string;
  readonly longitude: string;
}

const EMPTY: VenueDraft = {
  name: "",
  address: "",
  postalCode: "",
  city: "",
  accessInfo: "",
  latitude: "",
  longitude: "",
};

function toDraft(venue: Venue): VenueDraft {
  return {
    ...venue,
    latitude: venue.latitude === null ? "" : String(venue.latitude),
    longitude: venue.longitude === null ? "" : String(venue.longitude),
  };
}

export function VenuesPage() {
  const [venues, setVenues] = useState<Venue[]>();
  const [loadError, setLoadError] = useState<string>();
  const [draft, setDraft] = useState<VenueDraft>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [listError, setListError] = useState<string>();
  const [saved, setSaved] = useState<string>();

  const reload = useCallback(async () => {
    try {
      setVenues(await listVenues());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function submit(): Promise<void> {
    if (draft === undefined) {
      return;
    }
    setErrors({});
    const latitude = numberOrNull(draft.latitude);
    const longitude = numberOrNull(draft.longitude);
    const invalid: Record<string, string> = {};
    if (Number.isNaN(latitude)) {
      invalid.latitude = "Saisissez un nombre (ex. 45.7640).";
    }
    if (Number.isNaN(longitude)) {
      invalid.longitude = "Saisissez un nombre (ex. 4.8357).";
    }
    if (Object.keys(invalid).length > 0) {
      setErrors({ message: "Le lieu contient des champs à corriger.", fields: invalid });
      return;
    }
    try {
      await saveVenue(draft.id, {
        name: draft.name,
        address: draft.address,
        postalCode: draft.postalCode,
        city: draft.city,
        accessInfo: draft.accessInfo,
        latitude,
        longitude,
      });
      setSaved(`Lieu « ${draft.name} » enregistré.`);
      setDraft(undefined);
      await reload();
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement du lieu a échoué."));
    }
  }

  const field = (name: keyof VenueDraft) => ({
    id: `venue-${name}`,
    value: draft?.[name] ?? "",
    onChange: (event: { target: { value: string } }) =>
      setDraft((current) =>
        current === undefined ? current : { ...current, [name]: event.target.value },
      ),
  });

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Lieux" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Lieux">
        Les gymnases, stades et piscines du club, avec leur accès et leur position sur la carte.
      </PageHeader>
      <Saved message={saved} />
      <FormError message={listError} />
      <Card className="space-y-4">
        <div className="flex justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setDraft(EMPTY);
              setErrors({});
            }}
          >
            Ajouter un lieu
          </Button>
        </div>
        {venues?.length === 0 && (
          <p className="text-sm text-slate-600">Aucun lieu pour l'instant.</p>
        )}
        <ul className="divide-y divide-slate-200">
          {(venues ?? []).map((venue) => (
            <li key={venue.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm text-slate-800">
                <strong>{venue.name}</strong>
                {venue.city !== "" && ` — ${venue.city}`}
                {venue.latitude === null && (
                  <span className="ml-2 text-xs text-slate-500">(sans position sur la carte)</span>
                )}
              </span>
              <span className="flex gap-1">
                <Button
                  variant="outline"
                  className="px-3 py-1 text-xs"
                  onClick={() => {
                    setDraft(toDraft(venue));
                    setErrors({});
                  }}
                >
                  Modifier
                </Button>
                <DeleteButton
                  label={`le lieu ${venue.name}`}
                  onConfirm={async () => {
                    setListError(undefined);
                    try {
                      await deleteVenue(venue.id);
                      setSaved(`Lieu « ${venue.name} » supprimé.`);
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
        {draft !== undefined && (
          <form
            className="space-y-3 rounded-md border border-slate-200 p-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2 className="font-medium text-slate-900">
              {draft.id === undefined ? "Nouveau lieu" : `Modifier « ${draft.name} »`}
            </h2>
            <Field label="Nom" htmlFor="venue-name" error={errors.fields?.name}>
              <Input {...field("name")} />
            </Field>
            <Field label="Adresse" htmlFor="venue-address" error={errors.fields?.address}>
              <Input {...field("address")} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Code postal"
                htmlFor="venue-postalCode"
                error={errors.fields?.postalCode}
              >
                <Input {...field("postalCode")} />
              </Field>
              <Field label="Ville" htmlFor="venue-city" error={errors.fields?.city}>
                <Input {...field("city")} />
              </Field>
            </div>
            <Field
              label="Accès"
              htmlFor="venue-accessInfo"
              hint="Parking, transports, entrée à utiliser…"
              error={errors.fields?.accessInfo}
            >
              <textarea rows={3} className={TEXTAREA_CLASS} {...field("accessInfo")} />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                label="Latitude"
                htmlFor="venue-latitude"
                hint="Ex. 45.7640 (clic droit sur openstreetmap.org, « Afficher l'adresse »)"
                error={errors.fields?.latitude}
              >
                <Input inputMode="decimal" {...field("latitude")} />
              </Field>
              <Field
                label="Longitude"
                htmlFor="venue-longitude"
                hint="Ex. 4.8357"
                error={errors.fields?.longitude}
              >
                <Input inputMode="decimal" {...field("longitude")} />
              </Field>
            </div>
            <FormError message={errors.message} />
            <div className="flex gap-2">
              <Button type="submit">Enregistrer le lieu</Button>
              <Button variant="outline" onClick={() => setDraft(undefined)}>
                Annuler
              </Button>
            </div>
          </form>
        )}
      </Card>
    </section>
  );
}
