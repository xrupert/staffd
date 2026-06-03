/**
 * One-time setup: creates / migrates the `subscriptions` PocketBase collection.
 * Called automatically from the dashboard on first load. Safe to re-run.
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const DESIRED_FIELDS = [
  { name: "user",                 type: "text",   required: true  },
  { name: "plan",                 type: "text",   required: false }, // starter|growth|pro|agency
  { name: "trial_runs",           type: "json",   required: false }, // { dept: count }
  { name: "stripe_customer",      type: "text",   required: false },
  { name: "stripe_sub_id",        type: "text",   required: false },
  { name: "active_until",         type: "text",   required: false }, // ISO date
  { name: "unlocked_departments", type: "json",   required: false }, // string[]
  { name: "dept_addon_subs",      type: "json",   required: false }, // { "design": "sub_xxx", ... }
  { name: "image_credits_used",   type: "number", required: false }, // resets monthly
  { name: "video_credits_used",   type: "number", required: false }, // resets monthly
  { name: "image_credits_topup",  type: "number", required: false }, // never resets
  { name: "video_credits_topup",  type: "number", required: false }, // never resets
  { name: "credits_reset_at",     type: "text",   required: false }, // ISO YYYY-MM-01

  // X2 — cross-instance daily generation rate limit (replaces in-memory Map)
  { name: "rate_limit_day",       type: "text",   required: false }, // YYYY-MM-DD (UTC)
  { name: "rate_limit_count",     type: "number", required: false }, // generations today

  // Phase 4 — CEO add-on subscription id (when set, "ceo" dept is unlocked
  // regardless of plan); generic agent credits balance topped up via Stripe
  // one-time SKUs (Phase 5 will refine deduction rules).
  { name: "ceo_addon_sub",        type: "text",   required: false },
  { name: "agent_credits_topup",  type: "number", required: false },

  // Phase 8 — industry packs. `industry_packs` is the active pack ids
  // array surfaced to retrieval / dept default agent resolution.
  // `pack_addon_subs` mirrors the Phase 4 `dept_addon_subs` shape so the
  // Stripe webhook can clean up cleanly when a pack sub is cancelled.
  { name: "industry_packs",       type: "json",   required: false }, // string[] of pack ids
  { name: "pack_addon_subs",      type: "json",   required: false }, // { pack_id: stripe_sub_id }

  // Phase 9 — autonomy controls. Default behavior (absent field) is "on".
  // `autopilot_paused_until` (ISO datetime) gives users a Snooze button
  // without permanently disabling. The Morning Brief worker honors both.
  { name: "autopilot_mode",         type: "text", required: false }, // on | off | (null = on)
  { name: "autopilot_paused_until", type: "text", required: false }, // ISO datetime

  // Phase 26 — Morning Brief customization + Quiet Hours.
  // `timezone` is an IANA string ("America/New_York"). When set with a
  // `preferred_delivery_hour`, the brief-push-dispatcher delivers the brief
  // at that local hour (skipping any time inside the quiet window). When
  // unset, the legacy "push immediately after generation" path runs.
  // `skip_next_brief` auto-clears after the next worker tick — "skip just
  // tomorrow" UX. `brief_snoozed_until` matches the autopilot pause shape.
  { name: "timezone",                type: "text",   required: false }, // IANA
  { name: "preferred_delivery_hour", type: "number", required: false }, // 0-23 local
  { name: "quiet_hours_start",       type: "number", required: false }, // 0-23 local
  { name: "quiet_hours_end",         type: "number", required: false }, // 0-23 local (wraparound supported)
  { name: "brief_snoozed_until",     type: "text",   required: false }, // ISO datetime
  { name: "skip_next_brief",         type: "bool",   required: false },
];

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    const authRes = await fetch(
      `${pbUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
      }
    );
    if (!authRes.ok) return Response.json({ error: "Admin auth failed" }, { status: 500 });
    const { token } = (await authRes.json()) as { token: string };
    const headers = { Authorization: token, "Content-Type": "application/json" };

    const checkRes = await fetch(`${pbUrl}/api/collections/subscriptions`, {
      headers: { Authorization: token },
    });

    if (checkRes.ok) {
      const colData = (await checkRes.json()) as {
        id: string;
        fields?: Array<{ name: string }>;
      };
      const existingFieldNames = new Set((colData.fields ?? []).map((f) => f.name));
      const missing = DESIRED_FIELDS.filter((f) => !existingFieldNames.has(f.name));

      if (missing.length === 0) {
        // Decision 69 — enforce row rules from the canonical registry.
        const rules = await ensureCollectionRulesWithFreshToken("subscriptions");
        return Response.json({ ok: true, created: false, patched: [], rules: rules.status });
      }

      const allFields = [...(colData.fields ?? []), ...missing];
      const patchRes = await fetch(`${pbUrl}/api/collections/${colData.id}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ fields: allFields }),
      });
      if (!patchRes.ok) {
        const detail = await patchRes.text();
        return Response.json({ error: "Failed to patch", detail }, { status: 500 });
      }
      // Decision 69 — enforce row rules from the canonical registry.
      const rules = await ensureCollectionRulesWithFreshToken("subscriptions");
      return Response.json({ ok: true, created: false, patched: missing.map((f) => f.name), rules: rules.status });
    }

    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "subscriptions", type: "base", fields: DESIRED_FIELDS }),
    });

    if (!createRes.ok) {
      const detail = await createRes.text();
      return Response.json({ error: "Failed to create collection", detail }, { status: 500 });
    }

    // Decision 69 — enforce row rules from the canonical registry.
    const rules = await ensureCollectionRulesWithFreshToken("subscriptions");
    return Response.json({ ok: true, created: true, rules: rules.status });
  } catch (err) {
    console.error("Subscriptions setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
