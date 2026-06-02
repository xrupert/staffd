/**
 * GET  /api/user/autopilot?userId=...
 * POST /api/user/autopilot   { userId, pbToken, mode?, pauseUntil? }
 *
 * Autonomy controls (Phase 9). Persists the user's autopilot preference on
 * their `subscriptions` row so the nightly Morning Brief worker can honor it.
 *
 * Semantics:
 *   mode: "on" | "off" — null/absent treated as "on" (the default)
 *   pauseUntil: ISO datetime — when set in the future, autopilot is treated
 *     as paused regardless of mode. Sending `pauseUntil: null` clears the pause.
 *
 * Auth: PB session via pbToken; ownership-verified via auth-refresh.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";

const VALID_MODES = new Set(["on", "off"]);

type SubRow = {
  id: string;
  autopilot_mode?: string | null;
  autopilot_paused_until?: string | null;
};

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  if (!pbToken) return false;
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

function deriveStatus(mode: string | null | undefined, pauseUntil: string | null | undefined): "active" | "paused" | "off" {
  if (mode === "off") return "off";
  if (pauseUntil) {
    const until = new Date(pauseUntil).getTime();
    if (!Number.isNaN(until) && until > Date.now()) return "paused";
  }
  return "active";
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  const pbToken = req.headers.get("authorization") ?? "";
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const sub = await pbFirst<SubRow>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "id,autopilot_mode,autopilot_paused_until" }
    );
    const mode = (sub?.autopilot_mode as "on" | "off" | null | undefined) ?? null;
    const pauseUntil = sub?.autopilot_paused_until ?? null;
    return Response.json({
      ok: true,
      mode: mode ?? "on",
      pauseUntil,
      status: deriveStatus(mode, pauseUntil),
    });
  } catch (err) {
    console.error("autopilot GET error:", err);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: { userId?: string; pbToken?: string; mode?: string; pauseUntil?: string | null };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken } = body;
  if (!userId || !pbToken) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (body.mode !== undefined && body.mode !== null && !VALID_MODES.has(body.mode)) {
    return Response.json({ error: "invalid_mode" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const sub = await pbFirst<SubRow>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "id" }
    );

    const patch: Record<string, unknown> = {};
    if (body.mode !== undefined) patch.autopilot_mode = body.mode;
    // null pauseUntil explicitly clears the pause
    if (body.pauseUntil !== undefined) patch.autopilot_paused_until = body.pauseUntil ?? "";

    if (!sub) {
      // Create a minimal subscription row so the preference persists. Plan
      // stays default "starter" — the user can upgrade later.
      const createRes = await fetch(`${url}/api/collections/subscriptions/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({ user: userId, plan: "starter", ...patch }),
      });
      if (!createRes.ok) {
        return Response.json({ error: "create_failed" }, { status: 500 });
      }
    } else {
      const res = await fetch(`${url}/api/collections/subscriptions/records/${sub.id}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        return Response.json({ error: "patch_failed" }, { status: 500 });
      }
    }

    const fresh = await pbFirst<SubRow>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "autopilot_mode,autopilot_paused_until" }
    );
    return Response.json({
      ok: true,
      mode: (fresh?.autopilot_mode as "on" | "off" | null | undefined) ?? "on",
      pauseUntil: fresh?.autopilot_paused_until ?? null,
      status: deriveStatus(fresh?.autopilot_mode, fresh?.autopilot_paused_until),
    });
  } catch (err) {
    console.error("autopilot POST error:", err);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }
}
