/**
 * GET  /api/user/brief-preferences?userId=...
 * POST /api/user/brief-preferences  { userId, pbToken, ...patch }
 *
 * Phase 26 — Quiet Hours + Morning Brief customization.
 *
 * Persists timezone + delivery hour + quiet window + snooze flags on the
 * user's subscriptions row. The morning-brief worker + the brief-push
 * dispatcher consult these fields directly; no other surfaces.
 *
 * Patchable fields (each optional in any POST body):
 *   • timezone               — IANA string, e.g. "America/New_York"
 *   • preferred_delivery_hour — 0-23 local hour
 *   • quiet_hours_start      — 0-23
 *   • quiet_hours_end        — 0-23 (wraparound supported)
 *   • brief_snoozed_until    — ISO datetime, null clears
 *   • skip_next_brief        — boolean
 *
 * Auth: pbToken matched against userId via auth-refresh.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";
import { nextDeliverySummary, type BriefSchedulePrefs } from "../../_lib/push-schedule";

type SubRow = {
  id: string;
  timezone?: string | null;
  preferred_delivery_hour?: number | null;
  quiet_hours_start?: number | null;
  quiet_hours_end?: number | null;
  brief_snoozed_until?: string | null;
  skip_next_brief?: boolean | null;
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

function shapeResponse(sub: SubRow | null) {
  const prefs: BriefSchedulePrefs = {
    timezone: sub?.timezone ?? null,
    preferred_delivery_hour: sub?.preferred_delivery_hour ?? null,
    quiet_hours_start: sub?.quiet_hours_start ?? null,
    quiet_hours_end: sub?.quiet_hours_end ?? null,
    brief_snoozed_until: sub?.brief_snoozed_until ?? null,
    skip_next_brief: !!sub?.skip_next_brief,
  };
  return {
    ok: true,
    prefs,
    summary: nextDeliverySummary(prefs),
  };
}

const HOUR_FIELDS = ["preferred_delivery_hour", "quiet_hours_start", "quiet_hours_end"] as const;

function validateHour(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v)) return NaN;
  const i = Math.trunc(v);
  if (i < 0 || i > 23) return NaN;
  return i;
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
      { fields: "id,timezone,preferred_delivery_hour,quiet_hours_start,quiet_hours_end,brief_snoozed_until,skip_next_brief" }
    );
    return Response.json(shapeResponse(sub));
  } catch (err) {
    console.error("brief-preferences GET error:", err);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let body: {
    userId?: string;
    pbToken?: string;
    timezone?: string | null;
    preferred_delivery_hour?: number | null;
    quiet_hours_start?: number | null;
    quiet_hours_end?: number | null;
    brief_snoozed_until?: string | null;
    skip_next_brief?: boolean;
  };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken } = body;
  if (!userId || !pbToken) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  // Build patch + validate.
  const patch: Record<string, unknown> = {};
  if (body.timezone !== undefined) {
    if (body.timezone !== null && typeof body.timezone !== "string") {
      return Response.json({ error: "invalid_timezone" }, { status: 400 });
    }
    patch.timezone = body.timezone ?? "";
  }
  for (const field of HOUR_FIELDS) {
    if (body[field] !== undefined) {
      const v = validateHour(body[field]);
      if (Number.isNaN(v)) return Response.json({ error: `invalid_${field}` }, { status: 400 });
      patch[field] = v;
    }
  }
  if (body.brief_snoozed_until !== undefined) {
    patch.brief_snoozed_until = body.brief_snoozed_until ?? "";
  }
  if (body.skip_next_brief !== undefined) {
    if (typeof body.skip_next_brief !== "boolean") {
      return Response.json({ error: "invalid_skip_next_brief" }, { status: 400 });
    }
    patch.skip_next_brief = body.skip_next_brief;
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

    if (!sub) {
      const createRes = await fetch(`${url}/api/collections/subscriptions/records`, {
        method: "POST",
        headers: adminHeaders(token),
        body: JSON.stringify({ user: userId, plan: "starter", ...patch }),
      });
      if (!createRes.ok) return Response.json({ error: "create_failed" }, { status: 500 });
    } else {
      const res = await fetch(`${url}/api/collections/subscriptions/records/${sub.id}`, {
        method: "PATCH",
        headers: adminHeaders(token),
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const detail = await res.text();
        return Response.json({ error: "patch_failed", detail: detail.slice(0, 200) }, { status: 500 });
      }
    }

    const fresh = await pbFirst<SubRow>(
      "subscriptions",
      `(user='${pbEscape(userId)}')`,
      token,
      { fields: "id,timezone,preferred_delivery_hour,quiet_hours_start,quiet_hours_end,brief_snoozed_until,skip_next_brief" }
    );
    return Response.json(shapeResponse(fresh));
  } catch (err) {
    console.error("brief-preferences POST error:", err);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }
}
