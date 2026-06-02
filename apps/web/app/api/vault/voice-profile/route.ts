/**
 * GET  /api/vault/voice-profile?userId=...
 * POST /api/vault/voice-profile   { userId, pbToken }
 *
 * Settings UI hits these. GET reads the stored profile; POST triggers an
 * on-demand recompute (e.g. "recompute now" button).
 *
 * Auth: GET takes a userId query param + accepts the caller's pbToken via
 * Authorization header for a cheap visibility check; POST requires pbToken
 * in the body (matches the V4b / V6 endpoint convention).
 */

import { pbUrl } from "../../_lib/pb";
import { fetchVoiceProfile, recomputeVoiceProfile } from "../../_lib/vault/voice";

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
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

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  const pbToken = req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const profile = await fetchVoiceProfile(userId);
  if (!profile) {
    return Response.json({ ok: true, profile: null, reason: "no_profile_yet" });
  }
  return Response.json({ ok: true, profile });
}

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const { userId, pbToken } = body;
  if (!userId || !pbToken) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const result = await recomputeVoiceProfile(userId);
  if (!result.ok) {
    return Response.json({ ok: false, reason: result.reason });
  }
  const profile = await fetchVoiceProfile(userId);
  return Response.json({ ok: true, profile });
}
