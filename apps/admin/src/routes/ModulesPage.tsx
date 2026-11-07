import { useCallback, useEffect, useId, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/errors";
import {
  deleteModuleCredentials,
  disableModule,
  enableModule,
  fetchModules,
  type ModuleFailure,
  type ModuleSummary,
  saveModuleCredentials,
  saveModuleSettings,
} from "../api/modules";
import { Button, Card, cn, Field, FormError, Input, Select } from "../components/ui";
import { useModules } from "../modules/context";
import {
  choiceKey,
  type FormField,
  type FormValues,
  formOutput,
  initialValues,
  type SchemaForm,
  schemaForm,
} from "../modules/schema-form";

/**
 * Modules of the instance: enable one (after reading what it asks for: its permissions and the
 * personal data it processes), disable it, fill its settings (a form generated from its schema)
 * and its credentials (never shown back: the server only says whether they are saved). The
 * modules refused at this start are listed with their reasons.
 */

const DATE_FORMAT = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" });

function sourceLabel(module: ModuleSummary): string {
  if (module.source === "official") {
    return "Module officiel";
  }
  return module.source === "installed" ? "Module installé" : "Module absent";
}

function StatusBadge({ module }: { module: ModuleSummary }) {
  const [label, style] =
    module.status === "unavailable"
      ? ["Indisponible", "bg-amber-100 text-amber-900"]
      : module.enabled
        ? ["Activé", "bg-emerald-100 text-emerald-900"]
        : ["Désactivé", "bg-slate-100 text-slate-700"];
  return <span className={cn("rounded px-2 py-0.5 text-xs font-semibold", style)}>{label}</span>;
}

/** Message of a failed call, French in every case. */
function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/** The fields of a generated form. */
function SchemaFields({
  form,
  values,
  errors,
  secret,
  onChange,
}: {
  form: SchemaForm;
  values: FormValues;
  errors: Readonly<Record<string, string>> | undefined;
  secret: boolean;
  onChange: (name: string, value: string | boolean) => void;
}) {
  const id = useId();
  const input = (field: FormField) => {
    const fieldId = `${id}-${field.name}`;
    const error = errors?.[field.name];
    const common = {
      id: fieldId,
      "aria-invalid": error !== undefined,
      required: field.required,
    };
    if (field.kind === "boolean") {
      return (
        <Select
          {...common}
          value={values[field.name] === true ? "oui" : "non"}
          onChange={(event) => onChange(field.name, event.target.value === "oui")}
        >
          <option value="oui">Oui</option>
          <option value="non">Non</option>
        </Select>
      );
    }
    if (field.kind === "choice") {
      return (
        <Select
          {...common}
          value={String(values[field.name] ?? "")}
          onChange={(event) => onChange(field.name, event.target.value)}
        >
          {!field.required && <option value="">—</option>}
          {field.options.map((option) => (
            <option key={choiceKey(option.value)} value={choiceKey(option.value)}>
              {option.label}
            </option>
          ))}
        </Select>
      );
    }
    return (
      <Input
        {...common}
        type={secret ? "password" : field.kind === "text" ? "text" : "number"}
        inputMode={field.kind === "integer" ? "numeric" : undefined}
        step={field.kind === "number" ? "any" : undefined}
        // Credentials are typed again on every change; the browser must not fill them in.
        autoComplete={secret ? "new-password" : "off"}
        maxLength={field.maxLength}
        value={String(values[field.name] ?? "")}
        onChange={(event) => onChange(field.name, event.target.value)}
      />
    );
  };
  return (
    <div className="space-y-3">
      {form.fields.map((field) => (
        <Field
          key={field.name}
          label={field.required ? `${field.label} (obligatoire)` : field.label}
          htmlFor={`${id}-${field.name}`}
          hint={field.description}
          error={errors?.[field.name]}
        >
          {input(field)}
        </Field>
      ))}
    </div>
  );
}

/** What enabling the module grants, read before confirming. */
function ConsentPanel({
  module,
  busy,
  onConfirm,
  onCancel,
}: {
  module: ModuleSummary;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [accepted, setAccepted] = useState(module.permissions.length === 0);
  const checkboxId = useId();
  return (
    <section
      aria-label={`Activer le module ${module.name}`}
      className="space-y-3 rounded-md border border-slate-300 bg-slate-50 p-4"
    >
      <h3 className="text-sm font-semibold text-slate-900">Avant d'activer {module.name}</h3>
      {module.permissions.length === 0 ? (
        <p className="text-sm text-slate-700">
          Ce module ne demande aucun accès aux données du club.
        </p>
      ) : (
        <div className="text-sm text-slate-700">
          <p>Ce module demande les accès suivants :</p>
          <ul className="mt-1 list-disc pl-5">
            {module.permissions.map((permission) => (
              <li key={permission}>
                <code className="text-xs">{permission}</code>
              </li>
            ))}
          </ul>
        </div>
      )}
      {module.dataProcessing.length === 0 ? (
        <p className="text-sm text-slate-700">
          Il ne déclare aucun traitement de données personnelles.
        </p>
      ) : (
        <div className="text-sm text-slate-700">
          <p>Données personnelles traitées :</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {module.dataProcessing.map((processing) => (
              <li key={processing.purpose}>
                {processing.purpose} — {processing.data.join(", ")} ; conservation :{" "}
                {processing.retention}
                {processing.processors !== undefined && processing.processors.length > 0
                  ? ` ; sous-traitants : ${processing.processors.join(", ")}`
                  : ""}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-sm text-slate-600">
        Un module a accès au fonctionnement de l'instance : n'activez que ceux dont vous faites
        confiance à l'auteur.
      </p>
      {module.permissions.length > 0 && (
        <div className="flex items-start gap-2">
          <input
            id={checkboxId}
            type="checkbox"
            className="mt-1"
            checked={accepted}
            onChange={(event) => setAccepted(event.target.checked)}
          />
          <label htmlFor={checkboxId} className="text-sm text-slate-800">
            J'accorde ces accès au module.
          </label>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!accepted || busy} onClick={onConfirm}>
          Activer le module
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Annuler
        </Button>
      </div>
    </section>
  );
}

function SettingsForm({
  module,
  onSaved,
}: {
  module: ModuleSummary;
  onSaved: (module: ModuleSummary) => void;
}) {
  const form = schemaForm(module.settingsSchema);
  const [values, setValues] = useState(() => initialValues(form, module.settings));
  const [errors, setErrors] = useState<Record<string, string>>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [saving, setSaving] = useState(false);

  if (form.fields.length === 0) {
    return null;
  }

  async function handleSave(): Promise<void> {
    setSaving(true);
    setError(undefined);
    setErrors(undefined);
    setMessage(undefined);
    try {
      const saved = await saveModuleSettings(module.id, formOutput(form, values, module.settings));
      onSaved(saved);
      setValues(initialValues(schemaForm(saved.settingsSchema), saved.settings));
      setMessage("Réglages enregistrés.");
    } catch (failure) {
      setError(messageOf(failure, "L'enregistrement des réglages a échoué. Réessayez."));
      setErrors(failure instanceof ApiError ? failure.fields : undefined);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void handleSave();
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Réglages</h3>
      <SchemaFields
        form={form}
        values={values}
        errors={errors}
        secret={false}
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      />
      {form.unsupported.length > 0 && (
        <p className="text-xs text-slate-500">
          Réglages non modifiables ici, conservés tels quels : {form.unsupported.join(", ")}.
        </p>
      )}
      <FormError message={error} />
      {message !== undefined && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      <Button type="submit" variant="outline" disabled={saving}>
        Enregistrer les réglages
      </Button>
    </form>
  );
}

function CredentialsForm({
  module,
  onSaved,
}: {
  module: ModuleSummary;
  onSaved: (module: ModuleSummary) => void;
}) {
  const form = schemaForm(module.credentials.schema);
  const [values, setValues] = useState(() => initialValues(form, {}));
  const [errors, setErrors] = useState<Record<string, string>>();
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!module.credentials.declared) {
    return null;
  }

  async function run(action: () => Promise<ModuleSummary>, done: string, fallback: string) {
    setBusy(true);
    setError(undefined);
    setErrors(undefined);
    setMessage(undefined);
    try {
      onSaved(await action());
      setValues(initialValues(form, {}));
      setConfirmingDelete(false);
      setMessage(done);
    } catch (failure) {
      setError(messageOf(failure, fallback));
      setErrors(failure instanceof ApiError ? failure.fields : undefined);
    } finally {
      setBusy(false);
    }
  }

  const { configured, updatedAt } = module.credentials;
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => saveModuleCredentials(module.id, formOutput(form, values)),
          "Identifiants enregistrés.",
          "L'enregistrement des identifiants a échoué. Réessayez.",
        );
      }}
    >
      <h3 className="text-sm font-semibold text-slate-900">Identifiants</h3>
      <p className="text-sm text-slate-600">
        {configured
          ? `Identifiants enregistrés${updatedAt === null ? "" : ` le ${DATE_FORMAT.format(new Date(updatedAt))}`}. Ils sont chiffrés et ne sont jamais réaffichés : saisissez-les à nouveau pour les remplacer.`
          : "Aucun identifiant enregistré. Ils seront chiffrés et ne seront jamais réaffichés."}
      </p>
      <SchemaFields
        form={form}
        values={values}
        errors={errors}
        secret
        onChange={(name, value) => setValues((current) => ({ ...current, [name]: value }))}
      />
      <FormError message={error} />
      {message !== undefined && (
        <p role="status" className="text-sm text-emerald-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={busy}>
          Enregistrer les identifiants
        </Button>
        {configured && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              confirmingDelete
                ? void run(
                    () => deleteModuleCredentials(module.id),
                    "Identifiants supprimés.",
                    "La suppression des identifiants a échoué. Réessayez.",
                  )
                : setConfirmingDelete(true)
            }
          >
            {confirmingDelete ? "Confirmer la suppression" : "Supprimer les identifiants"}
          </Button>
        )}
      </div>
    </form>
  );
}

function ModuleCard({
  module,
  onChanged,
}: {
  module: ModuleSummary;
  onChanged: (module: ModuleSummary, registryChanged: boolean) => void;
}) {
  const { pages } = useModules();
  const [consenting, setConsenting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [errors, setErrors] = useState<Record<string, string>>();
  const modulePages = pages.filter((page) => page.module.id === module.id);

  async function toggle(enable: boolean): Promise<void> {
    setBusy(true);
    setError(undefined);
    setErrors(undefined);
    try {
      const updated = enable ? await enableModule(module.id) : await disableModule(module.id);
      setConsenting(false);
      onChanged(updated, true);
    } catch (failure) {
      setError(
        messageOf(
          failure,
          enable ? "L'activation du module a échoué." : "La désactivation du module a échoué.",
        ),
      );
      setErrors(failure instanceof ApiError ? failure.fields : undefined);
    } finally {
      setBusy(false);
    }
  }

  const available = module.status === "available";
  return (
    <section aria-label={`Module ${module.name}`}>
      <Card className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h2 className="flex flex-wrap items-center gap-2 text-lg font-semibold text-slate-900">
              {module.name}
              <StatusBadge module={module} />
            </h2>
            <p className="text-xs text-slate-500">
              {sourceLabel(module)} · version {module.version}
              {module.category === null ? "" : ` · ${module.category}`}
            </p>
            {module.description !== null && (
              <p className="text-sm text-slate-700">{module.description}</p>
            )}
            {module.blocks.length > 0 && (
              <p className="text-sm text-slate-600">
                Blocs : {module.blocks.map((block) => block.label).join(", ")}
              </p>
            )}
          </div>
          {available && !consenting && (
            <Button
              variant={module.enabled ? "outline" : "primary"}
              disabled={busy}
              onClick={() => (module.enabled ? void toggle(false) : setConsenting(true))}
            >
              {module.enabled ? "Désactiver" : "Activer…"}
            </Button>
          )}
        </div>
        {module.failure !== null && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            <p>
              Ce module n'a pas pu être chargé au démarrage ; ses réglages et ses données sont
              conservés.
            </p>
            <ul className="mt-1 list-disc pl-5">
              {module.failure.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          </div>
        )}
        {module.failure === null && !available && (
          <p className="text-sm text-amber-900">
            Ce module n'est plus présent sur l'instance ; ses réglages et ses données sont
            conservés.
          </p>
        )}
        {consenting && (
          <ConsentPanel
            module={module}
            busy={busy}
            onConfirm={() => void toggle(true)}
            onCancel={() => setConsenting(false)}
          />
        )}
        <FormError message={error} />
        {errors !== undefined && (
          <ul className="list-disc pl-5 text-sm text-red-700">
            {Object.entries(errors).map(([path, message]) => (
              <li key={path}>{path === "" ? message : `${path} : ${message}`}</li>
            ))}
          </ul>
        )}
        {module.enabled && available && (
          <p className="text-sm text-slate-600">
            Ses blocs sont proposés dans l'éditeur des pages. Le désactiver les retire du site ; ses
            données sont conservées.
          </p>
        )}
        {modulePages.length > 0 && (
          <nav
            aria-label={`Pages du module ${module.name}`}
            className="flex flex-wrap gap-3 text-sm"
          >
            {modulePages.map((page) => (
              <Link
                key={page.path}
                to={`/modules/${module.id}/${page.path}`}
                className="font-medium text-slate-800 underline"
              >
                {page.title}
              </Link>
            ))}
          </nav>
        )}
        {available && (
          <div className="grid gap-6 md:grid-cols-2">
            <SettingsForm
              key={`settings-${module.version}`}
              module={module}
              onSaved={(saved) => onChanged(saved, false)}
            />
            <CredentialsForm
              key={`credentials-${module.version}`}
              module={module}
              onSaved={(saved) => onChanged(saved, false)}
            />
          </div>
        )}
      </Card>
    </section>
  );
}

function FailuresList({ failures }: { failures: readonly ModuleFailure[] }) {
  if (failures.length === 0) {
    return null;
  }
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Modules refusés au démarrage</h2>
      <p className="text-sm text-slate-600">
        L'instance fonctionne sans eux. Corrigez ou remplacez leurs fichiers, puis redémarrez.
      </p>
      <ul className="space-y-2 text-sm">
        {failures.map((failure) => (
          <li key={`${failure.source}-${failure.id}`}>
            <span className="font-medium text-slate-900">{failure.id}</span>
            {failure.source === "official" ? " (officiel)" : " (installé)"} :{" "}
            {failure.reasons.join(" ")}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function ModulesPage() {
  const { refresh, problems } = useModules();
  const [modules, setModules] = useState<ModuleSummary[]>();
  const [failures, setFailures] = useState<ModuleFailure[]>([]);
  const [loadError, setLoadError] = useState<string>();

  const reload = useCallback(async (): Promise<void> => {
    try {
      const body = await fetchModules();
      setModules(body.modules);
      setFailures(body.failures);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(messageOf(error, "Impossible de charger les modules."));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onChanged = (updated: ModuleSummary, registryChanged: boolean): void => {
    setModules((current) =>
      current?.map((module) => (module.id === updated.id ? updated : module)),
    );
    if (registryChanged) {
      // The editor and the menu follow: blocks and pages of the module come or go.
      void refresh();
    }
  };

  // Failures of modules known to the database already show on their card.
  const loose = failures.filter(
    (failure) => !(modules ?? []).some((module) => module.id === failure.id),
  );

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">Modules</h1>
      <p className="text-sm text-slate-600">
        Les modules ajoutent des blocs à l'éditeur et des écrans au back-office. Un module activé
        peut être désactivé à tout moment : ses données sont conservées.
      </p>
      <FormError message={loadError} />
      {problems.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {problems.map((problem) => (
            <p key={`${problem.id}-${problem.message}`}>
              {problem.name} : {problem.message}
            </p>
          ))}
        </div>
      )}
      {modules !== undefined && modules.length === 0 && (
        <Card className="text-sm text-slate-600">
          <p>Aucun module n'est présent sur l'instance.</p>
        </Card>
      )}
      {(modules ?? []).map((module) => (
        <ModuleCard key={module.id} module={module} onChanged={onChanged} />
      ))}
      <FailuresList failures={loose} />
    </section>
  );
}
