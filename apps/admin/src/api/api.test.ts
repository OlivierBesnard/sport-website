import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "./client";
import { ApiError, RATE_LIMIT_MESSAGE, toApiError } from "./errors";

function jsonResponse(status: number, body?: unknown): Response {
  return new Response(body === undefined ? undefined : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("toApiError", () => {
  it("maps the Better Auth codes into French", async () => {
    const error = await toApiError(
      jsonResponse(401, {
        message: "Invalid email or password",
        code: "INVALID_EMAIL_OR_PASSWORD",
      }),
      "fallback",
    );
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(401);
    expect(error.message).toBe("E-mail ou mot de passe incorrect.");
  });

  it("never shows the English message of Better Auth", async () => {
    const wrongPassword = await toApiError(
      jsonResponse(401, { message: "Something went wrong", code: "USER_NOT_FOUND" }),
      "fallback",
    );
    expect(wrongPassword.message).toBe("E-mail ou mot de passe incorrect.");
    const limited = await toApiError(
      jsonResponse(429, { message: "Too many requests. Please try again later." }),
      "fallback",
    );
    expect(limited.message).toBe(RATE_LIMIT_MESSAGE);
  });

  it("keeps the French error of the API of the instance", async () => {
    const error = await toApiError(
      jsonResponse(409, { error: "L'instance est déjà installée." }),
      "fallback",
    );
    expect(error.message).toBe("L'instance est déjà installée.");
  });

  it("collects the field errors of the installation", async () => {
    const error = await toApiError(
      jsonResponse(400, {
        error: "Requête invalide.",
        fields: { "club.name": "Le nom du club est requis." },
      }),
      "fallback",
    );
    expect(error.fields).toEqual({ "club.name": "Le nom du club est requis." });
  });

  it("falls back to the French message when the answer is not JSON", async () => {
    const error = await toApiError(
      new Response("<h1>oops</h1>", { status: 500 }),
      "L'installation a échoué. Réessayez.",
    );
    expect(error.message).toBe("L'installation a échoué. Réessayez.");
  });

  it("falls back on an unknown code, without showing the English message", async () => {
    const error = await toApiError(
      jsonResponse(403, { message: "no way", code: "SOMETHING_ELSE" }),
      "Action impossible.",
    );
    expect(error.message).toBe("Action impossible.");
  });
});

describe("requestJson", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends a JSON POST same-origin and parses the answer", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe("/api/setup");
      expect(init).toBeDefined();
      const headers = (init?.headers ?? {}) as Record<string, string>;
      expect(init?.method).toBe("POST");
      expect(headers["content-type"]).toBe("application/json");
      expect(init?.credentials).toBe("same-origin");
      expect(String(init?.body)).toBe('{"club":"US Exemple"}');
      return jsonResponse(201, { club: { name: "US Exemple" } });
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = await requestJson<{ club: { name: string } }>("/api/setup", {
      method: "POST",
      body: { club: "US Exemple" },
      fallback: "fallback",
    });
    expect(body).toEqual({ club: { name: "US Exemple" } });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("throws the mapped ApiError on a failed call", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, {
          message: "Invalid email or password",
          code: "INVALID_EMAIL_OR_PASSWORD",
        }),
      ),
    );
    const error = await requestJson("/api/auth/sign-in/email", {
      method: "POST",
      body: {},
      fallback: "fallback",
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).message).toBe("E-mail ou mot de passe incorrect.");
  });
});
