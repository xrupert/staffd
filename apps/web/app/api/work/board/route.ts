/**
 * GET /api/work/board — the Staff Work Board feed.
 *
 * Session-authed; aggregates the caller's scheduled_content, workflows and
 * generation_jobs into four kanban columns (see _lib/work/board.ts for the
 * pure mapping). Each source read is fail-open: a collection that errors
 * contributes nothing rather than failing the whole board.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { bucketize, type ScheduledRow, type WorkflowRow, type GenJobRow } from "../../_lib/work/board";

async function listRows<T>(pb: string, token: string, collection: string, filter: string, perPage: number, fields: string): Promise<T[]> {
  try {
    const res = await fetch(
      `${pb}/api/collections/${collection}/records?filter=${encodeURIComponent(filter)}&perPage=${perPage}&sort=-created&fields=${fields}`,
      { headers: adminHeaders(token) },
    );
    if (!res.ok) return [];
    return (((await res.json()) as { items?: T[] }).items ?? []);
  } catch {
    return [];
  }
}

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const pb = pbUrl();
  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "not_configured" }, { status: 503 });
  }

  const u = pbEscape(me.id);
  const [scheduled, workflows, jobs] = await Promise.all([
    listRows<ScheduledRow>(pb, token, "scheduled_content", `(user='${u}')`, 100,
      "id,task,department,agent_name,scheduled_date,status,kind,created"),
    listRows<WorkflowRow>(pb, token, "workflows", `(user='${u}')`, 50,
      "id,goal,status,created,recipe_id"),
    listRows<GenJobRow>(pb, token, "generation_jobs", `(user='${u}')`, 50,
      "id,kind,prompt,status,created,output_url,prediction_id,tier"),
  ]);

  return Response.json({ ok: true, board: bucketize({ scheduled, workflows, jobs }) });
}
