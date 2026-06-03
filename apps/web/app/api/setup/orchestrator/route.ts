/**
 * Idempotent setup for the `orchestrator_decisions` collection.
 *
 * Every call to /api/orchestrator writes one row here so we can audit routing,
 * latency, fallback rate, and vault-cost flags. Spec §17 #1 / §19 Foundation 1.
 *
 * Safe to re-run — adds missing fields, never overwrites or deletes.
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const REQUIRED_FIELDS = [
  { name: "user",               type: "text",   required: false },
  { name: "intent",             type: "text",   required: true  }, // route|handoff|brief|synthesize
  { name: "decision_json",      type: "json",   required: false },
  { name: "latency_ms",         type: "number", required: false },
  { name: "attempts",           type: "number", required: false },
  { name: "tokens_in",          type: "number", required: false },
  { name: "tokens_out",         type: "number", required: false },
  { name: "fallback",           type: "text",   required: false }, // null|deadline_exceeded|llm_budget_exceeded|upstream_error
  { name: "vault_cost_flag",    type: "text",   required: false }, // ok|trimmed|degraded
  { name: "model",              type: "text",   required: false },
  { name: "estimated_cost_usd", type: "number", required: false }, // Phase 3 cost logging
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

  const colRes = await fetch(`${pbUrl}/api/collections/orchestrator_decisions`, {
    headers: { Authorization: token },
  });

  if (!colRes.ok) {
    const createRes = await fetch(`${pbUrl}/api/collections`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        name: "orchestrator_decisions",
        type: "base",
        fields: REQUIRED_FIELDS,
        indexes: [
          // PB rejects (user, created) at create-time — drop it; default sort works.
          // ORDER BY created on this collection runs without an explicit index at our volume.
        ],
      }),
    });
    if (!createRes.ok) {
      const detail = await createRes.text();
      throw new Error(`Failed to create orchestrator_decisions: ${detail}`);
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
    throw new Error(`Failed to patch orchestrator_decisions: ${detail}`);
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
    // Decision 69 — enforce row rules from the canonical registry.
    const rules = await ensureCollectionRulesWithFreshToken("orchestrator_decisions");
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error("Orchestrator setup error:", err);
    const msg = err instanceof Error ? err.message : "Setup failed";
    return Response.json({ error: "Setup failed", detail: msg }, { status: 500 });
  }
}

export const GET = POST;
