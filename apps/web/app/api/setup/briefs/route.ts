/**
 * Idempotent setup for `vault_briefs` (Phase 6 — Morning Brief).
 *
 * One row per (user, date). Stores the compiled Morning Brief — a list of
 * per-department sections the user reviews each morning. Each section
 * carries its own status (pending / approved / dismissed) so the user can
 * triage individual items without affecting the rest.
 */

const REQUIRED_FIELDS = [
  { name: "user",         type: "text", required: true  },
  { name: "date",         type: "text", required: true  }, // YYYY-MM-DD
  { name: "sections",     type: "json", required: false }, // Array<BriefSection>
  { name: "status",       type: "text", required: false }, // pending | reviewed | dismissed
  { name: "read_at",      type: "text", required: false }, // ISO when first opened
  { name: "generated_at", type: "text", required: false }, // ISO when worker compiled it
  // Phase 26 — set by the dispatcher (or the morning-brief worker's legacy
  // immediate push path) so the brief is never double-delivered.
  { name: "pushed_at",    type: "text", required: false }, // ISO when push fired
];

const INDEXES = [
  // One brief per user per day — enforces idempotency on the cron path.
  "CREATE UNIQUE INDEX idx_vb_user_date ON vault_briefs (user, date)",
  "CREATE INDEX idx_vb_user_created ON vault_briefs (user, created)",
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

  const colRes = await fetch(`${pbUrl}/api/collections/vault_briefs`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "vault_briefs",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create vault_briefs: ${detail}`);
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
    throw new Error(`Failed to patch vault_briefs: ${detail}`);
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
    console.error("Briefs setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
