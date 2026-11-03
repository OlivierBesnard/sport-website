import { requestJson } from "./client";

/** Colors of the club, as the installation API expects them (hexadecimal `#rrggbb`). */
export interface ClubColors {
  readonly primary: string;
  readonly secondary?: string;
  readonly accent?: string;
}

/** Body of `POST /api/setup`: the identity of the club, then the account of the owner. */
export interface SetupInput {
  readonly club: {
    readonly name: string;
    readonly sports: string[];
    readonly colors: ClubColors;
  };
  readonly owner: {
    readonly name: string;
    readonly email: string;
    readonly password: string;
  };
}

/** Answer of `GET /api/setup`: whether the instance is already installed. */
export interface SetupStatus {
  readonly installed: boolean;
  readonly clubName: string | null;
}

/** Whether the instance is installed, with the name of the club when it is. */
export async function fetchSetupStatus(): Promise<SetupStatus> {
  return requestJson<SetupStatus>("/api/setup", {
    fallback: "Impossible de vérifier l'installation de l'instance.",
  });
}

/**
 * Installs the instance (once). The answer already signs the owner in (session cookie): the
 * wizard goes to the dashboard, without asking the password a second time.
 */
export async function install(input: SetupInput): Promise<void> {
  await requestJson<unknown>("/api/setup", {
    method: "POST",
    body: input,
    fallback: "L'installation a échoué. Réessayez.",
  });
}
