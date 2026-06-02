/**
 * Idempotent setup for the `conversations` collection.
 *
 * Every turn in a department conversation is appended here so threads survive
 * sessions and so the Vault Phase 2 embedding pipeline has a complete record
 * to index. Spec §13 / §17 #8 / §19 Foundation 2.
 *
 * One row per turn: a user message and the assistant's reply each get their
 * own row, linked by `thread_id`. If a document is the artifact produced by
 * that turn, `document_id` joins them.
 */

const REQUIRED_FIELDS = [
  { name: "user",        type: "text", required: true  },
  { name: "client",      type: "text", required: false }, // Agency: scope to a client
  { name: "thread_id",   type: "text", required: true  }, // groups turns into a thread
  { name: "department",  type: "text", required: false },
  { name: "agent_id",    type: "text", required: false }, // packages/agents id when known
  { name: "role",        type: "text", required: true  }, // user|assistant|system
  { name: "content",     type: "text", required: true  },
  { name: "document_id", type: "text", required: false }, // FK to documents.id when this turn produced an artifact
  { name: "tokens",      type: "number", required: false }, // approx input/output tokens for this turn
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

  const colRes = await fetch(`${pbUrl}/api/collections/conversations`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "conversations",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: [
          // PB rejects (*, created) at create-time — drop them; default sort works.
          "CREATE INDEX idx_conv_thread_id ON conversations (thread_id)",
          "CREATE INDEX idx_conv_user_dept ON conversations (user, department)",
        ],
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create conversations: ${detail}`);
    }
    return { action: "created" as const };
  }

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string; type: string }>;
  };
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
    throw new Error(`Failed to patch conversations: ${detail}`);
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
    console.error("Conversations setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
