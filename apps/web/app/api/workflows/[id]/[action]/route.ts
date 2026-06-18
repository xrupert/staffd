/**
 * POST /api/workflows/<id>/approve | /cancel (W95.6.x) — the review step.
 *
 * approve: a review-paused workflow → enqueue the second (send) task, which
 *   reads the (optionally edited) draft_output. Status awaiting_review → running.
 * cancel: awaiting_review → cancelled; nothing further fires.
 *
 * Owner-only (whoAmI + user match). The second task is built from the workflow's
 * recipe_id + its first (draft) task's payload — the send workers read the
 * reviewed draft_output from the parent workflow, not the task payload.
 */

import { adminHeaders, getAdminToken, pbUrl } from "../../../_lib/pb";
import { whoAmI } from "../../../_lib/integrations/identity";
import { recordDecision } from "../../../_lib/vault/outcomes";

const SECOND_WORKER: Record<string, string> = { reply_to_ticket: "chatwoot_send_worker", send_for_signature: "docuseal_send_worker" };

export async function POST(req: Request, { params }: { params: Promise<{ id: string; action: string }> }) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id, action } = await params;
  if (action !== "approve" && action !== "cancel") return Response.json({ error: "unknown_action" }, { status: 404 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const wfRes = await fetch(`${pb}/api/collections/workflows/records/${id}`, { headers: { Authorization: token } });
  if (!wfRes.ok) return Response.json({ error: "not_found" }, { status: 404 });
  const wf = (await wfRes.json()) as { id: string; user?: string; status?: string; recipe_id?: string };
  if (wf.user !== me.id) return Response.json({ error: "not_found" }, { status: 404 }); // own workflows only
  if (wf.status !== "awaiting_review") return Response.json({ error: "not_awaiting_review", status: wf.status }, { status: 409 });

  if (action === "cancel") {
    await fetch(`${pb}/api/collections/workflows/records/${id}`, { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ status: "cancelled", completed_at: new Date().toISOString() }) });
    void recordDecision({ userId: me.id, decision_kind: "delegate_workflow_cancelled", title: `Cancelled ${wf.recipe_id || "draft"}`, source_kind: "manual", source_id: id });
    return Response.json({ ok: true });
  }

  // approve
  let body: { edited_draft?: string } = {};
  try { body = await req.json(); } catch { /* no body is fine */ }
  if (typeof body.edited_draft === "string" && body.edited_draft.trim()) {
    await fetch(`${pb}/api/collections/workflows/records/${id}`, { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ draft_output: body.edited_draft }) });
  }
  await fetch(`${pb}/api/collections/workflows/records/${id}`, { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ status: "running" }) });

  const worker = SECOND_WORKER[wf.recipe_id ?? ""];
  if (!worker) return Response.json({ error: "no_second_step", recipe: wf.recipe_id }, { status: 400 });

  // Build the send-task payload from the first (draft) task.
  const tRes = await fetch(`${pb}/api/collections/workflow_tasks/records?filter=${encodeURIComponent(`(workflow_id = "${id}")`)}&perPage=1&sort=created`, { headers: { Authorization: token } });
  const first = (((await tRes.json()) as { items?: { input_payload?: Record<string, unknown> }[] }).items ?? [])[0];
  const fp = (first?.input_payload ?? {}) as Record<string, unknown>;
  const payload = wf.recipe_id === "reply_to_ticket"
    ? { conversation_identifier: fp.conversation_identifier ?? "" }
    : { document_identifier: fp.document_identifier ?? "", signer_email: fp.signer_email ?? "", signer_name: fp.signer_name ?? "" };

  const mk = await fetch(`${pb}/api/collections/workflow_tasks/records`, {
    method: "POST", headers: adminHeaders(token),
    body: JSON.stringify({ workflow_id: id, user: me.id, specialist_id: worker, department_id: "system", input_payload: payload, output_payload: null, status: "pending", depends_on: [], retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0 }),
  });
  const nextTaskId = mk.ok ? ((await mk.json()) as { id: string }).id : "";
  return Response.json({ ok: true, next_task_id: nextTaskId });
}
