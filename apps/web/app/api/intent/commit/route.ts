/**
 * POST /api/intent/commit — the single commit path for confirmed intents (W95.1).
 *
 * Body: { intent_type, fields, source: "voice" | "text" }. Every Model B3
 * intent funnels through here. For create_contact:
 *   1. write STAFFD-native `contacts` row (source of truth)
 *   2. mirror to the operator-shared Twenty via TwentyClient (tenant-tagged)
 *   3. Vault enrichment — recordDecision(user_confirmed_fact)
 *   4. audit row (super_admin_usage_log shape, operation_type "intent_commit")
 *
 * Vendor-mirror failure does NOT fail the request: the native row persists
 * with twenty_mirror_status="error" for later retry. Authed user; USER_OWNED
 * rules isolate the contact.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { TwentyClient } from "../../_lib/integrations/twenty/client";
import { recordDecision } from "../../_lib/vault/outcomes";

type Body = { intent_type?: string; fields?: Record<string, string>; source?: "voice" | "text" };

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Body;
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  if (body.intent_type !== "create_contact") {
    return Response.json({ error: "unsupported_intent" }, { status: 400 });
  }
  const fields = body.fields ?? {};
  const name = (fields.name ?? "").trim();
  if (!name) return Response.json({ error: "name_required" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  // 1. STAFFD-native row (source of truth) — mirror pending.
  const createRes = await fetch(`${pb}/api/collections/contacts/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: me.id,
      name,
      email: fields.email ?? "",
      phone: fields.phone ?? "",
      context: fields.context ?? "",
      twenty_mirror_status: "pending",
    }),
  });
  if (!createRes.ok) {
    return Response.json({ error: "save_failed", detail: (await createRes.text().catch(() => "")).slice(0, 200) }, { status: 502 });
  }
  const record = (await createRes.json()) as { id: string };

  // 2. Mirror to the operator-shared Twenty (tenant-tagged). Best-effort.
  let twentyId: string | null = null;
  let mirrorStatus: "synced" | "error" = "error";
  try {
    if (TwentyClient.configured) {
      twentyId = await TwentyClient.forCustomer(me.id).createPerson({ name, email: fields.email, phone: fields.phone });
      mirrorStatus = twentyId ? "synced" : "error";
    }
  } catch {
    mirrorStatus = "error";
  }
  // persist mirror outcome (non-blocking)
  void fetch(`${pb}/api/collections/contacts/records/${record.id}`, {
    method: "PATCH",
    headers: adminHeaders(token),
    body: JSON.stringify({ twenty_record_id: twentyId ?? "", twenty_mirror_status: mirrorStatus, last_mirror_attempt: new Date().toISOString() }),
  });

  // W95.2 — on mirror failure, enqueue a W71 task so the retry worker (the
  // workflow-drain extension) re-attempts the vendor mirror. No silent drift.
  if (mirrorStatus === "error") {
    void fetch(`${pb}/api/collections/workflow_tasks/records`, {
      method: "POST",
      headers: adminHeaders(token),
      body: JSON.stringify({
        workflow_id: "",
        user: me.id,
        specialist_id: "mirror_retry_worker", // synthetic — handled in workflow-drain, not a real specialist
        department_id: "system",
        input_payload: { vendor: "twenty", record_id: record.id, fields: { name, email: fields.email ?? "", phone: fields.phone ?? "" } },
        output_payload: null,
        status: "pending",
        depends_on: [],
        retry_count: 0,
        error: "",
        started_at: "",
        completed_at: "",
        cost_estimate_tokens: 0,
        cost_actual_tokens: 0,
      }),
    }).catch(() => {});
  }

  // 3. Vault enrichment — every confirmed action sharpens the staff.
  void recordDecision({
    userId: me.id,
    decision_kind: "user_confirmed_fact",
    title: `Added contact "${name}"`,
    source_kind: "manual", // conversational confirm-to-commit (not a vendor-originated outcome)
    source_id: record.id,
  });

  // 4. Audit row (best-effort).
  void fetch(`${pb}/api/collections/super_admin_usage_log/records`, {
    method: "POST",
    headers: adminHeaders(token),
    body: JSON.stringify({
      user: me.id,
      operation_type: "intent_commit",
      operation_detail: `create_contact (${body.source ?? "text"})`,
      parameters: JSON.stringify({ intent_type: "create_contact" }),
    }),
  }).catch(() => {});

  return Response.json({ ok: true, record_id: record.id, twenty_record_id: twentyId, twenty_mirror_status: mirrorStatus });
}
