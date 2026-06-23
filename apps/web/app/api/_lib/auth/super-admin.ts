/**
 * Super-Admin Architecture (Decision 74 — simplified).
 *
 * Identity model: a user is super-admin iff their email matches
 * `process.env.ADMIN_EMAIL` (single-admin Option α). Multi-admin
 * infrastructure deferred to backlog (Option γ).
 *
 * Three operational layers for super-admin overlay:
 *   1. PERMISSIONS — DEFERRED. No `canAccessX` functions currently exist
 *      in the codebase. When the first one is built (Tranche 2+),
 *      wrap with `isSuperAdmin()` short-circuit + log via
 *      `logSuperAdminAccess`.
 *   2. ADMIN SURFACES — enforced via `apps/web/app/dashboard/admin/layout.tsx`
 *      + this module's `requireSuperAdmin()` at the API tier.
 *   3. BILLING — applied at 2 real call sites (muapi, agent). Pattern
 *      documented for any future billing call site.
 *
 * IMPORTANT — when adding ANY new permission check or billing call site
 * in future tranches, FIRST check `isSuperAdmin` and bypass + log. This
 * is non-negotiable; partial bypass breaks the operator's ability to
 * use the product end-to-end without billing themselves.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../pb";

export type SuperAdminUser = { id: string; email: string };

/**
 * The operator email, resolved server-side. Prefers `ADMIN_EMAIL` but falls back
 * to `NEXT_PUBLIC_ADMIN_EMAIL` (also readable server-side) so that setting EITHER
 * makes super-admin work end-to-end. This closes a real footgun: the client shows
 * the admin nav off `NEXT_PUBLIC_ADMIN_EMAIL`, but the server gated super-admin
 * (and the STAFFD-self brand-voice override) on `ADMIN_EMAIL` only — so with just
 * the public var set, the operator's specialists lost STAFFD's brand voice and
 * asked onboarding questions. One resolver removes the client/server split.
 */
export function resolveAdminEmail(): string {
  return (process.env.ADMIN_EMAIL || process.env.NEXT_PUBLIC_ADMIN_EMAIL || "").trim().toLowerCase();
}

/**
 * Synchronous super-admin check given an already-resolved user identity.
 * Returns false for null user, null/empty ADMIN_EMAIL env, or any mismatch.
 * Comparison is case-insensitive and trims whitespace.
 */
export function isSuperAdmin(user: SuperAdminUser | null | undefined): boolean {
  if (!user || !user.email) return false;
  const adminEmail = resolveAdminEmail();
  if (!adminEmail) return false;
  return user.email.trim().toLowerCase() === adminEmail;
}

/**
 * Resolves the calling user from a PB JWT (auth-refresh). Returns null on
 * any failure (network, invalid token, missing record fields). Used by both
 * `requireSuperAdmin` and the non-throwing variants below.
 */
async function whoAmIInternal(pbToken: string): Promise<SuperAdminUser | null> {
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

/**
 * Auth error sentinel — thrown by `requireSuperAdmin`. Callers catch and
 * pass to `toAuthErrorResponse()` for a uniform Response shape.
 */
export class SuperAdminAuthError extends Error {
  constructor(
    public readonly status: 401 | 403 | 503,
    public readonly errorCode:
      | "missing_auth"
      | "unauthorized"
      | "forbidden"
      | "admin_not_configured",
  ) {
    super(errorCode);
    this.name = "SuperAdminAuthError";
  }
}

/**
 * Gate any super-admin API route. Reads `pbToken` from `?pbToken=` query
 * param or `Authorization` header (matching the codebase convention).
 *
 * Throws SuperAdminAuthError on any failure path. Returns the resolved
 * SuperAdminUser identity on success.
 *
 * Canonical usage:
 *
 *   let me: SuperAdminUser;
 *   try {
 *     me = await requireSuperAdmin(req);
 *   } catch (err) {
 *     return toAuthErrorResponse(err);
 *   }
 *   // ... super-admin-only logic
 */
export async function requireSuperAdmin(req: Request): Promise<SuperAdminUser> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) throw new SuperAdminAuthError(401, "missing_auth");
  const me = await whoAmIInternal(pbToken);
  if (!me) throw new SuperAdminAuthError(401, "unauthorized");
  const adminEmail = resolveAdminEmail();
  if (!adminEmail) throw new SuperAdminAuthError(503, "admin_not_configured");
  if (me.email.trim().toLowerCase() !== adminEmail) {
    throw new SuperAdminAuthError(403, "forbidden");
  }
  return me;
}

/** Convert a SuperAdminAuthError to a standard JSON Response. */
export function toAuthErrorResponse(err: unknown): Response {
  if (err instanceof SuperAdminAuthError) {
    return Response.json({ error: err.errorCode }, { status: err.status });
  }
  // Unexpected — re-throw so route-level catch/observability sees it
  throw err;
}

/**
 * Non-throwing super-admin probe given a PB JWT. Returns the resolved
 * SuperAdminUser if super-admin, null otherwise. Used by call sites that
 * apply a bypass (billing, future permissions) without gating access.
 */
export async function trySuperAdminFromToken(
  pbToken: string | null | undefined,
): Promise<SuperAdminUser | null> {
  if (!pbToken) return null;
  const me = await whoAmIInternal(pbToken);
  if (!isSuperAdmin(me)) return null;
  return me;
}

/**
 * Non-throwing super-admin probe by user id only (no PB JWT available).
 * Fetches the user record via the PB admin token and compares email.
 * Used by API routes that receive `userId` from the request body but
 * not the user's own token (e.g., /api/integrations/muapi).
 *
 * Returns the resolved SuperAdminUser if super-admin, null otherwise.
 * Returns null on any error (non-blocking).
 */
export async function trySuperAdminByUserId(
  userId: string | null | undefined,
): Promise<SuperAdminUser | null> {
  if (!userId) return null;
  const adminEmail = resolveAdminEmail();
  if (!adminEmail) return null;
  try {
    const token = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/users/records/${encodeURIComponent(userId)}?fields=id,email`,
      { headers: adminHeaders(token) },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { id?: string; email?: string };
    if (!data.id || !data.email) return null;
    const me: SuperAdminUser = { id: data.id, email: data.email };
    return isSuperAdmin(me) ? me : null;
  } catch {
    return null;
  }
}
