import type { Context, MiddlewareHandler } from "hono";

/** Options of a rate limiter: `max` requests per `windowMs`, counted per key. */
export interface RateLimitOptions {
  readonly windowMs: number;
  readonly max: number;
}

/** Decision of {@link RateLimiter.tryConsume}. */
export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds after which the next attempt may run, when refused. */
  readonly retryAfterSeconds: number | null;
}

export interface RateLimiter {
  /**
   * Counts one attempt of `key` (typically a client IP) and decides whether it may run.
   * A sliding window: only the attempts of the last `windowMs` count.
   */
  readonly tryConsume: (key: string) => RateLimitDecision;
  /** Number of keys currently tracked (for the tests and monitoring). */
  readonly size: () => number;
}

/** The limiter never tracks more keys than this: expired ones are swept, then oldest evicted. */
export const RATE_LIMIT_MAX_KEYS = 10_000;

/**
 * Sliding-window rate limiter in memory, per process. It protects the installation and the
 * sign-in (on top of Better Auth's own limiter, enabled in production) from brute-force
 * attempts. The keys live as long as their newest attempt; the memory stays bounded by
 * {@link RATE_LIMIT_MAX_KEYS} no matter what: expired keys are swept, and beyond that cap the
 * oldest keys are evicted.
 *
 * Better Auth's own limiter, `memory` storage, is separate; this one is ours so it also runs in
 * development, where theirs is disabled, and on the setup route, which Better Auth does not
 * know about.
 */
export function createRateLimiter(options: RateLimitOptions): RateLimiter {
  const { windowMs, max } = options;
  if (!Number.isInteger(windowMs) || windowMs <= 0) {
    throw new RangeError("La fenêtre de limitation de débit doit être un nombre de ms positif.");
  }
  if (!Number.isInteger(max) || max <= 0) {
    throw new RangeError("Le maximum de tentatives doit être un entier positif.");
  }
  /** Timestamps of the attempts of each key, in insertion order. */
  const attempts = new Map<string, number[]>();

  function sweep(now: number): void {
    for (const [key, timestamps] of attempts) {
      const newest = timestamps.at(-1);
      if (newest === undefined || now - newest >= windowMs) {
        attempts.delete(key);
      }
    }
  }

  return {
    tryConsume(key: string): RateLimitDecision {
      const now = Date.now();
      if (attempts.size >= RATE_LIMIT_MAX_KEYS) {
        sweep(now);
      }
      const fresh = (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
      if (fresh.length >= max) {
        const oldest = fresh[0];
        const remaining = oldest === undefined ? windowMs : windowMs - (now - oldest);
        attempts.set(key, fresh);
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)),
        };
      }
      fresh.push(now);
      attempts.set(key, fresh);
      // A flood of distinct keys never grows the map past the cap: when the new key crosses
      // it, the oldest tracked key (insertion order, the one idle the longest) leaves.
      if (attempts.size > RATE_LIMIT_MAX_KEYS) {
        const oldest = attempts.keys().next();
        if (oldest.done !== true) {
          attempts.delete(oldest.value);
        }
      }
      return { allowed: true, retryAfterSeconds: null };
    },
    size: () => attempts.size,
  };
}

export interface ClientIpOptions {
  /**
   * Trust `x-forwarded-for` (first address) instead of the socket address. Only for requests
   * that came through the reverse proxy overwriting the header (supervisor, Caddy): a client
   * reaching the server directly can forge it and rotate its rate-limit key.
   */
  readonly trustProxy?: boolean;
}

/**
 * Client IP the requests are limited by. With a trusted proxy: the first address of
 * `x-forwarded-for`. Otherwise: the address of the socket, the only one that cannot be forged.
 * Fail closed: without any address, every anonymous client shares one limit, rather than none.
 */
export function clientIp(context: Context, options: ClientIpOptions = {}): string {
  if (options.trustProxy === true) {
    const forwarded = context.req.header("x-forwarded-for");
    const ip = forwarded?.split(",")[0]?.trim();
    if (ip !== undefined && ip !== "") {
      return ip;
    }
  }
  const socket = (context.env as NodeEnv | undefined)?.incoming?.socket?.remoteAddress;
  return socket ?? "unknown";
}

/** The Node environment `@hono/node-server` injects (its bindings are typed loosely). */
interface NodeEnv {
  readonly incoming?: { readonly socket?: { readonly remoteAddress?: string } };
}

/** Response sent when the limit is reached, with a `Retry-After` header when computable. */
function tooManyRequests(context: Context, retryAfterSeconds: number | null): Response {
  const headers =
    retryAfterSeconds === null ? undefined : { "Retry-After": String(retryAfterSeconds) };
  return context.json({ error: "Trop de tentatives. Réessayez dans un instant." }, 429, headers);
}

/** Middleware refusing requests beyond the limiter's `max` per window, for the client's IP. */
export function rateLimit(limiter: RateLimiter, client: ClientIpOptions = {}): MiddlewareHandler {
  return async (context, next) => {
    const decision = limiter.tryConsume(clientIp(context, client));
    if (!decision.allowed) {
      return tooManyRequests(context, decision.retryAfterSeconds);
    }
    return next();
  };
}
