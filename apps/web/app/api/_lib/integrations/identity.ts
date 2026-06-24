/**
 * W91 — resolve the authenticated user from a PB session (any plan, not
 * super-admin). Reads pbToken from `?pbToken=` or the Authorization header,
 * verifies via PB auth-refresh. Returns null on any failure.
 */

import { pbUrl } from "../pb";

export type AuthedUser = { id: string; email: string };

export async function whoAmI(req: Request): Promise<AuthedUser | null> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
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
