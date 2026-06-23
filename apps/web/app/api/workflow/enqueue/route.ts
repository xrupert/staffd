/**
 * POST /api/workflow/enqueue
 *
 * Internal — creates a workflow_task with status="pending".
 * Called by other API routes or the CommandCenter to queue
 * background agent work.
 *
 * W71 — Task Bus substrate.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

type EnqueueBody = {
  departmentId: string;
  inputPayload: Record<string, unknown>;
  workflowId?: string;
  specialistId?: string;
  dependsOn?: string[];
  estimateTokens?: number;
};

export async function POST(req: Request) {
  // h6d — tasks are enqueued for the authenticated caller; the admin token below
  // bypasses row rules, so a body `userId` would let anyone queue work (and bill
  // tokens) against another user.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  let body: EnqueueBody;
  try {
    body = (await req.json()) as EnqueueBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { departmentId, inputPayload } = body;
  if (!departmentId || !inputPayload) {
    return Response.json(
      { error: "departmentId and inputPayload are required" },
      { status: 400 },
    );
  }

  const pb = pbUrl();
  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const taskRecord = {
    workflow_id:          body.workflowId ?? "",
    user:                 userId,
    specialist_id:        body.specialistId ?? "",
    department_id:        departmentId,
    input_payload:        inputPayload,
    output_payload:       null,
    status:               "pending",
    depends_on:           body.dependsOn ?? [],
    retry_count:          0,
    error:                "",
    started_at:           "",
    completed_at:         "",
    cost_estimate_tokens: body.estimateTokens ?? 0,
    cost_actual_tokens:   0,
  };

  const res = await fetch(`${pb}/api/collections/workflow_tasks/records`, {
    method: "POST",
    headers: { Authorization: adminToken, "Content-Type": "application/json" },
    body: JSON.stringify(taskRecord),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("enqueue create error:", err);
    return Response.json({ error: "Failed to create task" }, { status: 500 });
  }

  const created = (await res.json()) as { id: string };
  return Response.json({ ok: true, taskId: created.id });
}
