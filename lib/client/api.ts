"use client";

export const ACCESS_TOKEN_STORAGE_KEY = "smarttrack.access_token";

export type ApiErrorCode =
  | "AUTH_REQUIRED"
  | "AUTH_UNAVAILABLE"
  | "FORBIDDEN"
  | "UNCONFIGURED"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_REQUEST"
  | "INVALID_RESPONSE";

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number | null;

  constructor(code: ApiErrorCode, message: string, status: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export type ApiRequestOptions<TBody = unknown> = {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: TBody;
  headers?: HeadersInit;
  signal?: AbortSignal;
};

export type ApiOptions = Pick<ApiRequestOptions, "headers" | "signal">;

export function isAbortError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

function checkAborted(signal?: AbortSignal) {
  if (signal?.aborted) {
    throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
  }
}

function getApiPath(path: string): string {
  if (typeof window === "undefined") {
    throw new ApiError("AUTH_UNAVAILABLE", "A browser session is required to access SmartTrack services.");
  }

  try {
    const url = new URL(path, window.location.origin);
    if (
      !path.startsWith("/api/") ||
      url.origin !== window.location.origin ||
      !url.pathname.startsWith("/api/") ||
      url.hash
    ) {
      throw new Error("Invalid API path");
    }
    return `${url.pathname}${url.search}`;
  } catch {
    throw new ApiError("INVALID_REQUEST", "SmartTrack requests must use a same-origin /api/ path.");
  }
}

function readAccessToken(): string {
  let token: string | null;
  try {
    token = window.sessionStorage.getItem(ACCESS_TOKEN_STORAGE_KEY);
  } catch {
    throw new ApiError("AUTH_UNAVAILABLE", "Browser session storage is unavailable. Enable it and sign in again.");
  }

  const value = token?.trim();
  if (!value || !/^[A-Za-z0-9._~+/-]+=*$/.test(value)) {
    throw new ApiError("AUTH_REQUIRED", "Sign in to access SmartTrack services.", 401);
  }
  return value;
}

function responseError(status: number): ApiError {
  if (status === 401) {
    return new ApiError("AUTH_REQUIRED", "Your session is missing or expired. Sign in again.", status);
  }
  if (status === 403) {
    return new ApiError("FORBIDDEN", "Your account does not have permission to access this resource.", status);
  }
  if (status === 503) {
    return new ApiError("UNCONFIGURED", "SmartTrack services are not configured or are currently unavailable.", status);
  }
  return new ApiError("HTTP_ERROR", `SmartTrack API request failed (HTTP ${status}).`, status);
}

/**
 * Authenticated JSON requests to this application's API only. The current token
 * is read for every call; callers own sign-in and session storage updates.
 * Abort reasons propagate unchanged. No retries, cached data, or demo fallback.
 * TResponse describes the endpoint contract, not runtime validation. A 204/205
 * response returns undefined; use a void response type for those endpoints.
 */
export async function apiFetch<TResponse, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TResponse> {
  checkAborted(options.signal);
  const apiPath = getApiPath(path);
  const token = readAccessToken();
  const method = options.method ?? "GET";
  let headers: Headers;
  let body: string | undefined;

  try {
    headers = new Headers(options.headers);
    headers.set("Accept", "application/json");
    headers.set("Authorization", `Bearer ${token}`);
    if (options.body !== undefined) {
      if (method === "GET") throw new Error("GET body is not supported");
      body = JSON.stringify(options.body);
      if (body === undefined) throw new Error("Body is not JSON");
      headers.set("Content-Type", "application/json");
    }
  } catch {
    throw new ApiError("INVALID_REQUEST", "The request must have valid headers and a serializable JSON body.");
  }

  let response: Response;
  try {
    response = await fetch(apiPath, {
      method,
      headers,
      body,
      signal: options.signal,
      credentials: "omit",
      mode: "same-origin",
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    checkAborted(options.signal);
    if (isAbortError(error)) throw error;
    throw new ApiError("NETWORK_ERROR", "Unable to reach SmartTrack services. Check your connection and try again.");
  }

  checkAborted(options.signal);
  if (!response.ok) throw responseError(response.status);
  if (response.status === 204 || response.status === 205) return undefined as TResponse;

  try {
    const result: unknown = await response.json();
    checkAborted(options.signal);
    return result as TResponse;
  } catch (error) {
    checkAborted(options.signal);
    if (isAbortError(error)) throw error;
    throw new ApiError("INVALID_RESPONSE", "SmartTrack returned an invalid JSON response.", response.status);
  }
}

export function apiGet<TResponse>(path: string, options: ApiOptions = {}): Promise<TResponse> {
  return apiFetch<TResponse>(path, { ...options, method: "GET" });
}

export function apiPost<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
  options: ApiOptions = {},
): Promise<TResponse> {
  return apiFetch<TResponse, TBody>(path, { ...options, method: "POST", body });
}

export function apiPatch<TResponse, TBody = unknown>(
  path: string,
  body: TBody,
  options: ApiOptions = {},
): Promise<TResponse> {
  return apiFetch<TResponse, TBody>(path, { ...options, method: "PATCH", body });
}

// Only identity is required here. Other backend fields remain unknown until a
// consumer validates them; the client never invents operational device values.
export type Device = {
  id: string;
  [field: string]: unknown;
};

export type DevicesResponse = {
  devices: Device[];
};

export async function getDevices(options: ApiOptions = {}): Promise<Device[]> {
  const response = await apiGet<unknown>("/api/devices", options);
  if (
    typeof response !== "object" ||
    response === null ||
    !("devices" in response) ||
    !Array.isArray(response.devices) ||
    !response.devices.every((device: unknown): device is Device => (
      typeof device === "object" &&
      device !== null &&
      "id" in device &&
      typeof device.id === "string" &&
      device.id.trim().length > 0
    ))
  ) {
    throw new ApiError("INVALID_RESPONSE", "SmartTrack returned an invalid devices response.");
  }
  return response.devices;
}
