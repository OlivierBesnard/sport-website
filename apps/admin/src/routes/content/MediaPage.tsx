import { MEDIA_RIGHTS, MEDIA_RIGHTS_LABELS, type MediaRights } from "@sport-cms/core";
import { useCallback, useEffect, useState } from "react";
import {
  deleteMedium,
  listMedia,
  type Medium,
  updateMedium,
  uploadMedium,
} from "../../api/content";
import { Button, Card, Field, FormError, Input } from "../../components/ui";
import { DeleteButton, type FormErrors, formErrors, PageHeader, Saved } from "../sport/shared";

/**
 * The media library: upload an image (its image rights are asked at once), give it an
 * alternative text, copy its address for a page, delete it. An image whose rights were not
 * checked stays off the public site.
 */

/** The image rights, as radio buttons; no choice is made for the person. */
function RightsChoice(props: {
  name: string;
  value: MediaRights | undefined;
  onChange: (value: MediaRights) => void;
  error?: string;
}) {
  return (
    <fieldset className="space-y-1">
      <legend className="text-sm font-medium text-slate-700">
        Des personnes sont-elles reconnaissables ?
      </legend>
      {MEDIA_RIGHTS.map((rights) => (
        <label key={rights} className="flex items-center gap-2 text-sm text-slate-800">
          <input
            type="radio"
            name={props.name}
            checked={props.value === rights}
            onChange={() => props.onChange(rights)}
          />
          {MEDIA_RIGHTS_LABELS[rights]}
        </label>
      ))}
      {props.error !== undefined && <p className="text-sm text-red-700">{props.error}</p>}
    </fieldset>
  );
}

function formatSize(bytes: number): string {
  return bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} Ko`
    : `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

function MediumCard({
  medium,
  onChanged,
}: {
  medium: Medium;
  onChanged: (message: string) => void;
}) {
  const [alt, setAlt] = useState(medium.alt);
  const [rights, setRights] = useState<MediaRights>(medium.rights);
  const [errors, setErrors] = useState<FormErrors>({});
  const dirty = alt !== medium.alt || rights !== medium.rights;
  return (
    <li className="space-y-2 rounded-md border border-slate-200 p-3">
      <div className="flex gap-3">
        <img
          src={medium.thumbnailUrl}
          alt=""
          width={96}
          className="h-24 w-24 shrink-0 rounded object-cover"
        />
        <div className="min-w-0 space-y-1 text-sm">
          <p className="truncate font-medium text-slate-900" title={medium.originalName}>
            {medium.originalName}
          </p>
          <p className="text-slate-500">
            {medium.width} × {medium.height} · {formatSize(medium.size)}
          </p>
          {medium.rights === "unverified" && (
            <p className="rounded bg-amber-100 px-1.5 py-0.5 text-xs font-semibold text-amber-900">
              Non publiée : autorisations à vérifier
            </p>
          )}
          <p className="break-all text-xs text-slate-500">
            Adresse : <code>{medium.url}</code>
          </p>
        </div>
      </div>
      <Field
        label="Texte alternatif"
        htmlFor={`alt-${medium.id}`}
        hint="Ce que montre l'image, pour qui ne la voit pas."
        error={errors.fields?.alt}
      >
        <Input
          id={`alt-${medium.id}`}
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
        />
      </Field>
      <RightsChoice
        name={`rights-${medium.id}`}
        value={rights}
        onChange={setRights}
        error={errors.fields?.rights}
      />
      <FormError message={errors.message} />
      <div className="flex flex-wrap gap-1">
        <Button
          className="px-3 py-1 text-xs"
          disabled={!dirty}
          onClick={async () => {
            setErrors({});
            try {
              await updateMedium(medium.id, { alt, rights });
              onChanged("Image enregistrée.");
            } catch (error) {
              setErrors(formErrors(error, "L'enregistrement de l'image a échoué."));
            }
          }}
        >
          Enregistrer
        </Button>
        <Button
          variant="outline"
          className="px-3 py-1 text-xs"
          onClick={() => void navigator.clipboard?.writeText(medium.url)}
        >
          Copier l'adresse
        </Button>
        <DeleteButton
          label={`l'image ${medium.originalName}`}
          onConfirm={async () => {
            try {
              await deleteMedium(medium.id);
              onChanged("Image supprimée.");
            } catch (error) {
              setErrors(formErrors(error, "La suppression a échoué."));
            }
          }}
        />
      </div>
    </li>
  );
}

export function MediaPage() {
  const [media, setMedia] = useState<Medium[]>();
  const [loadError, setLoadError] = useState<string>();
  const [file, setFile] = useState<File>();
  const [alt, setAlt] = useState("");
  const [rights, setRights] = useState<MediaRights>();
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saved, setSaved] = useState<string>();
  /** Bumped to empty the file input after an upload. */
  const [inputKey, setInputKey] = useState(0);

  const reload = useCallback(async () => {
    try {
      setMedia(await listMedia());
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function upload(): Promise<void> {
    setErrors({});
    setSaved(undefined);
    const missing: Record<string, string> = {};
    if (file === undefined) {
      missing.file = "Choisissez une image.";
    }
    if (rights === undefined) {
      missing.rights = "Précisez si des personnes sont reconnaissables.";
    }
    if (file === undefined || rights === undefined) {
      setErrors({ message: "Le téléversement est incomplet.", fields: missing });
      return;
    }
    setUploading(true);
    try {
      await uploadMedium(file, alt, rights);
      setSaved(`Image « ${file.name} » ajoutée.`);
      setFile(undefined);
      setAlt("");
      setRights(undefined);
      setInputKey((key) => key + 1);
      await reload();
    } catch (error) {
      setErrors(formErrors(error, "Le téléversement a échoué."));
    } finally {
      setUploading(false);
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Médias" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }

  return (
    <section className="space-y-6">
      <PageHeader title="Médias">
        Les images du site. Chaque image est réduite, convertie et débarrassée de ses informations
        cachées (lieu de la prise de vue, appareil). Une image où des personnes sont reconnaissables
        sans autorisation vérifiée n'est jamais publiée.
      </PageHeader>
      <Saved message={saved} />
      <Card>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            void upload();
          }}
        >
          <h2 className="text-lg font-semibold text-slate-900">Ajouter une image</h2>
          <Field
            label="Image (JPEG, PNG, WebP, GIF ou AVIF, 15 Mo au plus)"
            htmlFor="media-file"
            error={errors.fields?.file}
          >
            <input
              key={inputKey}
              id="media-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              className="block w-full text-sm"
              onChange={(event) => setFile(event.target.files?.[0])}
            />
          </Field>
          <Field
            label="Texte alternatif"
            htmlFor="media-alt"
            hint="Ce que montre l'image, pour qui ne la voit pas (ex. « Les U13 après leur victoire »)."
            error={errors.fields?.alt}
          >
            <Input id="media-alt" value={alt} onChange={(event) => setAlt(event.target.value)} />
          </Field>
          <RightsChoice
            name="media-rights"
            value={rights}
            onChange={setRights}
            error={errors.fields?.rights}
          />
          <FormError message={errors.message} />
          <Button type="submit" disabled={uploading}>
            {uploading ? "Téléversement…" : "Téléverser"}
          </Button>
        </form>
      </Card>
      <Card className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">Bibliothèque</h2>
        {media?.length === 0 && (
          <p className="text-sm text-slate-600">Aucune image pour l'instant.</p>
        )}
        <ul className="grid gap-3 md:grid-cols-2">
          {(media ?? []).map((medium) => (
            <MediumCard
              key={`${medium.id}-${medium.alt}-${medium.rights}`}
              medium={medium}
              onChanged={(message) => {
                setSaved(message);
                void reload();
              }}
            />
          ))}
        </ul>
      </Card>
    </section>
  );
}
