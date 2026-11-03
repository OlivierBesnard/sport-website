import { type ReactNode, useEffect, useState } from "react";
import { NavLink, Outlet } from "react-router";
import { signOut } from "../api/session";
import { Button, Card, cn, FormError } from "./ui";

/** Sections of the back-office; only the dashboard exists, the rest arrives with the steps. */
const MENU = [
  { to: "/", label: "Tableau de bord", enabled: true, end: true },
  { to: "/pages", label: "Pages", enabled: false, end: false },
  { to: "/modules", label: "Modules", enabled: false, end: false },
  { to: "/reglages", label: "Réglages", enabled: false, end: false },
] as const;

function MenuIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M15 12H4m0 0l3-3m-3 3l3 3M10 4h7a2 2 0 012 2v12a2 2 0 01-2 2h-7" />
    </svg>
  );
}

/** Entry of the sidebar; a disabled one is grayed with a « bientôt » badge. */
function MenuItem({
  to,
  label,
  enabled,
  end,
  collapsed,
}: {
  to: string;
  label: string;
  enabled: boolean;
  end?: boolean;
  collapsed: boolean;
}) {
  if (!enabled) {
    return (
      <span
        aria-disabled="true"
        title="Bientôt disponible"
        className="flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm font-medium text-slate-400"
      >
        <span className={cn(collapsed && "md:hidden")}>{label}</span>
        <span
          className={cn(
            "rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-500",
            collapsed && "md:hidden",
          )}
        >
          bientôt
        </span>
      </span>
    );
  }
  return (
    <NavLink
      to={to}
      end={end}
      title={label}
      className={({ isActive }) =>
        cn(
          "block rounded-md px-3 py-2 text-sm font-medium",
          isActive
            ? "bg-slate-900 text-white"
            : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        )
      }
    >
      <span className={cn(collapsed && "md:hidden")}>{label}</span>
    </NavLink>
  );
}

export interface ShellProps {
  /** Name of the club, shown in the sidebar and the mobile bar; `null` before it is known. */
  readonly clubName: string | null;
  /** Called once the session is closed, to bring the back-office back to the sign-in. */
  readonly onSignedOut: () => void;
}

/**
 * Shell of the back-office: a collapsible sidebar (drawer on mobile, icons only on desktop
 * when folded) and the page content. Mobile first: everything is usable with one thumb.
 */
export function Shell({ clubName, onSignedOut }: ShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string>();
  /** Below Tailwind's `md` breakpoint, the sidebar is a drawer that opens and closes. */
  const [mobile, setMobile] = useState(() => !window.matchMedia("(min-width: 48rem)").matches);

  useEffect(() => {
    const query = window.matchMedia("(min-width: 48rem)");
    const update = (event: MediaQueryListEvent): void => setMobile(!event.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  async function handleSignOut(): Promise<void> {
    setSigningOut(true);
    setSignOutError(undefined);
    try {
      await signOut();
      onSignedOut();
    } catch (error) {
      setSigningOut(false);
      setSignOutError(error instanceof Error ? error.message : "La déconnexion a échoué.");
    }
  }

  const title = clubName ?? "Back-office";

  return (
    <div className="min-h-dvh bg-slate-100">
      {/* Overlay of the mobile drawer; the drawer itself closes with its close button. */}
      <div
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-30 bg-slate-900/40 md:hidden",
          drawerOpen ? "block" : "hidden",
        )}
      />
      <div className="flex min-h-dvh">
        <aside
          aria-label="Menu du back-office"
          // A closed mobile drawer is off-screen: it must not keep the focus (the desktop
          // sidebar, always visible, is never inert).
          inert={!drawerOpen && mobile}
          className={cn(
            "fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white",
            "transition-transform duration-200 md:static md:translate-x-0",
            collapsed ? "md:w-16" : "md:w-64",
            drawerOpen ? "translate-x-0" : "-translate-x-full",
          )}
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-4">
            <span
              title={title}
              className={cn(
                "truncate text-sm font-semibold text-slate-900",
                collapsed && "md:hidden",
              )}
            >
              {title}
            </span>
            <button
              type="button"
              aria-label="Fermer le menu"
              onClick={() => setDrawerOpen(false)}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 md:hidden"
            >
              <CloseIcon />
            </button>
            <button
              type="button"
              aria-label={collapsed ? "Déplier le menu" : "Réduire le menu"}
              onClick={() => setCollapsed((value) => !value)}
              className="hidden rounded p-1 text-slate-500 hover:bg-slate-100 md:block"
            >
              <span aria-hidden="true" className="text-xs font-semibold">
                {collapsed ? "»" : "«"}
              </span>
            </button>
          </div>
          <nav className="flex-1 space-y-1 overflow-y-auto p-3">
            {MENU.map((item) => (
              <MenuItem
                key={item.to}
                to={item.to}
                label={item.label}
                enabled={item.enabled}
                end={item.end}
                collapsed={collapsed}
              />
            ))}
          </nav>
          <div className="space-y-2 border-t border-slate-200 p-3">
            {signOutError !== undefined && <FormError message={signOutError} />}
            <Button
              variant="outline"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              title="Se déconnecter"
              className={cn("w-full", collapsed && "md:px-0")}
            >
              <SignOutIcon />
              <span className={cn(collapsed && "md:hidden")}>Se déconnecter</span>
            </Button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
            <button
              type="button"
              aria-label="Ouvrir le menu"
              onClick={() => setDrawerOpen(true)}
              className="rounded p-1 text-slate-600 hover:bg-slate-100"
            >
              <MenuIcon />
            </button>
            <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
          </header>
          <main className="mx-auto w-full max-w-5xl flex-1 p-4 md:p-8">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}

/** Placeholder of the sections that a later step of the backlog will implement. */
export function ComingSoonPage({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
      <Card className="text-sm text-slate-600">
        <p>{children ?? "Cette partie du back-office arrive dans une prochaine version du CMS."}</p>
      </Card>
    </section>
  );
}
