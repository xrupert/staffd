/**
 * One-time setup: creates the `subscriptions` PocketBase collection.
 * Called automatically from the dashboard on first load.
 */

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

    // Check if already exists
    const checkRes = await fetch(`${pbUrl}/api/collections/subscriptions`, { headers: { Authorization: token } });
    if (checkRes.ok) {
      // Collection exists — patch schema to add any missing fields
      const colData = (await checkRes.json()) as { fields?: Array<{ name: string }> };
      const existingFieldNames = new Set((colData.fields ?? []).map((f) => f.name));
      const desiredFields = [
        { name: "unlocked_departments", type: "json",   required: false },
        { name: "dept_addon_subs",      type: "json",   required: false }, // { "design": "sub_xxx", ... }
        { name: "image_credits_used",   type: "number", required: false }, // resets monthly
        { name: "video_credits_used",   type: "number", required: false }, // resets monthly
        { name: "image_credits_topup",  type: "number", required: false }, // never resets
        { name: "video_credits_topup",  type: "number", required: false }, // never resets
        { name: "credits_reset_at",     type: "text",   required: false }, // ISO YYYY-MM-01 of current month
      ];
      const missing = desiredFields.filter((f) => !existingFieldNames.has(f.name));
      if (missing.length > 0) {
        const existing = colData as Record<string, unknown>;
        const fields = (existing.fields as unknown[]) ?? [];
        await fetch(`${pbUrl}/api/collections/subscriptions`, {
          method: "PATCH",
          headers,
          body: JSON.stringify({ fields: [...fields, ...missing] }),
        });
      }
      return Response.json({ ok: true, created: false, patched: missing.map((f) => f.name) });
    }

    // Create collection
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "subscriptions",
        type: "base",
        fields: [
          { name: "user",            type: "text", required: true },
          { name: "plan",            type: "text", required: false }, // starter|growth|pro|agency
          { name: "trial_runs",      type: "json", required: false }, // { dept: count }
          { name: "stripe_customer", type: "text", required: false },
          { name: "stripe_sub_id",   type: "text", required: false },
          { name: "active_until",         type: "text",   required: false }, // ISO date
          { name: "unlocked_departments", type: "json",   required: false }, // string[]
          { name: "dept_addon_subs",      type: "json",   required: false }, // { "design": "sub_xxx", ... }
          { name: "image_credits_used",   type: "number", required: false }, // resets monthly
          { name: "video_credits_used",   type: "number", required: false }, // resets monthly
          { name: "image_credits_topup",  type: "number", required: false }, // never resets
          { name: "video_credits_topup",  type: "number", required: false }, // never resets
          { name: "credits_reset_at",     type: "text",   required: false }, // ISO YYYY-MM-01
        ],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      return Response.json({ error: "Failed to create collection", detail: err }, { status: 500 });
    }

    return Response.json({ ok: true, created: true });
  } catch (err) {
    console.error("Subscriptions setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
