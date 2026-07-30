/**
 * Idempotent setup: creates/migrates the `scheduled_content` PocketBase
 * collection. Called by the calendar page on first load.
 *
 * PR-Loop-V4 (#8) adds:
 *   kind       (text) — "content" (default) | "workflow_goal" (recurring
 *                        staff: planner → critic → review-gated workflow)
 *   recurrence (text) — "" | "weekly" | "monthly"
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const DESIRED_FIELDS = [
  { name: "user",           type: "text",   required: true },
  { name: "department",     type: "text",   required: true },
  { name: "agent_id",       type: "text",   required: false },
  { name: "agent_name",     type: "text",   required: false },
  { name: "task",           type: "text",   required: true },
  { name: "scheduled_date", type: "text",   required: true },
  { name: "status",         type: "text",   required: false },
  { name: "document_id",    type: "text",   required: false },
  // PR-Loop-V4 (#8)
  { name: "kind",           type: "text",   required: false },
  { name: "recurrence",     type: "text",   required: false },
];

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    // Auth as superuser
    const authRes = await fetch(
      `${pbUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
      }
    );
    if (!authRes.ok) {
      return Response.json({ error: "Admin auth failed" }, { status: 500 });
    }
    const { token } = (await authRes.json()) as { token: string };
    const headers = { Authorization: token, "Content-Type": "application/json" };

    // Check if collection already exists — if so, patch any missing fields
    // (PR-Loop-V4 added kind + recurrence to a collection that predates them).
    const checkRes = await fetch(
      `${pbUrl}/api/collections/scheduled_content`,
      { headers: { Authorization: token } }
    );
    if (checkRes.ok) {
      const col = (await checkRes.json()) as { id: string; fields?: Array<{ name: string }> };
      const existing = new Set((col.fields ?? []).map((f) => f.name));
      const missing = DESIRED_FIELDS.filter((f) => !existing.has(f.name));
      if (missing.length > 0) {
        const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ fields: [...(col.fields ?? []), ...missing] }),
        });
        if (!patchRes.ok) {
          return Response.json({ error: "Failed to add fields", detail: await patchRes.text() }, { status: 500 });
        }
      }
      // Decision 69 — enforce row rules from the canonical registry.
      const rules = await ensureCollectionRulesWithFreshToken("scheduled_content");
      return Response.json({ ok: true, created: false, added: missing.map((f) => f.name), rules: rules.status });
    }

    // Create the collection
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "scheduled_content",
        type: "base",
        fields: DESIRED_FIELDS,
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.error("Collection create error:", err);
      return Response.json({ error: "Failed to create collection", detail: err }, { status: 500 });
    }

    // Decision 69 — enforce row rules from the canonical registry.
    const rules = await ensureCollectionRulesWithFreshToken("scheduled_content");
    return Response.json({ ok: true, created: true, rules: rules.status });
  } catch (err) {
    console.error("Calendar setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
