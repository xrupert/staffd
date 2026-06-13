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

type EnqueueBody = {
  userId: string;
  departmentId: string;
  inputPayload: Record<string, unknown>;
  workflowId?: string;
  specialistId?: string;
  dependsOn?: string[];
  estimateTokens?: number;
};

export async function POST(req: Request) {
  let body: EnqueueBody;
  try {
    body = (await req.json()) as EnqueueBody;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { userId, departmentId, inputPayload } = body;
  if (!userId || !departmentId || !inputPayload) {
    return Response.json(
      { error: "userId, departmentId, and inputPayload are required" },
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
    user_id:              userId,
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
