import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  request,
  type Server,
  type ServerResponse,
} from "node:http";

/**
 * Front door of the instance: every request goes through the supervisor to the version running.
 * It overwrites `x-forwarded-for` with the client's real address (the application trusts that
 * header, and only that one: a client cannot forge its rate-limit key). Pages served to anonymous
 * visitors are kept in memory, so that during the few seconds of a switch (or while the
 * application restarts) the public site keeps answering with them.
 */

/** Headers of one connection, never forwarded (RFC 9110 §7.6.1). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-connection",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/** Paths never kept: private, or meaningless once the application is down. */
const UNCACHED_PREFIXES = ["/api", "/admin", "/hooks", "/health"];

export const MAX_STALE_ENTRY_BYTES = 2 * 1024 * 1024;
export const MAX_STALE_TOTAL_BYTES = 32 * 1024 * 1024;

interface StaleEntry {
  readonly status: number;
  readonly headers: OutgoingHttpHeaders;
  readonly body: Buffer;
}

/** Last anonymous responses, least recently used dropped first, bounded in size. */
export class StaleCache {
  readonly #entries = new Map<string, StaleEntry>();
  readonly #maxTotal: number;
  #total = 0;

  constructor(maxTotalBytes = MAX_STALE_TOTAL_BYTES) {
    this.#maxTotal = maxTotalBytes;
  }

  get(key: string): StaleEntry | undefined {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      this.#entries.delete(key);
      this.#entries.set(key, entry);
    }
    return entry;
  }

  set(key: string, entry: StaleEntry): void {
    this.delete(key);
    this.#entries.set(key, entry);
    this.#total += entry.body.length;
    for (const [oldest, value] of this.#entries) {
      if (this.#total <= this.#maxTotal) {
        break;
      }
      this.#entries.delete(oldest);
      this.#total -= value.body.length;
    }
  }

  delete(key: string): void {
    const entry = this.#entries.get(key);
    if (entry !== undefined) {
      this.#entries.delete(key);
      this.#total -= entry.body.length;
    }
  }

  get size(): number {
    return this.#entries.size;
  }
}

/** Page sent when the application is down and nothing was kept for the address. */
const UNAVAILABLE_PAGE = [
  "<!DOCTYPE html>",
  '<html lang="fr">',
  '<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/><title>Site en cours de mise à jour</title></head>',
  "<body><main>",
  "<h1>Site en cours de mise à jour</h1>",
  "<p>Le site revient dans quelques instants. Rechargez la page d'ici une minute.</p>",
  "</main></body></html>",
].join("");

function isAnonymous(headers: IncomingHttpHeaders): boolean {
  return headers.cookie === undefined && headers.authorization === undefined;
}

function isCacheablePath(path: string): boolean {
  return !UNCACHED_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`) || path.startsWith(`${prefix}?`),
  );
}

function isStorable(response: IncomingMessage): boolean {
  const cacheControl = String(response.headers["cache-control"] ?? "").toLowerCase();
  return (
    response.statusCode === 200 &&
    response.headers["set-cookie"] === undefined &&
    !cacheControl.includes("private") &&
    !cacheControl.includes("no-store")
  );
}

/** Headers of a response, without those of the connection. */
function forwardableHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const listed = new Set(
    String(headers.connection ?? "")
      .split(",")
      .map((name) => name.trim().toLowerCase()),
  );
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !HOP_BY_HOP.has(name) && !listed.has(name)) {
      result[name] = value;
    }
  }
  return result;
}

export interface ProxyOptions {
  /**
   * The supervisor itself sits behind a reverse proxy (Caddy) that sets `x-forwarded-for`: the
   * client is then the last address of that header, written by that proxy. Otherwise, the
   * address of the socket.
   */
  readonly behindProxy?: boolean;
  readonly cache?: StaleCache;
  readonly logger?: Pick<Console, "error">;
}

export class SupervisorProxy {
  /** Port of the version running; `undefined` during a switch. */
  target: number | undefined;
  readonly cache: StaleCache;
  readonly #behindProxy: boolean;
  readonly #logger: Pick<Console, "error">;

  constructor(options: ProxyOptions = {}) {
    this.cache = options.cache ?? new StaleCache();
    this.#behindProxy = options.behindProxy ?? false;
    this.#logger = options.logger ?? console;
  }

  createServer(): Server {
    return createServer((incoming, outgoing) => this.handle(incoming, outgoing));
  }

  /** Real address of the client. */
  clientAddress(incoming: IncomingMessage): string {
    if (this.#behindProxy) {
      const forwarded = String(incoming.headers["x-forwarded-for"] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part !== "");
      const last = forwarded.at(-1);
      if (last !== undefined) {
        return last;
      }
    }
    return incoming.socket.remoteAddress ?? "unknown";
  }

  handle(incoming: IncomingMessage, outgoing: ServerResponse): void {
    const path = incoming.url ?? "/";
    const method = incoming.method ?? "GET";
    const cacheKey =
      (method === "GET" || method === "HEAD") &&
      isAnonymous(incoming.headers) &&
      isCacheablePath(path)
        ? path
        : undefined;
    const target = this.target;
    if (target === undefined) {
      this.#fallback(incoming, outgoing, cacheKey);
      return;
    }

    const headers = forwardableHeaders(incoming.headers);
    headers["x-forwarded-for"] = this.clientAddress(incoming);
    if (!this.#behindProxy) {
      // Nobody in front: whatever the client wrote there is its own invention.
      headers["x-forwarded-proto"] = "http";
      delete headers["x-forwarded-host"];
      delete headers.forwarded;
    }
    const upstream = request({
      host: "127.0.0.1",
      port: target,
      method,
      path,
      headers,
    });
    upstream.on("response", (response) => {
      const responseHeaders = forwardableHeaders(response.headers);
      outgoing.writeHead(response.statusCode ?? 502, responseHeaders);
      const keep = method === "GET" && cacheKey !== undefined && isStorable(response);
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        if (keep && size <= MAX_STALE_ENTRY_BYTES) {
          chunks.push(chunk);
          size += chunk.length;
        }
        outgoing.write(chunk);
      });
      response.on("end", () => {
        outgoing.end();
        if (keep && size <= MAX_STALE_ENTRY_BYTES) {
          this.cache.set(cacheKey, {
            status: 200,
            headers: responseHeaders,
            body: Buffer.concat(chunks),
          });
        }
      });
      response.on("error", () => outgoing.destroy());
    });
    upstream.on("error", (error: NodeJS.ErrnoException) => {
      if (outgoing.headersSent) {
        outgoing.destroy();
        return;
      }
      if (error.code !== "ECONNREFUSED" && error.code !== "ECONNRESET") {
        this.#logger.error("Superviseur : requête vers l'application en échec", error);
      }
      this.#fallback(incoming, outgoing, cacheKey);
    });
    incoming.pipe(upstream);
  }

  #fallback(incoming: IncomingMessage, outgoing: ServerResponse, cacheKey: string | undefined) {
    // The request body is not needed any more.
    incoming.resume();
    const entry = cacheKey === undefined ? undefined : this.cache.get(cacheKey);
    if (entry !== undefined) {
      const headers = { ...entry.headers };
      delete headers["content-length"];
      delete headers.etag;
      outgoing.writeHead(entry.status, {
        ...headers,
        "content-length": entry.body.length,
        "cache-control": "no-store",
      });
      outgoing.end(incoming.method === "HEAD" ? undefined : entry.body);
      return;
    }
    const body = Buffer.from(UNAVAILABLE_PAGE, "utf8");
    outgoing.writeHead(503, {
      "content-type": "text/html; charset=utf-8",
      "content-length": body.length,
      "cache-control": "no-store",
      "retry-after": "10",
    });
    outgoing.end(incoming.method === "HEAD" ? undefined : body);
  }
}
