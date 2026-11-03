import { ApiError, toApiError } from "./errors";

export interface RequestJsonOptions {
  /** `GET` by default. */
  readonly method?: "POST";
  /** Body sent as JSON; absent for a `GET`. */
  readonly body?: unknown;
  /** French message of the error when the response gives none (network shape, unknown code). */
  readonly fallback: string;
}

/**
 * One JSON call to the API of the instance, on the same origin, cookies included. The browser
 * sends the `Origin` header itself on a `POST`, as Better Auth's origin check expects, and a
 * JSON body carries `content-type: application/json` (a body without it is refused 415).
 *
 * Every failure comes back as an {@link ApiError} with a French message: an unreachable server
 * or an unreadable body never leaks the browser's English `TypeError` to the interface.
 */
export async function requestJson<T>(path: string, options: RequestJsonOptions): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
    });
  } catch {
    // The server is unreachable (restarting in development, offline): nothing readable, only
    // the French fallback may speak.
    throw new ApiError(0, options.fallback);
  }
  if (!response.ok) {
    throw await toApiError(response, options.fallback);
  }
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw new ApiError(response.status, options.fallback);
  }
  try {
    return (text === "" ? undefined : JSON.parse(text)) as T;
  } catch {
    throw new ApiError(response.status, options.fallback);
  }
}
