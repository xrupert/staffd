/**
 * Idempotent setup for `push_subscriptions` (Phase 7 — PWA push).
 *
 * One row per (user, endpoint). The `endpoint` is unique per device/browser
 * so re-subscribing replaces the old row instead of duplicating. PB unique
 * index enforces this.
 *
 * Each row carries the cryptographic material `web-push` needs to encrypt
 * payloads end-to-end: `p256dh` (ECDH public key) + `auth` (auth secret).
 */

const REQUIRED_FIELDS = [
  { name: "user",       type: "text", required: true  },
  { name: "endpoint",   type: "text", required: true  },
  { name: "p256dh",     type: "text", required: true  },
  { name: "auth",       type: "text", required: true  },
  { name: "user_agent", type: "text", required: false },
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_push_endpoint ON push_subscriptions (endpoint)",
  "CREATE INDEX idx_push_user ON push_subscriptions (user)",
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

async function ensureCollection(pbUrl: string) {
  const token = await getAdminToken(pbUrl);
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const colRes = await fetch(`${pbUrl}/api/collections/push_subscriptions`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "push_subscriptions",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create push_subscriptions: ${detail}`);
    }
    return { action: "created" as const };
  }

  const col = (await colRes.json()) as { id: string; fields?: Array<{ name: string }> };
  const existing = new Set((col.fields ?? []).map((f) => f.name));
  const missing = REQUIRED_FIELDS.filter((f) => !existing.has(f.name));
  if (missing.length === 0) return { action: "noop" as const };

  const allFields = [...(col.fields ?? []), ...missing];
  const patchRes = await fetch(`${pbUrl}/api/collections/${col.id}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ fields: allFields }),
  });
  if (!patchRes.ok) {
    const detail = await patchRes.text();
    throw new Error(`Failed to patch push_subscriptions: ${detail}`);
  }
  return { action: "patched" as const, added: missing.map((f) => f.name) };
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const result = await ensureCollection(pbUrl.replace(/\/$/, ""));
    return Response.json({ ok: true, ...result });
  } catch (err) {
    console.error("push_subscriptions setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
