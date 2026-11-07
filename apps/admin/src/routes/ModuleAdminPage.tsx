import { Component, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import type { SessionUser } from "../api/session";
import { Card } from "../components/ui";
import { useModules } from "../modules/context";
import { canSeePage } from "../modules/load-clients";

/**
 * A screen of the back-office added by a module (`adminPages`), at
 * `/admin/modules/<id>/<path>`. The module's component renders inside an error boundary: a
 * broken module shows a French message, the back-office stays usable.
 */

class ModulePageBoundary extends Component<
  { readonly name: string; readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    // For the module's author; the person sees the French message.
    console.error(`Page du module « ${this.props.name} » :`, error);
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <p role="alert" className="text-sm text-red-800">
          Cette page du module « {this.props.name} » a rencontré une erreur. Rechargez la page ; si
          l'erreur persiste, désactivez le module ou signalez-la à son auteur.
        </p>
      );
    }
    return this.props.children;
  }
}

export function ModuleAdminPage({ user }: { user: SessionUser }) {
  const { id = "", "*": rest = "" } = useParams();
  const { status, pages } = useModules();
  const page = pages.find((candidate) => candidate.module.id === id && candidate.path === rest);

  const back = (
    <Link to="/modules" className="text-sm font-medium text-slate-600 underline">
      ← Modules
    </Link>
  );
  if (status === "loading") {
    return null;
  }
  if (page === undefined || !canSeePage(user, page)) {
    return (
      <section className="space-y-4">
        {back}
        <Card className="text-sm text-slate-600">
          <p>
            {page === undefined
              ? "Cette page n'existe pas : le module est peut-être désactivé."
              : "Vous n'avez pas accès à cette page."}
          </p>
        </Card>
      </section>
    );
  }
  const PageComponent = page.component;
  return (
    <section className="space-y-4">
      {back}
      <Card>
        <ModulePageBoundary key={`${id}/${rest}`} name={page.module.name}>
          <PageComponent module={page.module} />
        </ModulePageBoundary>
      </Card>
    </section>
  );
}
