/**
 * Idempotent setup for the `vault_voice_profile` collection (Phase 2 / Task #1).
 *
 * One row per user. Holds the deterministically-computed brand-voice
 * fingerprint that gets injected into every applicable agent's system prompt
 * so STAFFD's output sounds like the user, not like generic AI.
 *
 * Fields are pure metrics (no LLM) computed by `_lib/vault/voice.ts` from
 * the user's last-90-days corpus with A3 sample weighting (published > shared
 * > regenerated > kept > unsignaled).
 *
 * `voicePromptText` is the pre-rendered natural-language paragraph the
 * orchestrator + agent route consume. Pre-rendering means injection at
 * call-time is a single PB read with zero compute on the hot path.
 */

const REQUIRED_FIELDS = [
  { name: "user",                type: "text",   required: true  },
  { name: "avgSentenceLength",   type: "number", required: false },
  { name: "formalityScore",      type: "number", required: false },
  { name: "emojiFrequency",      type: "number", required: false },
  { name: "commonOpeners",       type: "json",   required: false },
  { name: "commonClosers",       type: "json",   required: false },
  { name: "bannedWords",         type: "json",   required: false },
  { name: "positivityScore",     type: "number", required: false },
  { name: "punctuationStyle",    type: "json",   required: false },
  { name: "documentCount",       type: "number", required: false },
  { name: "confidence",          type: "text",   required: false }, // low|medium|high
  { name: "voicePromptText",     type: "text",   required: false }, // pre-rendered NL paragraph
];

const INDEXES = [
  "CREATE UNIQUE INDEX idx_vvp_user ON vault_voice_profile (user)",
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

  const colRes = await fetch(`${pbUrl}/api/collections/vault_voice_profile`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "vault_voice_profile",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: INDEXES,
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create vault_voice_profile: ${detail}`);
    }
    return { action: "created" as const };
  }

  const col = (await colRes.json()) as {
    id: string;
    fields?: Array<{ name: string }>;
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
    throw new Error(`Failed to patch vault_voice_profile: ${detail}`);
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
    console.error("Voice profile setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
