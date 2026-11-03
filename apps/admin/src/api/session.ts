import { requestJson } from "./client";
import { ApiError } from "./errors";

/** User of a session, as returned by Better Auth (`role` is a server-owned field). */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
}

interface SessionPayload {
  readonly user?: SessionUser | null;
}

/** Signs the current browser in; returns its user. Better Auth sets the session cookie. */
export async function signIn(email: string, password: string): Promise<SessionUser> {
  const session = await requestJson<SessionPayload>("/api/auth/sign-in/email", {
    method: "POST",
    body: { email, password },
    fallback: "La connexion a échoué. Réessayez.",
  });
  if (session?.user === undefined || session.user === null) {
    throw new ApiError(200, "La connexion a échoué. Réessayez.");
  }
  return session.user;
}

/** Session of the current browser, or `null` without any (Better Auth answers `null`). */
export async function fetchSession(): Promise<SessionUser | null> {
  const session = await requestJson<SessionPayload>("/api/auth/get-session", {
    fallback: "Impossible de vérifier la session.",
  });
  return session?.user ?? null;
}

/** Signs the current session out (the session cookie is cleared). */
export async function signOut(): Promise<void> {
  await requestJson<unknown>("/api/auth/sign-out", {
    method: "POST",
    body: {},
    fallback: "La déconnexion a échoué. Réessayez.",
  });
}
