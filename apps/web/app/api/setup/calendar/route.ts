/**
 * One-time setup: creates the `scheduled_content` PocketBase collection
 * if it doesn't already exist. Called by the calendar page on first load.
 */

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

    // Check if collection already exists
    const checkRes = await fetch(
      `${pbUrl}/api/collections/scheduled_content`,
      { headers: { Authorization: token } }
    );
    if (checkRes.ok) {
      return Response.json({ ok: true, created: false });
    }

    // Create the collection
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "scheduled_content",
        type: "base",
        fields: [
          { name: "user",           type: "text",   required: true },
          { name: "department",     type: "text",   required: true },
          { name: "agent_id",       type: "text",   required: false },
          { name: "agent_name",     type: "text",   required: false },
          { name: "task",           type: "text",   required: true },
          { name: "scheduled_date", type: "text",   required: true },
          { name: "status",         type: "text",   required: false },
          { name: "document_id",    type: "text",   required: false },
        ],
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.text();
      console.error("Collection create error:", err);
      return Response.json({ error: "Failed to create collection", detail: err }, { status: 500 });
    }

    return Response.json({ ok: true, created: true });
  } catch (err) {
    console.error("Calendar setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
