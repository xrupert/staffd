/**
 * POST /api/campaign/schedule  (P3 — the campaign runner)
 *
 * Owner-authed. Body: { plan, cadence?, startDate?, tier? }. Takes a
 * multi-video strategy deliverable, extracts the AI-producible scripts
 * (camera-facing ones are the owner's to film and are skipped with an
 * honest count), and schedules one `video_production` calendar item per
 * video on the posting cadence (default Mon/Wed/Fri). The daily
 * scheduled worker produces each through the Studio on its date; the
 * bell + review flow handle delivery. Nothing is rendered at schedule
 * time — the calendar is the commitment, production happens on cadence.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { extractVideoScripts } from "../../../lib/video-scripts";

const DEFAULT_CADENCE = [1, 3, 5]; // Mon/Wed/Fri (UTC day-of-week)

export function nextCadenceDates(count: number, cadence: number[], from: Date): string[] {
  const days = [...cadence].sort((a, b) => a - b);
  const dates: string[] = [];
  const cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (dates.length < count) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    if (days.includes(cursor.getUTCDay())) dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { plan?: unknown; startDate?: unknown; tier?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const plan = String(body.plan ?? "").trim();
  if (plan.length < 40) return Response.json({ error: "plan_required" }, { status: 400 });
  const tier = String(body.tier ?? "pro");

  const scripts = extractVideoScripts(plan);
  if (scripts.length < 2) {
    return Response.json({ error: "not_a_campaign", detail: "Fewer than 2 scripted videos found." }, { status: 422 });
  }
  const producible = scripts.filter((s) => s.producible);
  const yours = scripts.length - producible.length;
  if (producible.length === 0) {
    return Response.json({ error: "all_camera_facing", detail: "Every video needs you on camera — scripts are ready to film." }, { status: 422 });
  }

  const from = typeof body.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.startDate)
    ? new Date(`${body.startDate}T00:00:00Z`)
    : new Date();
  const dates = nextCadenceDates(producible.length, DEFAULT_CADENCE, from);

  const pb = pbUrl();
  const token = await getAdminToken();
  const headers = adminHeaders(token);
  const created: Array<{ title: string; date: string }> = [];
  for (let i = 0; i < producible.length; i++) {
    const sc = producible[i]!;
    const res = await fetch(`${pb}/api/collections/scheduled_content/records`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        user: me.id,
        department: "marketing",
        agent_name: "Studio",
        task: sc.script,
        scheduled_date: dates[i],
        status: "planned",
        kind: "video_production",
        recurrence: "",
      }),
    });
    if (!res.ok) {
      return Response.json({ error: "schedule_write_failed", created: created.length }, { status: 500 });
    }
    created.push({ title: sc.title, date: dates[i]! });
  }

  return Response.json({
    ok: true,
    scheduled: created,
    tier,
    camera_facing_skipped: yours,
  });
}
