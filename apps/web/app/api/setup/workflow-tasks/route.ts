/**
 * POST /api/setup/workflow-tasks
 *
 * Creates the `workflows` and `workflow_tasks` PocketBase collections
 * if they don't already exist, then enforces USER_OWNED_RULES on both
 * per Standard #1 (Setup Route Discipline) / Decision 69.
 *
 * W71 — Task Bus substrate.
 */

import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

async function setupCollection(
  pbUrl: string,
  token: string,
  name: string,
  fields: Record<string, unknown>[],
): Promise<{ created: boolean; rules: unknown }> {
  const headers = { Authorization: token, "Content-Type": "application/json" };

  const checkRes = await fetch(`${pbUrl}/api/collections/${name}`, {
    headers: { Authorization: token },
  });

  if (checkRes.ok) {
    const rules = await ensureCollectionRulesWithFreshToken(name);
    return { created: false, rules: rules.status };
  }

  const createRes = await fetch(`${pbUrl}/api/collections`, {
    method: "POST",
    headers,
    body: JSON.stringify({ name, type: "base", fields }),
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    throw new Error(`Failed to create ${name}: ${err}`);
  }

  const rules = await ensureCollectionRulesWithFreshToken(name);
  return { created: true, rules: rules.status };
}

export async function POST() {
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  const adminEmail = process.env.PB_ADMIN_EMAIL;
  const adminPassword = process.env.PB_ADMIN_PASSWORD;

  if (!pbUrl || !adminEmail || !adminPassword) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  try {
    const authRes = await fetch(
      `${pbUrl}/api/collections/_superusers/auth-with-password`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: adminEmail, password: adminPassword }),
      },
    );
    if (!authRes.ok) {
      return Response.json({ error: "Admin auth failed" }, { status: 500 });
    }
    const { token } = (await authRes.json()) as { token: string };

    const workflowsResult = await setupCollection(pbUrl, token, "workflows", [
      { name: "user",     type: "text", required: true },
      { name: "name",     type: "text", required: false },
      { name: "status",   type: "text", required: false },
    ]);

    const tasksResult = await setupCollection(pbUrl, token, "workflow_tasks", [
      { name: "workflow_id",            type: "text",   required: true },
      { name: "user",                    type: "text",   required: true },
      { name: "specialist_id",          type: "text",   required: false },
      { name: "department_id",          type: "text",   required: true },
      { name: "input_payload",          type: "json",   required: true },
      { name: "output_payload",         type: "json",   required: false },
      { name: "status",                 type: "text",   required: false },
      { name: "depends_on",             type: "json",   required: false },
      { name: "retry_count",            type: "number", required: false },
      { name: "error",                  type: "text",   required: false },
      { name: "started_at",             type: "text",   required: false },
      { name: "completed_at",           type: "text",   required: false },
      { name: "cost_estimate_tokens",   type: "number", required: false },
      { name: "cost_actual_tokens",     type: "number", required: false },
    ]);

    return Response.json({
      ok: true,
      workflows: workflowsResult,
      workflow_tasks: tasksResult,
    });
  } catch (err) {
    console.error("workflow-tasks setup error:", err);
    return Response.json({ error: "Setup failed" }, { status: 500 });
  }
}
