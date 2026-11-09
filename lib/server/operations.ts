import "server-only";

import {
  getUserContext,
  HttpError,
  requireRole,
  requireSameOrigin,
  type OrganizationRole,
} from "./security";
import { supabaseRequest } from "./supabase";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const READ_ROLES: readonly OrganizationRole[] = ["owner", "admin", "responder", "viewer"];
const MUTATION_ROLES: readonly OrganizationRole[] = ["owner", "admin", "responder"];
const MAX_PAGE_SIZE = 100;
const MAX_OFFSET = 1_000_000;
const MAX_BODY_BYTES = 16 * 1024;

export type OperationResource = "devices" | "journeys" | "alerts";

interface JsonObject {
  [key: string]: unknown;
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new HttpError(400, message);
}

function organizationId(request: Request): string {
  const value = new URL(request.url).searchParams.get("organization_id");
  if (!value || !UUID.test(value)) invalid("A valid organization_id is required.");
  return value.toLowerCase();
}

function pageValue(request: Request, name: "limit" | "offset", fallback: number, maximum: number): number {
  const raw = new URL(request.url).searchParams.get(name);
  if (raw === null || raw === "") return fallback;
  if (!/^\d+$/.test(raw)) invalid(`Invalid ${name}.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum || name === "limit" && value === 0) {
    invalid(`Invalid ${name}.`);
  }
  return value;
}

function optionalUuid(request: Request, name: string): string | null {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null || value === "") return null;
  if (!UUID.test(value)) invalid(`Invalid ${name}.`);
  return value.toLowerCase();
}

function optionalText(request: Request, name: string, maxLength: number): string | null {
  const value = new URL(request.url).searchParams.get(name);
  if (value === null || value === "") return null;
  if (value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value)) invalid(`Invalid ${name}.`);
  return value;
}

function responseHeaders(): Headers {
  return new Headers({ "Cache-Control": "no-store", Vary: "Authorization" });
}

/** Convert only known server errors to public responses; never echo upstream data. */
export function operationErrorResponse(error: unknown): Response {
  const failure = error instanceof HttpError
    ? error
    : new HttpError(503, "Operations service is unavailable.");
  const headers = responseHeaders();
  if (failure.status === 401) headers.set("WWW-Authenticate", "Bearer");
  return Response.json({ error: failure.message }, { status: failure.status, headers });
}

function operationQuery(request: Request, resource: OperationResource, orgId: string): string {
  const url = new URL(request.url);
  const params = new URLSearchParams();
  params.set("select", resource === "devices"
    ? "id,organization_id,external_id,name,status,last_seen_at,created_at,updated_at"
    : resource === "journeys"
      ? "id,organization_id,device_id,started_at,ended_at,status,start_latitude,start_longitude,end_latitude,end_longitude,metadata,created_at"
      : "id,organization_id,device_id,sos_event_id,kind,severity,state,title,message,created_at,acknowledged_at,resolved_at");
  params.set("organization_id", `eq.${orgId}`);
  params.set("order", resource === "devices" ? "created_at.desc,id.desc" : resource === "journeys" ? "started_at.desc,id.desc" : "created_at.desc,id.desc");
  params.set("limit", String(pageValue(request, "limit", 50, MAX_PAGE_SIZE)));
  params.set("offset", String(pageValue(request, "offset", 0, MAX_OFFSET)));

  const deviceId = optionalUuid(request, "device_id");
  if (deviceId && resource !== "devices") params.set("device_id", `eq.${deviceId}`);
  const status = optionalText(request, "status", 32);
  if (status) params.set("status", `eq.${status}`);
  const state = optionalText(request, "state", 32);
  if (state && resource === "alerts") params.set("state", `eq.${state}`);
  const since = optionalText(request, "since", 40);
  if (since) {
    // Restrict this to a Postgres timestamp shape; URL encoding is still handled by URLSearchParams.
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(since)) invalid("Invalid since.");
    params.set(resource === "journeys" ? "started_at" : "created_at", `gte.${since}`);
  }
  // A query parameter is never used as a table or projection name.
  return `${resource}?${params.toString()}`;
}

export async function listOperations(request: Request, resource: OperationResource): Promise<Response> {
  try {
    if (request.method !== "GET") {
      const response = Response.json({ error: "Use GET for this resource." }, { status: 405, headers: responseHeaders() });
      response.headers.set("Allow", "GET");
      return response;
    }
    const context = await getUserContext(request);
    const orgId = organizationId(request);
    await requireRole(context, orgId, READ_ROLES);
    const result = await supabaseRequest<unknown>(operationQuery(request, resource, orgId), {}, context.accessToken);
    if (!Array.isArray(result)) throw new HttpError(502, "Operations service returned an invalid response.");
    return Response.json({ data: result }, { status: 200, headers: responseHeaders() });
  } catch (error) {
    return operationErrorResponse(error);
  }
}

async function readBoundedJson(request: Request): Promise<JsonObject> {
  const mediaType = request.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json") throw new HttpError(415, "Content-Type must be application/json.");
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null && (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_BODY_BYTES)) {
    throw new HttpError(413, "Request body is too large.");
  }
  let text: string;
  try {
    text = await request.text();
  } catch {
    throw new HttpError(400, "Request body could not be read.");
  }
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
  if (!isObject(parsed) || Object.keys(parsed).length !== 1 || typeof parsed.action !== "string") {
    throw new HttpError(400, "Expected an action.");
  }
  return parsed;
}

export async function transitionSos(request: Request, sosId: string): Promise<Response> {
  try {
    if (request.method !== "POST" && request.method !== "PATCH") {
      const response = Response.json({ error: "Use POST or PATCH for this resource." }, { status: 405, headers: responseHeaders() });
      response.headers.set("Allow", "POST, PATCH");
      return response;
    }
    if (!UUID.test(sosId)) throw new HttpError(400, "Invalid SOS id.");
    requireSameOrigin(request);
    const context = await getUserContext(request);
    const body = await readBoundedJson(request);
    if (body.action !== "acknowledge" && body.action !== "resolve") throw new HttpError(400, "Unsupported SOS action.");
    const orgId = organizationId(request);
    await requireRole(context, orgId, MUTATION_ROLES);
    const result = await supabaseRequest<unknown>("rpc/transition_sos", {
      method: "POST",
      body: JSON.stringify({ p_sos_id: sosId.toLowerCase(), p_action: body.action, p_actor: context.userId }),
    }, context.accessToken);
    if (!isObject(result) || result.id !== sosId.toLowerCase() || (result.state !== "acknowledged" && result.state !== "resolved") || typeof result.duplicate !== "boolean") {
      throw new HttpError(502, "Operations service returned an invalid transition.");
    }
    return Response.json({ id: result.id, state: result.state, duplicate: result.duplicate }, { status: 200, headers: responseHeaders() });
  } catch (error) {
    return operationErrorResponse(error);
  }
}
