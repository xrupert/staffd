/**
 * Chatwoot integration — creates a contact + conversation from a Reputation
 * specialist's customer service draft.
 *
 * Requires CHATWOOT_URL + CHATWOOT_API_KEY + CHATWOOT_ACCOUNT_ID env vars.
 * Returns 503 with setup instructions when not yet configured.
 *
 * Workflow:
 *   1. Find or create a contact by email
 *   2. Create a new conversation against the inbox (we use the API_CHANNEL inbox
 *      auto-created on first run, or the first available inbox)
 *   3. Post the generated reply as the first outgoing message
 *
 * Returns a deep link to the conversation so the operator can review/edit
 * before the customer sees it.
 */

import { recordDecision } from "../../_lib/vault/outcomes";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

const CHATWOOT_URL  = (process.env.CHATWOOT_URL ?? "").replace(/\/$/, "");
const CHATWOOT_KEY  = process.env.CHATWOOT_API_KEY ?? "";
const CHATWOOT_ACCT = process.env.CHATWOOT_ACCOUNT_ID ?? "";

function notConfigured(): Response {
  return Response.json(
    {
      error: "not_configured",
      message:
        "Support tickets are not set up yet. Deploy Chatwoot and add CHATWOOT_URL, CHATWOOT_API_KEY, and CHATWOOT_ACCOUNT_ID to your environment variables.",
    },
    { status: 503 }
  );
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

interface Contact {
  id: number;
  source_id?: string;
}

interface SearchResponse {
  payload?: Contact[];
  data?: { payload?: Contact[] };
}

interface Inbox {
  id: number;
  channel_type?: string;
}

interface InboxesResponse {
  data?: { payload?: Inbox[] };
  payload?: Inbox[];
}

async function findOrCreateContact(name: string, email: string): Promise<number | null> {
  // Search by email
  const searchRes = await cw(`/accounts/${CHATWOOT_ACCT}/contacts/search?q=${encodeURIComponent(email)}&include=contact_inboxes`);
  if (searchRes.ok) {
    const data = (await searchRes.json()) as SearchResponse;
    const list = data.payload ?? data.data?.payload ?? [];
    if (list[0]?.id) return list[0].id;
  }

  // Create new contact
  const createRes = await cw(`/accounts/${CHATWOOT_ACCT}/contacts`, {
    method: "POST",
    body: JSON.stringify({ name, email }),
  });
  if (!createRes.ok) return null;
  const data = (await createRes.json()) as { payload?: { contact?: Contact }; id?: number };
  return data.payload?.contact?.id ?? data.id ?? null;
}

async function getFirstInboxId(): Promise<number | null> {
  const res = await cw(`/accounts/${CHATWOOT_ACCT}/inboxes`);
  if (!res.ok) return null;
  const data = (await res.json()) as InboxesResponse;
  const list = data.data?.payload ?? data.payload ?? [];
  // Prefer api inbox (channel_type Channel::Api) since we're creating programmatically
  const apiInbox = list.find((i) => (i.channel_type ?? "").toLowerCase().includes("api"));
  return apiInbox?.id ?? list[0]?.id ?? null;
}

export async function POST(req: Request) {
  if (!CHATWOOT_URL || !CHATWOOT_KEY || !CHATWOOT_ACCT) {
    return notConfigured();
  }

  try {
    const { customerName, customerEmail, subject, reply, userId } = (await req.json()) as {
      customerName: string;
      customerEmail: string;
      subject?: string;
      reply: string;
      userId?: string; // FC-3b — when present, the outcome is recorded to the vault
    };

    if (!customerName?.trim() || !customerEmail?.trim() || !reply?.trim()) {
      return Response.json(
        { error: "customerName, customerEmail, and reply are required" },
        { status: 400 }
      );
    }

    const contactId = await findOrCreateContact(customerName.trim(), customerEmail.trim());
    if (!contactId) {
      return Response.json({ error: "Failed to create contact in Chatwoot" }, { status: 502 });
    }

    const inboxId = await getFirstInboxId();
    if (!inboxId) {
      return Response.json(
        {
          error: "no_inbox",
          message:
            "Chatwoot needs at least one inbox configured. Open Chatwoot → Settings → Inboxes → Add Inbox (API channel works best for STAFFD).",
        },
        { status: 502 }
      );
    }

    // Create conversation
    const convRes = await cw(`/accounts/${CHATWOOT_ACCT}/conversations`, {
      method: "POST",
      body: JSON.stringify({
        source_id: customerEmail.trim(),
        inbox_id: inboxId,
        contact_id: contactId,
        status: "open",
        ...(subject ? { additional_attributes: { mail_subject: subject.trim() } } : {}),
      }),
    });
    if (!convRes.ok) {
      const detail = await convRes.text();
      return Response.json({ error: "Failed to create conversation", detail }, { status: 502 });
    }
    const conv = (await convRes.json()) as { id: number };

    // Post the reply as the first outgoing message
    await cw(`/accounts/${CHATWOOT_ACCT}/conversations/${conv.id}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content: reply.trim(),
        message_type: "outgoing",
        private: false,
      }),
    });

    // FC-3b — record the opened support ticket as a vault outcome.
    if (userId) {
      void recordDecision({
        userId,
        decision_kind: "support_ticket_opened",
        title: `Opened a support ticket for ${customerName}`,
        source_kind: "chatwoot",
        source_id: String(conv.id),
      });
    }

    return Response.json({
      success: true,
      conversationId: conv.id,
      conversationUrl: `${CHATWOOT_URL}/app/accounts/${CHATWOOT_ACCT}/conversations/${conv.id}`,
    });
  } catch (err) {
    console.error("Chatwoot route error:", err);
    return Response.json({ error: "Failed to create support ticket" }, { status: 500 });
  }
}

/**
 * GET /api/integrations/chatwoot?status=open  (FC-1b)
 *
 * Read side — gives the Customer Service Responder awareness of open
 * tickets instead of only being able to push replies. Env read inside the
 * handler so config changes (and tests) take effect without a reload.
 */
type CwConversation = {
  id: number;
  status?: string;
  last_activity_at?: number;
  meta?: { sender?: { name?: string; email?: string } };
};

export async function GET(req: Request) {
  // Operator-private support data — super-admin only (W80.1).
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const base = (process.env.CHATWOOT_URL ?? "").replace(/\/$/, "");
  const key = process.env.CHATWOOT_API_KEY ?? "";
  const acct = process.env.CHATWOOT_ACCOUNT_ID ?? "";
  if (!base || !key || !acct) return notConfigured();

  const status = new URL(req.url).searchParams.get("status") ?? "open";

  try {
    const res = await fetch(
      `${base}/api/v1/accounts/${acct}/conversations?status=${encodeURIComponent(status)}&assignee_type=all`,
      { headers: { "Content-Type": "application/json", api_access_token: key } }
    );
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Chatwoot error", detail: text.slice(0, 300) }, { status: 502 });
    }
    const data = (await res.json()) as {
      data?: { payload?: CwConversation[] };
      payload?: CwConversation[];
    };
    const list = data.data?.payload ?? data.payload ?? [];
    const conversations = list.map((c) => ({
      id: c.id,
      status: c.status ?? null,
      contact: c.meta?.sender?.name ?? c.meta?.sender?.email ?? "Unknown",
      email: c.meta?.sender?.email ?? null,
      lastActivityAt: c.last_activity_at ?? null,
      url: `${base}/app/accounts/${acct}/conversations/${c.id}`,
    }));
    return Response.json({ conversations });
  } catch (err) {
    console.error("Chatwoot read error:", err);
    return Response.json({ error: "Failed to read support tickets" }, { status: 500 });
  }
}
