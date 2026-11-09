import "server-only";

import {
  assertSupabaseConfigured,
  configuredHttpsOrigin,
  HttpError,
  supabaseRequest,
} from "./supabase";

export { HttpError } from "./supabase";

export type OrganizationRole = "owner" | "admin" | "responder" | "viewer";

export interface UserContext {
  readonly accessToken: string;
  readonly userId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES: ReadonlySet<string> = new Set(["owner", "admin", "responder", "viewer"]);
const verifiedContexts = new WeakSet<UserContext>();

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Verify the bearer token with Supabase Auth, never by decoding request claims. */
export async function getUserContext(request: Request): Promise<UserContext> {
  assertSupabaseConfigured();
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer ([A-Za-z0-9._~+/-]+=*)$/i);
  if (!match || match[1].length > 8_192) {
    throw new HttpError(401, "Authentication required.");
  }
  const accessToken = match[1];
  let user: unknown;
  try {
    user = await supabaseRequest("/auth/v1/user", {}, accessToken);
  } catch (error) {
    if (error instanceof HttpError && [400, 401, 403].includes(error.status)) {
      throw new HttpError(401, "Authentication required.");
    }
    if (error instanceof HttpError && error.status === 404) {
      throw new HttpError(503, "Authentication service is unavailable.");
    }
    throw error;
  }
  if (!record(user) || typeof user.id !== "string" || !UUID.test(user.id)) {
    throw new HttpError(401, "Authentication required.");
  }
  // The returned object is request-local proof of verification. Copying or
  // constructing an object with the same fields does not create that proof.
  const context: UserContext = Object.freeze({ accessToken, userId: user.id.toLowerCase() });
  verifiedContexts.add(context);
  return context;
}

/**
 * Check the live membership using the verified user's token (and therefore RLS).
 * Pass the exact context returned by getUserContext. Roles are an explicit
 * allowlist, not an implicit hierarchy. Returns the user's allowed role.
 */
export async function requireRole(
  context: UserContext,
  organizationId: string,
  roles: readonly OrganizationRole[],
): Promise<OrganizationRole> {
  if (!context || !verifiedContexts.has(context)) {
    throw new HttpError(401, "Authentication required.");
  }
  if (typeof organizationId !== "string" || !UUID.test(organizationId)) {
    throw new HttpError(400, "Invalid organization.");
  }
  if (!Array.isArray(roles) || !roles.length || roles.some((role) => !ROLES.has(role))) {
    throw new HttpError(403, "Access denied.");
  }
  const organization = organizationId.toLowerCase();
  const query = new URLSearchParams({
    select: "organization_id,user_id,role",
    organization_id: `eq.${organization}`,
    user_id: `eq.${context.userId}`,
    limit: "2",
  });
  let memberships: unknown;
  try {
    memberships = await supabaseRequest(`memberships?${query}`, {}, context.accessToken);
  } catch (error) {
    if (error instanceof HttpError && [400, 404].includes(error.status)) {
      throw new HttpError(503, "Authorization service is unavailable.");
    }
    throw error;
  }
  // Validate scope as well as role even if an upstream policy is misconfigured.
  const membership = Array.isArray(memberships) && memberships.length === 1 ? memberships[0] : null;
  if (
    !record(membership) ||
    membership.organization_id !== organization ||
    membership.user_id !== context.userId ||
    typeof membership.role !== "string" ||
    !ROLES.has(membership.role) ||
    !roles.includes(membership.role as OrganizationRole)
  ) {
    throw new HttpError(403, "Access denied.");
  }
  return membership.role as OrganizationRole;
}

/** Mutation guard. Missing Origin is rejected; Host/forwarded headers are not trusted. */
export function requireSameOrigin(request: Request): void {
  const expectedOrigin = configuredHttpsOrigin("APP_ORIGIN");
  const origin = request.headers.get("origin");
  if (!origin || /[\\*\s\u0000-\u001f\u007f]/.test(origin)) {
    throw new HttpError(403, "Same-origin request required.");
  }
  try {
    const actual = new URL(origin);
    if (
      actual.origin !== expectedOrigin ||
      actual.protocol !== "https:" ||
      actual.username ||
      actual.password ||
      actual.pathname !== "/" ||
      actual.search ||
      actual.hash
    ) {
      throw new Error("Origin mismatch");
    }
  } catch {
    throw new HttpError(403, "Same-origin request required.");
  }
  const site = request.headers.get("sec-fetch-site");
  if (site !== null && site !== "same-origin" && site !== "none") {
    throw new HttpError(403, "Same-origin request required.");
  }
}
