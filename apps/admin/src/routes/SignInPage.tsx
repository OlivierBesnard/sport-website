import { useState } from "react";
import { signIn } from "../api/session";
import { Button, Card, Field, FormError, Input } from "../components/ui";

export interface SignInPageProps {
  /** Name of the club, shown in the title when it is known. */
  readonly clubName: string | null;
  /** Called once the session is open, to bring the back-office to the dashboard. */
  readonly onSignedIn: () => void;
}

/** Sign-in of the back-office. The errors of Better Auth (in English) are mapped into French. */
export function SignInPage({ clubName, onSignedIn }: SignInPageProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(): Promise<void> {
    const errors: Record<string, string> = {};
    if (email.trim() === "") {
      errors.email = "L'adresse électronique est requise.";
    }
    if (password === "") {
      errors.password = "Le mot de passe est requis.";
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }
    setSubmitting(true);
    setError(undefined);
    try {
      await signIn(email.trim(), password);
      onSignedIn();
    } catch (caught) {
      setSubmitting(false);
      setError(caught instanceof Error ? caught.message : "La connexion a échoué. Réessayez.");
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <Card className="w-full max-w-sm space-y-5">
        <header className="space-y-1 text-center">
          <h1 className="text-xl font-semibold text-slate-900">Connexion</h1>
          <p className="text-sm text-slate-600">
            {clubName === null ? "Connectez-vous au back-office." : `Back-office de ${clubName}.`}
          </p>
        </header>
        <FormError message={error} />
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          <Field label="Adresse électronique" htmlFor="email" error={fieldErrors.email}>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder="jeanne@monclub.fr"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              aria-invalid={fieldErrors.email !== undefined}
            />
          </Field>
          <Field label="Mot de passe" htmlFor="mot-de-passe" error={fieldErrors.password}>
            <Input
              id="mot-de-passe"
              name="mot-de-passe"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={fieldErrors.password !== undefined}
            />
          </Field>
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? "Connexion en cours…" : "Se connecter"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
