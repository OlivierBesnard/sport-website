/**
 * Mapping of the API errors into French messages. The API of the instance answers in French
 * (`{ error }`); Better Auth answers in English (`{ code, message }`) — the back-office never
 * shows its messages, only the mapped ones or a French fallback.
 */

/** French messages for the Better Auth codes the back-office can meet. */
const CODE_MESSAGES: Readonly<Record<string, string>> = {
  CREDENTIAL_ACCOUNT_NOT_FOUND: "E-mail ou mot de passe incorrect.",
  CROSS_SITE_NAVIGATION_LOGIN_BLOCKED: "Requête refusée : origine invalide. Rechargez la page.",
  EMAIL_ALREADY_VERIFIED: "Votre adresse électronique est déjà vérifiée.",
  EMAIL_NOT_VERIFIED: "Votre adresse électronique n'est pas encore vérifiée.",
  FAILED_TO_CREATE_SESSION: "La création de la session a échoué.",
  FAILED_TO_CREATE_USER: "La création du compte a échoué.",
  INVALID_EMAIL: "E-mail ou mot de passe incorrect.",
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou mot de passe incorrect.",
  INVALID_ORIGIN: "Requête refusée : origine invalide. Rechargez la page.",
  INVALID_PASSWORD: "E-mail ou mot de passe incorrect.",
  MISSING_OR_NULL_ORIGIN: "Requête refusée : origine absente. Rechargez la page.",
  PASSWORD_TOO_LONG: "Le mot de passe est trop long.",
  PASSWORD_TOO_SHORT: "Le mot de passe est trop court.",
  SESSION_EXPIRED: "Votre session a expiré, reconnectez-vous.",
  SESSION_NOT_FRESH: "Votre session a expiré, reconnectez-vous.",
  USER_ALREADY_EXISTS: "Un compte existe déjà avec cette adresse électronique.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "Un compte existe déjà avec cette adresse électronique.",
  USER_NOT_FOUND: "E-mail ou mot de passe incorrect.",
};

/** Message of a refused attempt (rate limit, ours or Better Auth's). */
export const RATE_LIMIT_MESSAGE = "Trop de tentatives. Réessayez dans un instant.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Field errors of a 400 answer of the installation (`{ "club.name": "message" }`). */
function fieldsOf(payload: unknown): Record<string, string> | undefined {
  if (!isRecord(payload) || !isRecord(payload.fields)) {
    return undefined;
  }
  const fields: Record<string, string> = {};
  for (const [name, message] of Object.entries(payload.fields)) {
    if (typeof message === "string" && message !== "") {
      fields[name] = message;
    }
  }
  return fields;
}

/** French message of a failed response, or `undefined` when only the fallback can answer. */
function messageOf(status: number, payload: unknown): string | undefined {
  if (!isRecord(payload)) {
    return undefined;
  }
  // The API of the instance always answers with a French `error`.
  if (typeof payload.error === "string" && payload.error !== "") {
    return payload.error;
  }
  if (status === 429) {
    return RATE_LIMIT_MESSAGE;
  }
  if (typeof payload.code === "string") {
    return CODE_MESSAGES[payload.code];
  }
  // Better Auth's English `message` is never shown: the caller's fallback wins.
  return undefined;
}

/** An API call that failed, with a message always in French and the field errors of a 400. */
export class ApiError extends Error {
  readonly status: number;
  readonly fields: Readonly<Record<string, string>> | undefined;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.fields = fields;
  }
}

/** Turns a failed response into an {@link ApiError}; `fallback` must already be in French. */
export async function toApiError(response: Response, fallback: string): Promise<ApiError> {
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    payload = undefined;
  }
  return new ApiError(
    response.status,
    messageOf(response.status, payload) ?? fallback,
    fieldsOf(payload),
  );
}
