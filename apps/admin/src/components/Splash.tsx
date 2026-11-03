import { Button, Card, cn } from "./ui";

/** Full-screen state while the back-office checks the instance and the session. */
export function BootSplash() {
  return (
    <div
      className={cn(
        "flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-100 text-slate-600",
      )}
    >
      <span
        aria-hidden="true"
        className="size-6 animate-spin rounded-full border-2 border-slate-300 border-t-slate-700"
      />
      <p className="text-sm">Chargement…</p>
    </div>
  );
}

export interface BootErrorProps {
  /** French message of the failure. */
  readonly message: string;
  readonly onRetry: () => void;
}

/** Full-screen error, when the instance cannot even be reached (server stopped, network…). */
export function BootError({ message, onRetry }: BootErrorProps) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-slate-100 p-4">
      <Card className="max-w-md space-y-3 text-center">
        <h1 className="text-lg font-semibold text-slate-900">
          Impossible d'afficher le back-office
        </h1>
        <p className="text-sm text-slate-600">{message}</p>
        <Button onClick={onRetry}>Réessayer</Button>
      </Card>
    </div>
  );
}
