/**
 * GET /api/conversations/list?userId=...&limit=20
 *
 * Returns the user's recent conversation threads — one entry per unique
 * `thread_id` with the latest message preview + timestamp. Used by the
 * Command Center's thread-resume UX (Phase 9).
 *
 * Auth: PB session via Authorization header. Ownership-verified.
 */

import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";

type ThreadMetaRow = {
  thread_id: string;
  name?: string;
  archived?: boolean;
};

async function fetchThreadMeta(userId: string, token: string): Promise<Map<string, ThreadMetaRow>> {
  const map = new Map<string, ThreadMetaRow>();
  try {
    const url = pbUrl();
    const filter = `(user='${pbEscape(userId)}')`;
    const res = await fetch(
      `${url}/api/collections/conversation_threads/records?filter=${encodeURIComponent(filter)}&perPage=500&fields=thread_id,name,archived`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return map;
    const data = (await res.json()) as { items?: ThreadMetaRow[] };
    for (const row of data.items ?? []) {
      if (row.thread_id) map.set(row.thread_id, row);
    }
  } catch { /* meta absent — surface raw threads only */ }
  return map;
}

async function verifyUserOwnsSelf(userId: string, pbToken: string): Promise<boolean> {
  if (!pbToken) return false;
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { record?: { id?: string } };
    return data.record?.id === userId;
  } catch {
    return false;
  }
}

type ConversationRow = {
  id: string;
  thread_id: string;
  department?: string;
  agent_id?: string;
  role: string;
  content: string;
  created: string;
};

type ThreadSummary = {
  threadId: string;
  department?: string;
  agentId?: string;
  preview: string;
  lastAt: string;
  turnCount: number;
  // Phase 25 — surfaced from conversation_threads when present.
  name?: string;
  archived?: boolean;
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  const limit = Math.min(Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20, 50);
  const includeArchived = url.searchParams.get("includeArchived") === "1";
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  const pbToken = req.headers.get("authorization") ?? "";
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const pb = pbUrl();
    // Fetch the most recent N turns + thread metadata in parallel. PB doesn't
    // support GROUP BY, so we paginate enough turn rows to surface ~20
    // distinct threads then aggregate in memory.
    const filter = `(user='${pbEscape(userId)}')`;
    const [turnsRes, metaMap] = await Promise.all([
      fetch(
        `${pb}/api/collections/conversations/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=200&fields=id,thread_id,department,agent_id,role,content,created`,
        { headers: { Authorization: token } }
      ),
      fetchThreadMeta(userId, token),
    ]);
    if (!turnsRes.ok) return Response.json({ ok: true, threads: [] });
    const data = (await turnsRes.json()) as { items?: ConversationRow[] };
    const rows = data.items ?? [];

    const map = new Map<string, ThreadSummary>();
    for (const row of rows) {
      if (!row.thread_id) continue;
      const existing = map.get(row.thread_id);
      if (!existing) {
        const meta = metaMap.get(row.thread_id);
        map.set(row.thread_id, {
          threadId: row.thread_id,
          department: row.department,
          agentId: row.agent_id,
          preview: row.content.slice(0, 140),
          lastAt: row.created,
          turnCount: 1,
          name: meta?.name,
          archived: meta?.archived ?? false,
        });
      } else {
        existing.turnCount++;
        // rows are sorted -created so existing was a later turn; keep its preview
      }
    }

    const all = [...map.values()];
    const filtered = includeArchived ? all : all.filter((t) => !t.archived);
    const threads = filtered.slice(0, limit);
    void adminHeaders;
    return Response.json({ ok: true, threads });
  } catch (err) {
    console.error("conversations list error:", err);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
}
