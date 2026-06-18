/**
 * ChatwootClient — the ONLY path to the operator-shared Chatwoot instance (W95.6).
 *
 * ⚠️ ALL CHATWOOT ACCESS GOES THROUGH THIS CLIENT. Bypass = tenant leak. ⚠️
 *
 * Model B3 partition = INBOX-PER-CUSTOMER. staffdCustomerId = PB userId (locked).
 * Each customer owns the Chatwoot inbox named `staffd-<userId>`; its id is cached
 * on `businesses.chatwoot_inbox_id`. Every read auto-injects that inbox_id, so a
 * customer can only ever see their own conversations.
 *
 * Leak-guard: no untenanted client (forCustomer refuses ""), the inbox is
 * derived from the userId, and the raw HTTP fn `cw()` is module-private
 * (unexported). The legacy operator route (integrations/chatwoot) stays for the
 * Reputation specialist's ticket-creation; THIS client is the per-customer
 * read substrate.
 *
 * API shape (operator self-hosted, verified against the existing FC-1 route):
 *   base `${CHATWOOT_URL}/api/v1`, header `api_access_token`, account-scoped
 *   `/accounts/{acct}/...`. Inbox create: POST /inboxes {name, channel:{type:"api"}}.
 *   Conversations: GET /conversations?inbox_id=&status= → {data:{payload:[…]}}.
 *   Messages: GET /conversations/{id}/messages → {payload:[…]}.
 */

import { adminHeaders, getAdminToken, pbUrl, pbEscape } from "../../pb";

function cfg() {
  return {
    base: (process.env.CHATWOOT_URL ?? "").replace(/\/$/, ""),
    key: process.env.CHATWOOT_API_KEY ?? "",
    acct: process.env.CHATWOOT_ACCOUNT_ID ?? "",
  };
}

/** Module-private — the structural half of the leak-guard. */
async function cw(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const { base, key } = cfg();
  const res = await fetch(`${base}/api/v1${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", api_access_token: key, ...(init.headers ?? {}) },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

function inboxName(customerId: string): string {
  return `staffd-${customerId}`;
}

export type Conversation = { id: number; sender: string; snippet: string; status: string; lastAt: string };
export type Message = { id: number; content: string; outgoing: boolean; createdAt: string };

type InboxRow = { id: number; name?: string };

export class ChatwootClient {
  private inboxId: number | null = null;
  private constructor(private readonly customerId: string) {}

  static forCustomer(userId: string | null | undefined): ChatwootClient {
    const id = (userId ?? "").trim();
    if (!id) throw new Error("ChatwootClient.forCustomer requires a customerId (tenant tag) — refusing untenanted access.");
    return new ChatwootClient(id);
  }

  static get configured(): boolean {
    const { base, key, acct } = cfg();
    return !!base && !!key && !!acct;
  }

  /** Read this user's cached inbox id from businesses (admin token). */
  private async cachedInboxId(): Promise<{ bizId: string | null; inboxId: number | null }> {
    try {
      const token = await getAdminToken();
      const filter = encodeURIComponent(`user = "${pbEscape(this.customerId)}"`);
      const res = await fetch(`${pbUrl()}/api/collections/businesses/records?filter=${filter}&perPage=1&fields=id,chatwoot_inbox_id`, { headers: { Authorization: token } });
      if (!res.ok) return { bizId: null, inboxId: null };
      const row = ((await res.json()) as { items?: { id: string; chatwoot_inbox_id?: number }[] }).items?.[0];
      return { bizId: row?.id ?? null, inboxId: row?.chatwoot_inbox_id ? Number(row.chatwoot_inbox_id) : null };
    } catch { return { bizId: null, inboxId: null }; }
  }

  private async persistInboxId(bizId: string | null, inboxId: number): Promise<void> {
    if (!bizId) return; // no businesses row yet — name-lookup keeps it idempotent
    try {
      const token = await getAdminToken();
      await fetch(`${pbUrl()}/api/collections/businesses/records/${bizId}`, { method: "PATCH", headers: adminHeaders(token), body: JSON.stringify({ chatwoot_inbox_id: inboxId }) });
    } catch { /* best-effort */ }
  }

  /**
   * Resolve (or provision) this customer's inbox. Order: cached id → existing
   * inbox named staffd-<userId> (self-healing) → create. The name lookup before
   * create makes concurrent calls converge on one inbox (race mitigation), and
   * we re-read the cache inside the create branch as a second guard.
   */
  async findOrCreateInbox(): Promise<{ inbox_id: number }> {
    if (this.inboxId) return { inbox_id: this.inboxId };
    const name = inboxName(this.customerId);
    const { bizId, inboxId } = await this.cachedInboxId();
    if (inboxId) { this.inboxId = inboxId; return { inbox_id: inboxId }; }

    // Look for an already-provisioned inbox by name (idempotent across calls).
    const list = await cw(`/accounts/${cfg().acct}/inboxes`);
    const rows = list.ok ? (((list.json as { data?: { payload?: InboxRow[] }; payload?: InboxRow[] }).data?.payload ?? (list.json as { payload?: InboxRow[] }).payload) ?? []) : [];
    const existing = rows.find((i) => i.name === name);
    if (existing?.id) { this.inboxId = existing.id; await this.persistInboxId(bizId, existing.id); return { inbox_id: existing.id }; }

    // Re-read the cache (optimistic check) in case a concurrent call just stored one.
    const reread = await this.cachedInboxId();
    if (reread.inboxId) { this.inboxId = reread.inboxId; return { inbox_id: reread.inboxId }; }

    const mk = await cw(`/accounts/${cfg().acct}/inboxes`, { method: "POST", body: JSON.stringify({ name, channel: { type: "api", webhook_url: "" } }) });
    const id = (mk.json as { id?: number; payload?: { id?: number } })?.id ?? (mk.json as { payload?: { id?: number } })?.payload?.id ?? null;
    if (!id) throw new Error("chatwoot: inbox provisioning failed");
    this.inboxId = id;
    await this.persistInboxId(bizId, id);
    return { inbox_id: id };
  }

  /** Open/resolved/pending conversations for THIS customer's inbox only. */
  async listConversations(opts: { status?: "open" | "resolved" | "pending"; limit?: number } = {}): Promise<Conversation[]> {
    const { inbox_id } = await this.findOrCreateInbox();
    const status = opts.status ?? "open";
    const res = await cw(`/accounts/${cfg().acct}/conversations?inbox_id=${inbox_id}&status=${status}`);
    if (!res.ok) return [];
    const payload = ((res.json as { data?: { payload?: unknown[] }; payload?: unknown[] }).data?.payload ?? (res.json as { payload?: unknown[] }).payload) ?? [];
    return (payload as Record<string, unknown>[]).slice(0, opts.limit ?? 10).map((c) => {
      const meta = (c.meta ?? {}) as { sender?: { name?: string; email?: string } };
      const last = (c.last_non_activity_message ?? (Array.isArray(c.messages) ? (c.messages as Record<string, unknown>[]).slice(-1)[0] : undefined)) as { content?: string } | undefined;
      return {
        id: Number(c.id),
        sender: meta.sender?.name || meta.sender?.email || "Customer",
        snippet: (last?.content ?? "").slice(0, 40),
        status: String(c.status ?? status),
        lastAt: new Date(Number(c.timestamp ?? 0) * 1000 || Date.now()).toISOString(),
      };
    });
  }

  /** Messages in a conversation, oldest-first. Inbox-scoped via the conversation. */
  async listMessages(conversationId: number): Promise<Message[]> {
    const res = await cw(`/accounts/${cfg().acct}/conversations/${conversationId}/messages`);
    if (!res.ok) return [];
    const payload = ((res.json as { payload?: unknown[] }).payload ?? (res.json as { data?: { payload?: unknown[] } }).data?.payload) ?? [];
    return (payload as Record<string, unknown>[])
      .filter((m) => m.content)
      .map((m) => ({
        id: Number(m.id),
        content: String(m.content),
        outgoing: Number(m.message_type) === 1, // 0 incoming, 1 outgoing
        createdAt: new Date(Number(m.created_at ?? 0) * 1000 || Date.now()).toISOString(),
      }))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getConversation(conversationId: number): Promise<Conversation | null> {
    const res = await cw(`/accounts/${cfg().acct}/conversations/${conversationId}`);
    if (!res.ok) return null;
    const c = res.json as Record<string, unknown>;
    const meta = (c.meta ?? {}) as { sender?: { name?: string; email?: string } };
    return { id: Number(c.id), sender: meta.sender?.name || meta.sender?.email || "Customer", snippet: "", status: String(c.status ?? ""), lastAt: new Date().toISOString() };
  }
}
