/**
 * W91 — resolve the authenticated user from a PB session (any plan, not
 * super-admin). Reads pbToken from `?pbToken=` or the Authorization header,
 * verifies via PB auth-refresh. Returns null on any failure.
 */

import { pbUrl } from "../pb";

export type AuthedUser = { id: string; email: string };

/** Verify a PB *user* session token directly. Returns the user, or null. */
export async function whoAmIByToken(pbToken: string): Promise<AuthedUser | null> {
  if (!pbToken) return null;
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

export async function whoAmI(req: Request): Promise<AuthedUser | null> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  return whoAmIByToken(pbToken);
}

/** True when the token is a valid PocketBase superuser (admin) token. */
export async function isAdminToken(pbToken: string): Promise<boolean> {
  if (!pbToken) return false;
  try {
    const res = await fetch(`${pbUrl()}/api/collections/_superusers/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * h6f — resolve the trusted user id for /api/agent, which must never trust a
 * body `userId`:
 *   - a valid USER session token → that token's owner (body userId ignored).
 *   - a valid ADMIN/superuser token (internal worker, e.g. workflow-drain,
 *     passes the admin token as pbToken) → trust the body userId so
 *     worker-initiated runs keep their user context.
 *   - otherwise (no/garbage token) → null (anonymous; no user-scoped work).
 */
export async function resolveAgentUserId(
  pbToken: string | undefined,
  bodyUserId: string | undefined,
): Promise<string | null> {
  if (!pbToken) return null;
  const user = await whoAmIByToken(pbToken);
  if (user) return user.id;
  if (await isAdminToken(pbToken)) return bodyUserId?.trim() || null;
  return null;
}

/**
 * h6e — bind a body `pbToken` to a body `userId`. Routes that take the session
 * token in the request body (rather than the Authorization header / query)
 * must confirm the token actually belongs to the claimed user before keying an
 * admin-token operation on that user; otherwise any valid session can act as
 * anyone. Returns true only when the token's owner === userId.
 */
export async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  if (!userId || !pbToken) return false;
  try {
    const res = await fetch(`${pbUrl()}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id === userId;
  } catch {
    return false;
  }
}
