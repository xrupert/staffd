/**
 * Idempotent setup for `conversation_threads` (Phase 25 — Thread Picker UI).
 *
 * One row per (user, thread_id). Holds the thread-level metadata that
 * doesn't belong on every individual conversation turn — display name +
 * archived flag. `last_active` is derived at query time from `conversations`
 * to avoid a write per turn.
 *
 * Unique index on `thread_id` enforces one metadata row per thread.
 */

const REQUIRED_FIELDS = [
  { name: "user",      type: "text", required: true  },
  { name: "thread_id", type: "text", required: true  },
  { name: "name",      type: "text", required: false }, // derived from first turn; user-renameable
  { name: "archived",  type: "bool", required: false },
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_ct_thread ON conversation_threads (thread_id)",
  "CREATE INDEX idx_ct_user ON conversation_threads (user)",
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

  const colRes = await fetch(`${pbUrl}/api/collections/conversation_threads`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "conversation_threads",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create conversation_threads: ${detail}`);
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
    throw new Error(`Failed to patch conversation_threads: ${detail}`);
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
    console.error("conversation_threads setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
