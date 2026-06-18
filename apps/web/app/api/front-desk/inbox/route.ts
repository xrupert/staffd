/**
 * GET /api/front-desk/inbox (W95.6) — this customer's open support conversations
 * (inbox-per-customer partition via ChatwootClient). Read-only. Powers the
 * Support Inbox card + the /dashboard/front-desk/inbox page. Vendor-invisible.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { ChatwootClient } from "../../_lib/integrations/chatwoot/client";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!ChatwootClient.configured) return Response.json({ conversations: [], configured: false });
  try {
    const conversations = await ChatwootClient.forCustomer(me.id).listConversations({ status: "open", limit: 10 });
    return Response.json({ conversations, configured: true });
  } catch {
    return Response.json({ conversations: [], configured: true });
  }
}
