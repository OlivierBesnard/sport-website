import {
  MANUAL_UPDATE_WARNING_MS,
  MAX_UPDATE_PAUSE_MS,
  type SupervisorState,
  UPDATE_CHANNEL_LABELS,
  UPDATE_CHANNELS,
  UPDATE_POLICIES,
  UPDATE_POLICY_LABELS,
  type UpdateAction,
  type UpdateChannel,
  type UpdateOutcome,
  type UpdatePolicy,
  type UpdateSettings,
} from "@sport-cms/core";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  fetchUpdates,
  requestUpdateAction,
  saveUpdateSettings,
  type UpdatesOverview,
} from "../api/updates";
import { Button, Card, Field, FormError, Input, Select } from "../components/ui";
import { type FormErrors, formErrors, PageHeader, Saved } from "./sport/shared";

/**
 * Automatic updates (PLAN §6.8): version running, the club's settings (policy, channel, window,
 * pause), « Mettre à jour maintenant », going back to the previous version, and the history.
 */

const OUTCOME_LABELS: Readonly<Record<UpdateOutcome, string>> = {
  installed: "installée",
  rolled_back: "annulée : retour automatique à la version précédente",
  reverted: "retour à la version précédente",
};

const PAUSE_DAYS = [1, 3, 7, 14] as const;

function formatInstant(time: number): string {
  return new Date(time).toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" });
}

/** Banners above the settings: what needs the club's (or the host's) attention. */
function Alerts({ overview }: { overview: UpdatesOverview }): ReactNode {
  const { state, settings } = overview;
  if (state === null) {
    return null;
  }
  const alerts: string[] = [];
  if (state.environmentOutdated !== null) {
    alerts.push(
      `La version ${state.environmentOutdated.version} demande un environnement plus récent ` +
        `(version ${state.environmentOutdated.requires}, celle-ci est en ${state.environment}) : ` +
        "votre hébergeur doit redéployer l'image du site. L'instance reste sur la dernière version compatible.",
    );
  }
  if (
    settings.policy === "manual" &&
    state.available !== null &&
    Date.now() - state.available.publishedAt > MANUAL_UPDATE_WARNING_MS
  ) {
    alerts.push(
      `La version ${state.available.version} attend depuis plus de 30 jours. ` +
        "Les mises à jour corrigent aussi des failles de sécurité : installez-la, ou repassez en mise à jour automatique.",
    );
  }
  if (state.lastError !== null) {
    alerts.push(`Dernière vérification : ${state.lastError}`);
  }
  const failed = state.history.find((entry) => entry.outcome === "rolled_back");
  if (failed !== undefined && state.history[0] === failed) {
    alerts.push(
      `La version ${failed.to} n'a pas passé le contrôle de santé (${failed.reason ?? "raison inconnue"}) : ` +
        `le site est revenu à la version ${failed.from ?? "précédente"}, et cette version ne sera plus proposée.`,
    );
  }
  if (alerts.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2" role="alert">
      {alerts.map((alert) => (
        <p
          key={alert}
          className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {alert}
        </p>
      ))}
    </div>
  );
}

function VersionCard({
  overview,
  busy,
  onAction,
}: {
  overview: UpdatesOverview;
  busy: boolean;
  onAction: (action: UpdateAction) => void;
}): ReactNode {
  const { state, request } = overview;
  if (state === null) {
    return (
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold text-slate-900">Version {overview.version}</h2>
        <p className="text-sm text-slate-600">
          Aucun superviseur ne gère cette instance (installation de développement, ou lancée sans
          l'image Docker) : elle ne se met pas à jour toute seule. Vos réglages seront appliqués dès
          qu'elle tournera sous le superviseur.
        </p>
      </Card>
    );
  }
  const { available } = state;
  return (
    <Card className="space-y-3">
      <h2 className="text-lg font-semibold text-slate-900">
        Version {state.current ?? overview.version}
      </h2>
      {available === null ? (
        <p className="text-sm text-slate-700">Le site est à jour.</p>
      ) : (
        <div className="space-y-1 text-sm text-slate-700">
          <p>
            <strong>Version {available.version} disponible</strong>
            {available.urgent ? " (correctif de sécurité urgent)" : ""}
            {available.staged
              ? ", téléchargée et vérifiée."
              : state.lastError === null
                ? ", en cours de téléchargement."
                : " : elle n'a pas pu être installée (voir ci-dessus), nouvel essai à la prochaine vérification."}
          </p>
          {available.notes !== "" && <p className="whitespace-pre-line">{available.notes}</p>}
        </div>
      )}
      <p className="text-xs text-slate-500">
        {state.lastCheckAt === null
          ? "Aucune vérification pour l'instant."
          : `Dernière vérification le ${formatInstant(state.lastCheckAt)}.`}
      </p>
      {request !== null && (
        <p className="text-sm text-slate-700" role="status">
          {request.action === "update"
            ? "Mise à jour demandée : elle démarre dans quelques secondes."
            : "Retour à la version précédente demandé : il démarre dans quelques secondes."}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={busy || request !== null} onClick={() => onAction("update")}>
          Mettre à jour maintenant
        </Button>
        {state.previous !== null && (
          <Button
            variant="outline"
            disabled={busy || request !== null}
            onClick={() => onAction("rollback")}
          >
            Revenir à la version {state.previous}
          </Button>
        )}
      </div>
    </Card>
  );
}

function History({ state }: { state: SupervisorState | null }): ReactNode {
  if (state === null || state.history.length === 0) {
    return null;
  }
  return (
    <Card className="space-y-2">
      <h2 className="text-lg font-semibold text-slate-900">Historique</h2>
      <ul className="divide-y divide-slate-200">
        {state.history.map((entry) => (
          <li key={`${entry.at}-${entry.to}`} className="py-2 text-sm text-slate-700">
            <strong>{entry.to}</strong>
            {entry.from === null ? "" : ` (depuis ${entry.from})`} — {OUTCOME_LABELS[entry.outcome]}
            , le {formatInstant(entry.at)}
            {entry.reason === undefined ? "" : ` : ${entry.reason}`}
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function UpdatesPage() {
  const [overview, setOverview] = useState<UpdatesOverview>();
  const [settings, setSettings] = useState<UpdateSettings>();
  const [loadError, setLoadError] = useState<string>();
  const [errors, setErrors] = useState<FormErrors>({});
  const [actionError, setActionError] = useState<string>();
  const [saved, setSaved] = useState<string>();
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const next = await fetchUpdates();
      setOverview(next);
      setSettings((current) => current ?? next.settings);
      setLoadError(undefined);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Chargement impossible.");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // While a request waits for the supervisor, the page follows it.
  useEffect(() => {
    if (overview?.request === null || overview === undefined) {
      return;
    }
    const timer = setInterval(() => void reload(), 3000);
    return () => clearInterval(timer);
  }, [overview, reload]);

  async function act(action: UpdateAction): Promise<void> {
    setBusy(true);
    setActionError(undefined);
    try {
      await requestUpdateAction(action);
      await reload();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Demande impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function submit(): Promise<void> {
    if (settings === undefined) {
      return;
    }
    setErrors({});
    setSaved(undefined);
    try {
      setSettings(await saveUpdateSettings(settings));
      setSaved("Réglages des mises à jour enregistrés.");
      await reload();
    } catch (error) {
      setErrors(formErrors(error, "L'enregistrement des réglages a échoué."));
    }
  }

  if (loadError !== undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Mises à jour" />
        <FormError message={loadError} />
        <Button variant="outline" onClick={() => void reload()}>
          Réessayer
        </Button>
      </section>
    );
  }
  if (overview === undefined || settings === undefined) {
    return (
      <section className="space-y-4">
        <PageHeader title="Mises à jour" />
        <p className="text-sm text-slate-600">Chargement…</p>
      </section>
    );
  }

  const update = (changes: Partial<UpdateSettings>) =>
    setSettings((current) => (current === undefined ? current : { ...current, ...changes }));
  const paused = settings.pausedUntil !== null && settings.pausedUntil > Date.now();
  const fieldError = (name: string) => errors.fields?.[name];

  return (
    <section className="space-y-6">
      <PageHeader title="Mises à jour">
        Le site installe seul les nouvelles versions, la nuit, après avoir vérifié leur signature,
        et revient en arrière tout seul si quelque chose ne va pas.
      </PageHeader>
      <Alerts overview={overview} />
      <FormError message={actionError} />
      <VersionCard overview={overview} busy={busy} onAction={(action) => void act(action)} />

      <Card>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <h2 className="text-lg font-semibold text-slate-900">Réglages</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Politique" htmlFor="updates-policy" error={fieldError("policy")}>
              <Select
                id="updates-policy"
                value={settings.policy}
                onChange={(event) => update({ policy: event.target.value as UpdatePolicy })}
              >
                {UPDATE_POLICIES.map((policy) => (
                  <option key={policy} value={policy}>
                    {UPDATE_POLICY_LABELS[policy]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Canal" htmlFor="updates-channel" error={fieldError("channel")}>
              <Select
                id="updates-channel"
                value={settings.channel}
                onChange={(event) => update({ channel: event.target.value as UpdateChannel })}
              >
                {UPDATE_CHANNELS.map((channel) => (
                  <option key={channel} value={channel}>
                    {UPDATE_CHANNEL_LABELS[channel]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field
              label="Début de la fenêtre"
              htmlFor="updates-window-start"
              hint="Heure du serveur."
              error={fieldError("window.start")}
            >
              <Input
                id="updates-window-start"
                type="time"
                value={settings.window.start}
                onChange={(event) =>
                  update({ window: { ...settings.window, start: event.target.value } })
                }
              />
            </Field>
            <Field
              label="Fin de la fenêtre"
              htmlFor="updates-window-end"
              error={fieldError("window.end")}
            >
              <Input
                id="updates-window-end"
                type="time"
                value={settings.window.end}
                onChange={(event) =>
                  update({ window: { ...settings.window, end: event.target.value } })
                }
              />
            </Field>
            <Field
              label="Pause"
              htmlFor="updates-pause"
              hint="Les correctifs de sécurité urgents passent quand même."
              error={fieldError("pausedUntil")}
            >
              <Select
                id="updates-pause"
                value=""
                onChange={(event) => {
                  const days = Number(event.target.value);
                  update({
                    pausedUntil:
                      days === 0
                        ? null
                        : Date.now() + Math.min(days * 24 * 60 * 60 * 1000, MAX_UPDATE_PAUSE_MS),
                  });
                }}
              >
                <option value="" disabled>
                  {paused && settings.pausedUntil !== null
                    ? `En pause jusqu'au ${formatInstant(settings.pausedUntil)}`
                    : "Aucune pause"}
                </option>
                <option value="0">Aucune pause</option>
                {PAUSE_DAYS.map((days) => (
                  <option key={days} value={days}>
                    {days === 1 ? "1 jour" : `${days} jours`}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <FormError message={errors.message} />
          <Saved message={saved} />
          <Button type="submit">Enregistrer les réglages</Button>
        </form>
      </Card>

      <History state={overview.state} />
    </section>
  );
}
