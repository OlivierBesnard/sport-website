import { useCallback, useEffect, useState } from "react";
import { Navigate, Route, Routes } from "react-router";
import type { SessionUser } from "./api/session";
import { fetchSession } from "./api/session";
import { fetchSetupStatus } from "./api/setup";
import { ComingSoonPage, Shell } from "./components/Shell";
import { BootError, BootSplash } from "./components/Splash";
import { ModulesProvider } from "./modules/context";
import { DashboardPage } from "./routes/DashboardPage";
import { ModuleAdminPage } from "./routes/ModuleAdminPage";
import { ModulesPage } from "./routes/ModulesPage";
import { NavigationPage } from "./routes/NavigationPage";
import { PageEditorPage } from "./routes/PageEditorPage";
import { PagesPage } from "./routes/PagesPage";
import { SetupPage } from "./routes/SetupPage";
import { SignInPage } from "./routes/SignInPage";

/**
 * State of the back-office, decided once at load and after every auth change: a fresh
 * instance goes to the installation wizard, a browser without a session to the sign-in, and
 * an opened session to the shell.
 */
type Boot =
  | { state: "loading" }
  | { state: "error"; message: string }
  | { state: "setup" }
  | { state: "signIn"; clubName: string | null }
  | { state: "ready"; clubName: string | null; user: SessionUser };

export function App() {
  const [boot, setBoot] = useState<Boot>({ state: "loading" });

  const reload = useCallback(() => {
    setBoot({ state: "loading" });
    void (async () => {
      try {
        const status = await fetchSetupStatus();
        if (!status.installed) {
          setBoot({ state: "setup" });
          return;
        }
        const user = await fetchSession();
        if (user === null) {
          setBoot({ state: "signIn", clubName: status.clubName });
        } else {
          setBoot({ state: "ready", clubName: status.clubName, user });
        }
      } catch (error) {
        setBoot({
          state: "error",
          message:
            error instanceof Error
              ? error.message
              : "Le back-office n'a pas pu être contacté. Réessayez.",
        });
      }
    })();
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  if (boot.state === "loading") {
    return <BootSplash />;
  }
  if (boot.state === "error") {
    return <BootError message={boot.message} onRetry={reload} />;
  }

  // Fresh instance: the wizard takes over every URL of the back-office.
  if (boot.state === "setup") {
    return (
      <Routes>
        <Route path="/setup" element={<SetupPage onInstalled={reload} />} />
        <Route path="*" element={<Navigate to="/setup" replace />} />
      </Routes>
    );
  }

  // Installed but no session: the sign-in takes over every URL of the back-office.
  if (boot.state === "signIn") {
    return (
      <Routes>
        <Route
          path="/connexion"
          element={<SignInPage clubName={boot.clubName} onSignedIn={reload} />}
        />
        <Route path="*" element={<Navigate to="/connexion" replace />} />
      </Routes>
    );
  }

  // The enabled modules are loaded once the session is open: their blocks for the editor,
  // their pages for the menu.
  return (
    <ModulesProvider>
      <Routes>
        <Route element={<Shell clubName={boot.clubName} user={boot.user} onSignedOut={reload} />}>
          <Route index element={<DashboardPage clubName={boot.clubName} user={boot.user} />} />
          <Route path="pages" element={<PagesPage />} />
          <Route path="navigation" element={<NavigationPage />} />
          <Route path="modules" element={<ModulesPage />} />
          <Route path="modules/:id/*" element={<ModuleAdminPage user={boot.user} />} />
          <Route
            path="reglages"
            element={
              <ComingSoonPage title="Réglages">
                Les réglages du club et des utilisateurs arrivent dans une prochaine version.
              </ComingSoonPage>
            }
          />
        </Route>
        {/* The editor takes the whole viewport, without the shell around it. */}
        <Route path="pages/edition" element={<PageEditorPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ModulesProvider>
  );
}
