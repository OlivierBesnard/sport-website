import type { SessionUser } from "../api/session";
import { Card } from "../components/ui";

export interface DashboardPageProps {
  readonly clubName: string | null;
  readonly user: SessionUser;
}

/** Empty dashboard of a freshly installed instance; the widgets arrive with the steps. */
export function DashboardPage({ clubName, user }: DashboardPageProps) {
  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900">Tableau de bord</h1>
        <p className="text-sm text-slate-600">
          Bienvenue {user.name}, le back-office de {clubName ?? "votre club"} est prêt.
        </p>
      </header>
      <Card className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900">Aucune donnée pour l'instant</h2>
        <p className="text-sm text-slate-600">
          Les pages, les équipes et les modules apparaîtront ici. Le site public, lui, est déjà en
          ligne sur l'adresse de l'instance.
        </p>
      </Card>
      <p className="text-xs text-slate-500">
        Connecté en tant que {user.email} (rôle {user.role}).
      </p>
    </section>
  );
}
