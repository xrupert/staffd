/**
 * GET   /api/conversations/[threadId]?userId=...
 *       Returns the ordered turns of a thread (oldest first) so the picker
 *       can hydrate CommandCenter's message history.
 *
 * PATCH /api/conversations/[threadId]
 *       Body: { userId, pbToken, name?, archived? }
 *       Updates the thread metadata row (conversation_threads). Either
 *       field is optional; sending null on `name` falls back to the empty
 *       string (which the UI treats as "use derived name").
 *
 * Auth: PB session via Authorization header (GET) or pbToken in body (PATCH).
 * Ownership-verified — every turn / meta row's `user` must match the
 * authenticated caller.
 */

import { adminHeaders, getAdminToken, pbEscape, pbFirst, pbUrl } from "../../_lib/pb";

type RouteContext = { params: Promise<{ threadId: string }> };

type TurnRow = {
  id: string;
  user: string;
  thread_id: string;
  department?: string;
  agent_id?: string;
  role: string;
  content: string;
  document_id?: string;
  created: string;
};

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

export async function GET(req: Request, { params }: RouteContext) {
  const { threadId } = await params;
  if (!threadId) return Response.json({ error: "missing_thread_id" }, { status: 400 });

  const url = new URL(req.url);
  const userId = url.searchParams.get("userId");
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  const pbToken = req.headers.get("authorization") ?? "";
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const token = await getAdminToken();
    const pb = pbUrl();
    const filter = `(user='${pbEscape(userId)}' && thread_id='${pbEscape(threadId)}')`;
    const res = await fetch(
      `${pb}/api/collections/conversations/records?filter=${encodeURIComponent(filter)}&sort=created&perPage=500&fields=id,thread_id,department,agent_id,role,content,document_id,created`,
      { headers: { Authorization: token } }
    );
    if (!res.ok) return Response.json({ ok: true, threadId, turns: [] });
    const data = (await res.json()) as { items?: TurnRow[] };
    const turns = data.items ?? [];

    // Fetch thread metadata in parallel (best-effort).
    const meta = await pbFirst<{ name?: string; archived?: boolean }>(
      "conversation_threads",
      `(thread_id='${pbEscape(threadId)}' && user='${pbEscape(userId)}')`,
      token,
      { fields: "name,archived" }
    );

    return Response.json({
      ok: true,
      threadId,
      name: meta?.name ?? null,
      archived: meta?.archived ?? false,
      turns,
    });
  } catch (err) {
    console.error("conversations [threadId] GET error:", err);
    return Response.json({ error: "load_failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: RouteContext) {
  const { threadId } = await params;
  if (!threadId) return Response.json({ error: "missing_thread_id" }, { status: 400 });

  let body: { userId?: string; pbToken?: string; name?: string | null; archived?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }

  const { userId, pbToken } = body;
  if (!userId || !pbToken) {
    return Response.json({ error: "missing_required_fields" }, { status: 400 });
  }
  if (!(await verifyUserOwnsSelf(userId, pbToken))) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  if (body.name !== undefined && body.name !== null && typeof body.name !== "string") {
    return Response.json({ error: "invalid_name" }, { status: 400 });
  }
  if (body.archived !== undefined && typeof body.archived !== "boolean") {
    return Response.json({ error: "invalid_archived" }, { status: 400 });
  }

  try {
    const token = await getAdminToken();
    const url = pbUrl();
    const headers = adminHeaders(token);

    const existing = await pbFirst<{ id: string; user: string }>(
      "conversation_threads",
      `(thread_id='${pbEscape(threadId)}')`,
      token,
      { fields: "id,user" }
    );

    const patch: Record<string, unknown> = {};
    if (body.name !== undefined) patch.name = body.name ?? "";
    if (body.archived !== undefined) patch.archived = body.archived;

    if (!existing) {
      // Auto-create on first patch — covers the case where a user renames
      // a thread that pre-dates this PR's auto-row creation.
      const createBody = {
        user: userId,
        thread_id: threadId,
        name: typeof body.name === "string" ? body.name : "",
        archived: body.archived ?? false,
      };
      const res = await fetch(`${url}/api/collections/conversation_threads/records`, {
        method: "POST",
        headers,
        body: JSON.stringify(createBody),
      });
      if (!res.ok) {
        const detail = await res.text();
        return Response.json({ error: "create_failed", detail: detail.slice(0, 200) }, { status: 500 });
      }
      const created = (await res.json()) as { id: string };
      return Response.json({ ok: true, id: created.id, threadId, ...createBody });
    }

    if (existing.user !== userId) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }

    const res = await fetch(`${url}/api/collections/conversation_threads/records/${existing.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const detail = await res.text();
      return Response.json({ error: "patch_failed", detail: detail.slice(0, 200) }, { status: 500 });
    }
    const updated = (await res.json()) as Record<string, unknown>;
    return Response.json({ ok: true, id: existing.id, threadId, ...updated });
  } catch (err) {
    console.error("conversations [threadId] PATCH error:", err);
    return Response.json({ error: "update_failed" }, { status: 500 });
  }
}
