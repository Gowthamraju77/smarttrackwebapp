// Next 15 aliases this marker to its bundled server-only guard; no package is needed.
import "server-only";

export class HttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

export interface SupabaseRequestOptions {
  method?: "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: HeadersInit;
  /** JSON.stringify the body before passing it, as with fetch. */
  body?: string;
  /** Required explicitly for trusted backend/device operations; never a fallback. */
  serviceRole?: boolean;
  /** Includes reading the response body; must be between 1 and 10,000 ms. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const TOKEN = /^[A-Za-z0-9._~+/-]+=*$/;

function configuredValue(name: string): string {
  const value = process.env[name]?.trim();
  if (!value || /\s/.test(value)) {
    throw new HttpError(503, "Service is not configured.");
  }
  return value;
}

/** Shared strict origin parsing: no credentials, paths, wildcards, or HTTP. */
export function configuredHttpsOrigin(name: "SUPABASE_URL" | "APP_ORIGIN"): string {
  const value = configuredValue(name);
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      /[\\*]/.test(value) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    ) {
      throw new Error("Invalid origin");
    }
    return url.origin;
  } catch {
    throw new HttpError(503, "Service is not configured.");
  }
}

function configuration(serviceRole: boolean): { origin: string; key: string } {
  const origin = configuredHttpsOrigin("SUPABASE_URL");
  const key = configuredValue(serviceRole ? "SUPABASE_SERVICE_ROLE_KEY" : "SUPABASE_ANON_KEY");
  if (key.length > 8_192 || !TOKEN.test(key)) {
    throw new HttpError(503, "Service is not configured.");
  }
  return { origin, key };
}

/** Lets protected handlers return 503 for missing configuration before authentication. */
export function assertSupabaseConfigured(serviceRole = false): void {
  configuration(serviceRole);
}

function endpointUrl(path: string, origin: string): URL {
  if (!path || path.length > 16_384 || /[\\#\s\u0000-\u001f\u007f]/.test(path)) {
    throw new HttpError(400, "Invalid data service path.");
  }
  const queryIndex = path.indexOf("?");
  const pathname = queryIndex < 0 ? path : path.slice(0, queryIndex);
  const query = queryIndex < 0 ? "" : path.slice(queryIndex);
  const relative = pathname.startsWith("/") ? pathname.slice(1) : pathname;

  // Endpoint names are code-owned. Queries may be URL-encoded, but endpoint paths
  // cannot contain an absolute URL, traversal, encoded separators, or empty segments.
  if (!/^[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(relative)) {
    throw new HttpError(400, "Invalid data service path.");
  }
  let endpoint: string;
  if (relative === "auth/v1/user") {
    endpoint = `/${relative}`;
  } else if (relative.startsWith("auth/")) {
    throw new HttpError(400, "Invalid data service path.");
  } else {
    endpoint = relative.startsWith("rest/v1/") ? `/${relative}` : `/rest/v1/${relative}`;
  }
  const url = new URL(endpoint + query, origin);
  if (url.origin !== origin) {
    throw new HttpError(400, "Invalid data service path.");
  }
  return url;
}

function upstreamError(status: number): HttpError {
  // Never forward Supabase error bodies, response headers, URLs, or credentials.
  switch (status) {
    case 400:
    case 422:
      return new HttpError(400, "Invalid request.");
    case 401:
      return new HttpError(401, "Authentication required.");
    case 403:
      return new HttpError(403, "Access denied.");
    case 404:
      return new HttpError(404, "Resource not found.");
    case 409:
      return new HttpError(409, "Request conflicts with existing data.");
    case 413:
      return new HttpError(413, "Request is too large.");
    case 429:
      return new HttpError(429, "Too many requests.");
    default:
      return new HttpError(503, "Data service is unavailable.");
  }
}

async function responseJson<T>(response: Response): Promise<T> {
  if (!response.body) return null as T;
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new HttpError(502, "Data service returned an invalid response.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return text.trim() ? JSON.parse(text) as T : null as T;
  } finally {
    reader.releaseLock();
  }
}

/**
 * JSON REST transport. Paths may be `devices?...`, `/rpc/name`, or `/rest/v1/...`.
 * `/auth/v1/user` is also supported for server-side token verification.
 * User mode requires the third argument. Service mode requires
 * `{ serviceRole: true }` and MUST omit that argument. Empty responses return null.
 */
export async function supabaseRequest<T = unknown>(
  path: string,
  options: SupabaseRequestOptions = {},
  accessToken?: string,
): Promise<T> {
  const serviceRole = options.serviceRole === true;
  const { origin, key } = configuration(serviceRole);
  if (serviceRole && accessToken !== undefined) {
    throw new HttpError(400, "Choose a single authentication mode.");
  }
  if (!serviceRole && (
    !accessToken || accessToken.length > 8_192 || !TOKEN.test(accessToken) ||
    accessToken === process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  )) {
    throw new HttpError(401, "Authentication required.");
  }

  const url = endpointUrl(path, origin);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new HttpError(400, "Invalid data service timeout.");
  }
  const method = options.method ?? "GET";
  if (
    !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"].includes(method) ||
    (options.body !== undefined && typeof options.body !== "string") ||
    (options.body !== undefined && (method === "GET" || method === "HEAD")) ||
    (url.pathname === "/auth/v1/user" && (method !== "GET" || serviceRole))
  ) {
    throw new HttpError(400, "Invalid data service request.");
  }

  let headers: Headers;
  try {
    headers = new Headers(options.headers);
    // Do not let caller-supplied headers choose the identity or virtual host.
    headers.delete("host");
    headers.delete("cookie");
    headers.delete("x-forwarded-host");
    headers.set("apikey", key);
    headers.set("authorization", `Bearer ${serviceRole ? key : accessToken}`);
    headers.set("accept", "application/json");
    if (options.body !== undefined) headers.set("content-type", "application/json");
  } catch {
    throw new HttpError(400, "Invalid data service request.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method,
      headers,
      body: options.body,
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });
    if (response.redirected || (response.status >= 300 && response.status < 400)) {
      throw new HttpError(502, "Data service returned an invalid response.");
    }
    if (!response.ok) throw upstreamError(response.status);
    if (response.status === 204 || response.status === 205 || method === "HEAD") return null as T;
    return await responseJson<T>(response);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    if (error instanceof SyntaxError || error instanceof TypeError && !controller.signal.aborted) {
      // Fetch may also throw TypeError with a URL or credential-bearing cause.
      throw new HttpError(503, "Data service is unavailable.");
    }
    throw new HttpError(503, "Data service is unavailable.");
  } finally {
    clearTimeout(timeout);
    // Cancel unread bodies on error, too. The timeout covers fetch and JSON parsing.
    controller.abort();
  }
}
