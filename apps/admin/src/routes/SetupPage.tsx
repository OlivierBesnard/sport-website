import { useState } from "react";
import { ApiError } from "../api/errors";
import { install } from "../api/setup";
import { Button, Card, cn, Field, FormError, Input } from "../components/ui";

const DEFAULT_PRIMARY = "#0b5cad";
const DEFAULT_SECONDARY = "#ffffff";
const DEFAULT_ACCENT = "#f59e0b";

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

/** The field errors the wizard can show next to an input; the others go to the global error. */
const FIELD_NAMES = new Set([
  "club.name",
  "club.sports",
  "club.colors.primary",
  "owner.name",
  "owner.email",
  "owner.password",
]);

export interface SetupPageProps {
  /** Called once the installation succeeded (the answer already signed the owner in). */
  readonly onInstalled: () => void;
}

interface WizardValues {
  readonly clubName: string;
  readonly sportsText: string;
  readonly primary: string;
  readonly secondary: string;
  readonly accent: string;
}

/** Sports as the API wants them: a non-empty list of trimmed names. */
export function sportsOf(sportsText: string): string[] {
  return sportsText
    .split(",")
    .map((sport) => sport.trim())
    .filter((sport) => sport !== "");
}

function validate(
  values: WizardValues,
  owner: { name: string; email: string; password: string },
): Record<string, string> {
  // The limits are the API's (the setup schema), mirrored so nothing needs a round trip.
  const errors: Record<string, string> = {};
  if (values.clubName.trim() === "") {
    errors["club.name"] = "Le nom du club est requis.";
  } else if (values.clubName.trim().length > 200) {
    errors["club.name"] = "Le nom du club est trop long (200 caractères maximum).";
  }
  const sports = sportsOf(values.sportsText);
  if (sports.length === 0) {
    errors["club.sports"] = "Choisissez au moins un sport (séparez-les par des virgules).";
  } else if (sports.length > 10) {
    errors["club.sports"] = "Choisissez au plus 10 sports.";
  } else if (sports.some((sport) => sport.length > 50)) {
    errors["club.sports"] = "Le nom d'un sport est trop long (50 caractères maximum).";
  }
  if (owner.name.trim() === "") {
    errors["owner.name"] = "Le nom du responsable est requis.";
  } else if (owner.name.trim().length > 200) {
    errors["owner.name"] = "Le nom du responsable est trop long (200 caractères maximum).";
  }
  if (!EMAIL_PATTERN.test(owner.email.trim())) {
    errors["owner.email"] = "L'adresse électronique du responsable est invalide.";
  }
  if (owner.password.length < 8) {
    errors["owner.password"] = "Le mot de passe doit contenir au moins 8 caractères.";
  } else if (owner.password.length > 128) {
    errors["owner.password"] = "Le mot de passe doit contenir au plus 128 caractères.";
  }
  return errors;
}

/**
 * Installation wizard, reachable only while the instance is not installed. Two steps: the
 * identity of the club, then the account of the person responsible. The installation answer
 * signs the owner in already, so finishing the wizard leads to the dashboard directly.
 */
export function SetupPage({ onInstalled }: SetupPageProps) {
  const [step, setStep] = useState<1 | 2>(1);
  const [clubName, setClubName] = useState("");
  const [sportsText, setSportsText] = useState("");
  const [primary, setPrimary] = useState(DEFAULT_PRIMARY);
  const [secondary, setSecondary] = useState(DEFAULT_SECONDARY);
  const [accent, setAccent] = useState(DEFAULT_ACCENT);
  const [ownerName, setOwnerName] = useState("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [conflict, setConflict] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const values: WizardValues = { clubName, sportsText, primary, secondary, accent };

  function fieldError(name: string): string | undefined {
    return fieldErrors[name];
  }

  function goToStep2(): void {
    const errors = validate(values, {
      name: ownerName,
      email: ownerEmail,
      password: ownerPassword,
    });
    const clubErrors = Object.fromEntries(
      Object.entries(errors).filter(([name]) => name.startsWith("club.")),
    );
    if (Object.keys(clubErrors).length > 0) {
      setFieldErrors(clubErrors);
      return;
    }
    setFieldErrors({});
    setStep(2);
  }

  async function handleSubmit(): Promise<void> {
    const errors = validate(values, {
      name: ownerName,
      email: ownerEmail,
      password: ownerPassword,
    });
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await install({
        club: {
          name: clubName.trim(),
          sports: sportsOf(sportsText),
          colors: { primary, secondary, accent },
        },
        owner: {
          name: ownerName.trim(),
          email: ownerEmail.trim(),
          password: ownerPassword,
        },
      });
      onInstalled();
    } catch (caught) {
      setSubmitting(false);
      if (caught instanceof ApiError) {
        if (caught.status === 409) {
          setConflict(true);
          return;
        }
        if (caught.fields !== undefined && Object.keys(caught.fields).length > 0) {
          setFieldErrors(caught.fields);
          // A field the form does not show (an unexpected path) must still be readable: it
          // joins the global error instead of being swallowed.
          const unmatched = Object.entries(caught.fields).filter(
            ([name]) => !FIELD_NAMES.has(name),
          );
          if (unmatched.length > 0) {
            setError(unmatched.map(([, message]) => message).join(" "));
          }
          setStep(Object.keys(caught.fields).some((name) => name.startsWith("club.")) ? 1 : 2);
          return;
        }
      }
      setError(caught instanceof Error ? caught.message : "L'installation a échoué. Réessayez.");
    }
  }

  if (conflict) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
        <Card className="max-w-md space-y-4 text-center">
          <h1 className="text-lg font-semibold text-slate-900">Instance déjà installée</h1>
          <p className="text-sm text-slate-600">
            Cette instance a déjà été installée : l'assistant n'est disponible qu'une seule fois.
          </p>
          <Button onClick={onInstalled}>Aller à la connexion</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-6 bg-slate-100 p-4">
      <header className="space-y-1 text-center">
        <h1 className="text-2xl font-semibold text-slate-900">Bienvenue dans votre back-office</h1>
        <p className="text-sm text-slate-600">
          Installez votre instance en deux étapes : l'identité du club, puis votre compte.
        </p>
      </header>
      <Card className="space-y-5">
        <ol className="flex gap-2 text-sm" aria-label="Étapes de l'installation">
          <li
            aria-current={step === 1 ? "step" : undefined}
            className={cn(
              "flex-1 rounded-md border px-3 py-2 font-medium",
              step === 1
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 text-slate-500",
            )}
          >
            1. Le club
          </li>
          <li
            aria-current={step === 2 ? "step" : undefined}
            className={cn(
              "flex-1 rounded-md border px-3 py-2 font-medium",
              step === 2
                ? "border-slate-900 bg-slate-900 text-white"
                : "border-slate-200 text-slate-500",
            )}
          >
            2. Le responsable
          </li>
        </ol>
        <FormError message={error} />
        {step === 1 ? (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              goToStep2();
            }}
          >
            <Field label="Nom du club" htmlFor="nom-club" error={fieldError("club.name")}>
              <Input
                id="nom-club"
                name="nom-club"
                autoComplete="organization"
                placeholder="US Exemple"
                value={clubName}
                onChange={(event) => setClubName(event.target.value)}
                aria-invalid={fieldError("club.name") !== undefined}
              />
            </Field>
            <Field
              label="Sports pratiqués"
              htmlFor="sports"
              hint="Séparez les sports par des virgules (un club omnisports peut en avoir plusieurs)."
              error={fieldError("club.sports")}
            >
              <Input
                id="sports"
                name="sports"
                placeholder="football, basket"
                value={sportsText}
                onChange={(event) => setSportsText(event.target.value)}
                aria-invalid={fieldError("club.sports") !== undefined}
              />
            </Field>
            <Field
              label="Couleur principale"
              htmlFor="couleur-principale"
              error={fieldError("club.colors.primary")}
            >
              <div className="flex items-center gap-3">
                <input
                  id="couleur-principale"
                  type="color"
                  value={primary}
                  onChange={(event) => setPrimary(event.target.value)}
                  className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1"
                />
                <span className="font-mono text-sm text-slate-600">{primary}</span>
              </div>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Couleur secondaire" htmlFor="couleur-secondaire">
                <div className="flex items-center gap-3">
                  <input
                    id="couleur-secondaire"
                    type="color"
                    value={secondary}
                    onChange={(event) => setSecondary(event.target.value)}
                    className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1"
                  />
                  <span className="font-mono text-sm text-slate-600">{secondary}</span>
                </div>
              </Field>
              <Field label="Couleur d'accent" htmlFor="couleur-accent">
                <div className="flex items-center gap-3">
                  <input
                    id="couleur-accent"
                    type="color"
                    value={accent}
                    onChange={(event) => setAccent(event.target.value)}
                    className="h-9 w-14 cursor-pointer rounded border border-slate-300 bg-white p-1"
                  />
                  <span className="font-mono text-sm text-slate-600">{accent}</span>
                </div>
              </Field>
            </div>
            <Button type="submit">Continuer</Button>
          </form>
        ) : (
          <form
            className="space-y-4"
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void handleSubmit();
            }}
          >
            <Field
              label="Nom du responsable"
              htmlFor="nom-responsable"
              error={fieldError("owner.name")}
            >
              <Input
                id="nom-responsable"
                name="nom-responsable"
                autoComplete="name"
                placeholder="Jeanne Dupont"
                value={ownerName}
                onChange={(event) => setOwnerName(event.target.value)}
                aria-invalid={fieldError("owner.name") !== undefined}
              />
            </Field>
            <Field
              label="Adresse électronique"
              htmlFor="email"
              hint="Elle servira à se connecter au back-office."
              error={fieldError("owner.email")}
            >
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                placeholder="jeanne@monclub.fr"
                value={ownerEmail}
                onChange={(event) => setOwnerEmail(event.target.value)}
                aria-invalid={fieldError("owner.email") !== undefined}
              />
            </Field>
            <Field
              label="Mot de passe"
              htmlFor="mot-de-passe"
              hint="8 caractères minimum."
              error={fieldError("owner.password")}
            >
              <Input
                id="mot-de-passe"
                name="mot-de-passe"
                type="password"
                autoComplete="new-password"
                value={ownerPassword}
                onChange={(event) => setOwnerPassword(event.target.value)}
                aria-invalid={fieldError("owner.password") !== undefined}
              />
            </Field>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
              <Button
                variant="outline"
                onClick={() => {
                  setFieldErrors({});
                  setStep(1);
                }}
              >
                Retour
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "Installation en cours…" : "Terminer l'installation"}
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
