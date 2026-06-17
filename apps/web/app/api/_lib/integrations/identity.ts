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
