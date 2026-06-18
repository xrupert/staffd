/**
 * GET /api/front-desk/inbox/<id> (W95.6) — the full message thread for one
 * conversation, oldest-first (the inbox drawer). Inbox-scoped via ChatwootClient.
 */

import { whoAmI } from "../../../_lib/integrations/identity";
import { ChatwootClient } from "../../../_lib/integrations/chatwoot/client";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { id } = await params;
  const conversationId = Number(id);
  if (!conversationId || Number.isNaN(conversationId)) return Response.json({ error: "bad_id" }, { status: 400 });
  if (!ChatwootClient.configured) return Response.json({ messages: [] });
  try {
    const messages = await ChatwootClient.forCustomer(me.id).listMessages(conversationId);
    return Response.json({ messages });
  } catch {
    return Response.json({ messages: [] });
  }
}
