/**
 * Ensures the `businesses` PocketBase collection has all required fields.
 * Safe to call on every vault page load — idempotent.
 * Fetches the current schema and adds any missing fields without touching existing ones.
 */

const REQUIRED_FIELDS = [
  { name: "user",            type: "text", required: true },
  { name: "business_name",   type: "text", required: false },
  { name: "industry",        type: "text", required: false },
  { name: "description",     type: "text", required: false },
  { name: "target_audience", type: "text", required: false },
  { name: "website",         type: "text", required: false },
  { name: "phone",           type: "text", required: false },
  { name: "primary_email",   type: "text", required: false },
  { name: "address",         type: "text", required: false },
  { name: "secondary_email", type: "text", required: false },
  { name: "other_email",     type: "text", required: false },
  { name: "focus",           type: "text", required: false },
  { name: "situation",       type: "text", required: false },
  { name: "superpower",      type: "text", required: false },
  { name: "bottlenecks",     type: "json", required: false },
  { name: "magic_wand",      type: "text", required: false },
];

async function getAdminToken(pbUrl: string): Promise<string> {
  const res = await fetch(`${pbUrl}/api/collections/_superusers/auth-with-password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      identity: process.env.PB_ADMIN_EMAIL ?? "",
      password: process.env.PB_ADMIN_PASSWORD ?? "",
    }),
  });
  if (!res.ok) throw new Error("Admin auth failed");
  const { token } = (await res.json()) as { token: string };
  return token;
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    const token = await getAdminToken(pbUrl);
    const authHeader = { Authorization: token, "Content-Type": "application/json" };

    // Fetch current collection schema
    const colRes = await fetch(`${pbUrl}/api/collections/businesses`, {
      headers: { Authorization: token },
    });

    if (!colRes.ok) {
      // Collection doesn't exist yet — create it with all fields
      const createRes = await fetch(`${pbUrl}/api/collections`, {
        method: "POST",
        headers: authHeader,
        body: JSON.stringify({
          name: "businesses",
          type: "base",
          fields: REQUIRED_FIELDS,
        }),
      });
      if (!createRes.ok) {
        const err = await createRes.text();
        return Response.json({ error: "Failed to create collection", detail: err }, { status: 500 });
      }
      return Response.json({ ok: true, action: "created" });
    }

    // Collection exists — find which fields are missing
    const col = (await colRes.json()) as {
      id: string;
      fields?: Array<{ name: string; type: string }>;
      schema?: Array<{ name: string; type: string }>;
    };

    // PocketBase v0.22+ uses `fields`; older uses `schema`
    const existing = new Set((col.fields ?? col.schema ?? []).map((f) => f.name));
    const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));

    if (missing.length === 0) {
      return Response.json({ ok: true, action: "noop" });
    }

    // Patch collection to add missing fields (existing fields untouched)
    const allFields = [
      ...(col.fields ?? col.schema ?? []),
      ...missing,
    ];

    const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
      method: "PATCH",
      headers: authHeader,
      body: JSON.stringify({ fields: allFields }),
    });

    if (!patchRes.ok) {
      const err = await patchRes.text();
      return Response.json({ error: "Failed to patch collection", detail: err }, { status: 500 });
    }

    return Response.json({ ok: true, action: "patched", added: missing.map((f) => f.name) });
  } catch (err) {
    console.error("Businesses setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
