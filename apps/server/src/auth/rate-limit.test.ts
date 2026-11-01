import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimiter, RATE_LIMIT_MAX_KEYS } from "./rate-limit.js";

describe("createRateLimiter", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows up to max attempts per window, then refuses with a retry delay", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2 });
    expect(limiter.tryConsume("1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: null });
    expect(limiter.tryConsume("1.2.3.4")).toEqual({ allowed: true, retryAfterSeconds: null });
    const refused = limiter.tryConsume("1.2.3.4");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterSeconds).toBeGreaterThan(0);
    expect(refused.retryAfterSeconds).toBeLessThanOrEqual(10);
  });

  it("opens the window again once it has slid", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiter.tryConsume("a").allowed).toBe(true);
    expect(limiter.tryConsume("a").allowed).toBe(false);
    vi.advanceTimersByTime(9_999);
    expect(limiter.tryConsume("a").allowed).toBe(false);
    vi.advanceTimersByTime(1);
    expect(limiter.tryConsume("a").allowed).toBe(true);
  });

  it("slides: only the attempts of the last window count", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 2 });
    limiter.tryConsume("b");
    vi.advanceTimersByTime(6_000);
    limiter.tryConsume("b");
    vi.advanceTimersByTime(4_001); // the first attempt left the window, the second is still in.
    expect(limiter.tryConsume("b").allowed).toBe(true);
    expect(limiter.tryConsume("b").allowed).toBe(false);
  });

  it("counts keys independently", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    expect(limiter.tryConsume("première").allowed).toBe(true);
    expect(limiter.tryConsume("seconde").allowed).toBe(true);
    expect(limiter.tryConsume("première").allowed).toBe(false);
    expect(limiter.size()).toBe(2);
  });

  it("keeps the memory bounded: the oldest keys leave beyond the cap", () => {
    const limiter = createRateLimiter({ windowMs: 10_000, max: 1 });
    for (let i = 0; i < RATE_LIMIT_MAX_KEYS + 10; i++) {
      limiter.tryConsume(`ip-${i}`);
    }
    expect(limiter.size()).toBe(RATE_LIMIT_MAX_KEYS);
    // The first keys are gone, the newest ones are still limited.
    expect(limiter.tryConsume("ip-0").allowed).toBe(true);
    expect(limiter.tryConsume(`ip-${RATE_LIMIT_MAX_KEYS + 9}`).allowed).toBe(false);
    vi.advanceTimersByTime(10_001); // everything expires: the next attempt sweeps.
    expect(limiter.tryConsume("nouvelle").allowed).toBe(true);
    expect(limiter.size()).toBe(1);
  });

  it("refuses a non-positive window or max", () => {
    expect(() => createRateLimiter({ windowMs: 0, max: 1 })).toThrow(RangeError);
    expect(() => createRateLimiter({ windowMs: 1_000, max: 0 })).toThrow(RangeError);
    expect(() => createRateLimiter({ windowMs: 1_000.5, max: 1 })).toThrow(RangeError);
  });
});
