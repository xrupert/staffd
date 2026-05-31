/**
 * POST /api/webhooks/chatwoot
 *
 * Receives events from Chatwoot and turns incoming customer messages into
 * draft replies posted as PRIVATE NOTES on the conversation. The operator
 * reviews the draft, edits if needed, and sends it — STAFFD never replies
 * directly to a customer without human approval.
 *
 * Events handled:
 *   message_created  → if message_type is "incoming" and not a private note,
 *                       draft a reply via Claude and post as a private note
 *
 * Other event types are accepted and ignored (return 200 so Chatwoot doesn't
 * retry endlessly).
 *
 * Security: validates the payload's account id matches CHATWOOT_ACCOUNT_ID.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

const CHATWOOT_URL  = (process.env.CHATWOOT_URL ?? "").replace(/\/$/, "");
const CHATWOOT_KEY  = process.env.CHATWOOT_API_KEY ?? "";
const CHATWOOT_ACCT = process.env.CHATWOOT_ACCOUNT_ID ?? "";

interface ChatwootMessage {
  id: number;
  content: string;
  message_type: number | string; // 0/1 or "incoming"/"outgoing"
  private?: boolean;
  created_at?: number;
  sender?: { name?: string; email?: string; type?: string };
}

interface ChatwootWebhookEvent {
  event?: string;
  account?: { id?: number | string };
  conversation?: {
    id?: number;
    messages?: ChatwootMessage[];
    contact_inbox?: { contact_id?: number };
    meta?: { sender?: { name?: string; email?: string } };
  };
  // Some message_created events deliver the message at the root with no nesting
  id?: number;
  content?: string;
  message_type?: number | string;
  private?: boolean;
  sender?: { name?: string; email?: string; type?: string };
  conversation_id?: number;
}

/** Chatwoot reports message_type as 0=incoming, 1=outgoing, 2=activity, 3=template */
function isIncoming(m: { message_type?: number | string }): boolean {
  return m.message_type === 0 || m.message_type === "incoming";
}

async function cw(path: string, init: RequestInit = {}) {
  return fetch(`${CHATWOOT_URL}/api/v1${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      api_access_token: CHATWOOT_KEY,
      ...(init.headers ?? {}),
    },
  });
}

interface ConversationDetail {
  id: number;
  messages?: ChatwootMessage[];
  meta?: { sender?: { name?: string; email?: string } };
}

async function fetchConversation(conversationId: number): Promise<ConversationDetail | null> {
  const res = await cw(`/accounts/${CHATWOOT_ACCT}/conversations/${conversationId}`);
  if (!res.ok) return null;
  return (await res.json()) as ConversationDetail;
}

async function postPrivateNote(conversationId: number, content: string): Promise<boolean> {
  const res = await cw(`/accounts/${CHATWOOT_ACCT}/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify({
      content,
      message_type: "outgoing",
      private: true, // KEY: this stays internal — never sent to the customer
    }),
  });
  return res.ok;
}

const SYSTEM_PROMPT = `You are The Reputation Manager — STAFFD's customer service specialist.

A new customer message has arrived. Draft a reply for the operator to review and send. Do not assume you know the customer's full history beyond what's in the conversation context.

PRINCIPLES:
- Acknowledge the issue specifically before solving it. Customers want to feel heard first.
- Apologize specifically for the situation, not generically for inconvenience.
- Match the customer's tone, but always one notch calmer.
- Offer a concrete next step or resolution — never leave anyone in limbo.
- If you genuinely lack info to respond well, say what's needed.

OUTPUT RULES:
- Deliver the reply text only. No preamble, no "Here's a draft."
- Start with the customer's name if known.
- Keep it tight: 2-4 short paragraphs maximum unless the situation requires more.
- Sign off with a generic role like "Support" — the operator will personalize.
- Ready to send as-is, but assume the operator may edit before sending.`;

async function draftReply(
  conversation: ConversationDetail,
  triggerMessage: { content: string; sender?: { name?: string } }
): Promise<string> {
  // Build conversation context — last 6 messages so The Reputation Manager
  // has continuity without paying for the entire history.
  const recent = (conversation.messages ?? []).slice(-6);
  const transcript = recent
    .filter((m) => m.content?.trim() && !m.private)
    .map((m) => {
      const who = isIncoming(m) ? "Customer" : "Support";
      return `${who}: ${m.content.trim()}`;
    })
    .join("\n\n");

  const customerName = triggerMessage.sender?.name
    ?? conversation.meta?.sender?.name
    ?? "the customer";

  const userPrompt = transcript
    ? `Customer's name: ${customerName}\n\nConversation so far:\n\n${transcript}\n\nDraft a reply to their latest message.`
    : `Customer ${customerName} just wrote:\n\n"${triggerMessage.content}"\n\nDraft a reply.`;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1024,
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = msg.content[0];
  return block?.type === "text" ? block.text.trim() : "";
}

export async function POST(req: Request) {
  // Always 200 — Chatwoot retries failed webhooks aggressively
  try {
    if (!CHATWOOT_URL || !CHATWOOT_KEY || !CHATWOOT_ACCT) {
      return Response.json({ ok: true, skipped: "not_configured" });
    }

    const payload = (await req.json()) as ChatwootWebhookEvent;

    // Verify the event came from our account
    const accountId = String(payload.account?.id ?? "");
    if (accountId && accountId !== CHATWOOT_ACCT) {
      return Response.json({ ok: true, skipped: "wrong_account" });
    }

    // We only act on message_created events
    if (payload.event !== "message_created") {
      return Response.json({ ok: true, skipped: payload.event ?? "unknown_event" });
    }

    // Resolve the message — Chatwoot delivers it either at the root or nested
    const messageType = payload.message_type ?? payload.conversation?.messages?.slice(-1)[0]?.message_type;
    const isPrivate = payload.private ?? payload.conversation?.messages?.slice(-1)[0]?.private;
    const content   = payload.content ?? payload.conversation?.messages?.slice(-1)[0]?.content ?? "";
    const sender    = payload.sender ?? payload.conversation?.messages?.slice(-1)[0]?.sender;

    // Skip non-customer messages — we never want to reply to our own private notes
    // or outgoing operator messages
    if (!isIncoming({ message_type: messageType }) || isPrivate) {
      return Response.json({ ok: true, skipped: "not_incoming_customer_message" });
    }
    if (!content.trim()) {
      return Response.json({ ok: true, skipped: "empty_message" });
    }

    // Find the conversation id
    const conversationId = payload.conversation_id ?? payload.conversation?.id;
    if (!conversationId) {
      return Response.json({ ok: true, skipped: "no_conversation_id" });
    }

    // Pull full conversation context for the draft
    const conversation = await fetchConversation(conversationId);
    if (!conversation) {
      return Response.json({ ok: true, skipped: "conversation_not_found" });
    }

    const draft = await draftReply(conversation, { content, sender });
    if (!draft) {
      return Response.json({ ok: true, skipped: "empty_draft" });
    }

    const noteBody = `🤖 **STAFFD draft reply** — review, edit, and send when ready:\n\n${draft}`;
    const posted = await postPrivateNote(conversationId, noteBody);

    return Response.json({ ok: true, drafted: posted, conversationId });
  } catch (err) {
    console.error("Chatwoot webhook error:", err);
    // Still 200 so Chatwoot doesn't pile up retries
    return Response.json({ ok: true, error: String(err) });
  }
}

// Chatwoot pings the endpoint with GET during inbox setup to verify it exists
export async function GET() {
  return Response.json({ ok: true, service: "staffd-chatwoot-webhook" });
}
