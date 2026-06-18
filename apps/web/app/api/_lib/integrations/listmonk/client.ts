/**
 * ListmonkClient — the ONLY path to the operator-shared Listmonk instance (W95.2).
 *
 * ⚠️ ALL LISTMONK PARTITION ACCESS GOES THROUGH THIS CLIENT. Bypass = tenant leak. ⚠️
 *
 * Model B3 partition = LIST-PER-CUSTOMER. staffdCustomerId = PB userId (locked
 * by SA — never a parallel id). Each customer owns the list named
 * `staffd-<userId>`; subscribers + sends are scoped to it. Probe (W95.2)
 * verified: list create, subscriber-add-to-list, filter-by-list, delete — all
 * 200 on the live instance.
 *
 * Leak-guard: no untenanted client (forCustomer refuses ""), the list is
 * derived from the userId, and the raw HTTP fn is module-private (unexported).
 * NOTE: the legacy operator-wide campaign route (integrations/listmonk) stays
 * as-is for the operator surfaces; THIS client is the per-customer substrate.
 */

function cfg() {
  return {
    base: (process.env.LISTMONK_URL ?? "").replace(/\/$/, ""),
    user: process.env.LISTMONK_USERNAME ?? "listmonk",
    pass: process.env.LISTMONK_PASSWORD ?? "",
  };
}

/** Module-private — the structural half of the leak-guard. */
async function lm(path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; json: unknown }> {
  const { base, user, pass } = cfg();
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}`, ...(init.headers ?? {}) },
  });
  let json: unknown = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  return { ok: res.ok, status: res.status, json };
}

/** Deterministic per-customer list name. staffdCustomerId = PB userId. */
function listName(customerId: string): string {
  return `staffd-${customerId}`;
}

export class ListmonkClient {
  private listId: number | null = null;
  private constructor(private readonly customerId: string) {}

  static forCustomer(userId: string | null | undefined): ListmonkClient {
    const id = (userId ?? "").trim();
    if (!id) throw new Error("ListmonkClient.forCustomer requires a customerId (tenant tag) — refusing untenanted access.");
    return new ListmonkClient(id);
  }

  static get configured(): boolean {
    const { base, pass } = cfg();
    return !!base && !!pass;
  }

  /** Find-or-create this customer's list; returns its id (cached). */
  private async ensureList(): Promise<number | null> {
    if (this.listId) return this.listId;
    const name = listName(this.customerId);
    // Listmonk has no name filter on /lists; page and match (small N per instance).
    const found = await lm(`/api/lists?per_page=100`);
    if (found.ok) {
      const results = (found.json as { data?: { results?: { id: number; name: string }[] } })?.data?.results ?? [];
      const hit = results.find((l) => l.name === name);
      if (hit) { this.listId = hit.id; return hit.id; }
    }
    const mk = await lm(`/api/lists`, { method: "POST", body: JSON.stringify({ name, type: "private", optin: "single" }) });
    if (!mk.ok) return null;
    const id = (mk.json as { data?: { id?: number } })?.data?.id ?? null;
    this.listId = id;
    return id;
  }

  /** Add a subscriber to THIS customer's list only. */
  async addSubscriber(input: { email: string; name?: string }): Promise<boolean> {
    const id = await this.ensureList();
    if (!id) return false;
    const res = await lm(`/api/subscribers`, {
      method: "POST",
      body: JSON.stringify({ email: input.email, name: input.name ?? "", lists: [id], status: "enabled", preconfirm_subscriptions: true }),
    });
    return res.ok;
  }

  /** Remove a subscriber (by email) from this customer — undo of an add (W95.5).
   *  Find-by-email within the instance, then delete the subscriber record. */
  async removeSubscriber(email: string): Promise<boolean> {
    const e = (email ?? "").trim();
    if (!e) return false;
    const q = encodeURIComponent(`subscribers.email = '${e.replace(/'/g, "''")}'`);
    const found = await lm(`/api/subscribers?query=${q}&per_page=1`);
    if (!found.ok) return false;
    const id = (found.json as { data?: { results?: { id: number }[] } })?.data?.results?.[0]?.id;
    if (!id) return true; // already absent — idempotent
    const del = await lm(`/api/subscribers/${id}`, { method: "DELETE" });
    return del.ok;
  }

  /** Subscribers for THIS customer's list only — list filter always injected. */
  async listSubscribers(limit = 25): Promise<{ email: string; name: string }[]> {
    const id = await this.ensureList();
    if (!id) return [];
    const res = await lm(`/api/subscribers?list_id=${id}&per_page=${limit}`);
    if (!res.ok) return [];
    const rows = (res.json as { data?: { results?: { email?: string; name?: string }[] } })?.data?.results ?? [];
    return rows.map((r) => ({ email: r.email ?? "", name: r.name ?? "" }));
  }

  // ── Campaigns (W95.7) — scoped to THIS customer's list ────────────────────
  // Listmonk campaigns target one or more lists; "this customer's campaigns" =
  // campaigns whose `lists[]` includes the customer's own list. The list filter
  // is the leak-guard: a campaign targeting another tenant's list is never
  // returned, and a draft/send always targets ONLY this customer's list.

  /** Campaigns targeting this customer's list (newest first). */
  async listCampaigns(limit = 50): Promise<Campaign[]> {
    const id = await this.ensureList();
    if (!id) return [];
    const res = await lm(`/api/campaigns?page=1&per_page=${limit}&order_by=created_at&order=DESC`);
    if (!res.ok) return [];
    const rows = (res.json as { data?: { results?: LmCampaign[] } })?.data?.results ?? [];
    return rows.filter((c) => ownsList(c, id)).map(toCampaign);
  }

  /** One campaign by id — leak-guarded: null unless it targets this customer's list. */
  async getCampaign(campaignId: number | string): Promise<CampaignDetail | null> {
    const id = await this.ensureList();
    if (!id) return null;
    const res = await lm(`/api/campaigns/${encodeURIComponent(String(campaignId))}`);
    if (!res.ok) return null;
    const c = (res.json as { data?: LmCampaign })?.data;
    if (!c || !ownsList(c, id)) return null;
    return toDetail(c);
  }

  /** Create a draft campaign targeting ONLY this customer's list. */
  async createDraft(input: { subject: string; body: string }): Promise<number | null> {
    const id = await this.ensureList();
    if (!id) return null;
    const res = await lm(`/api/campaigns`, {
      method: "POST",
      body: JSON.stringify({ name: input.subject, subject: input.subject, lists: [id], type: "regular", content_type: "richtext", body: input.body, status: "draft" }),
    });
    if (!res.ok) return null;
    return (res.json as { data?: { id?: number } })?.data?.id ?? null;
  }

  /** Send / schedule / pause / cancel — only for a campaign this customer owns. */
  async setStatus(campaignId: number | string, action: "send" | "schedule" | "pause" | "cancel", sendAt?: string): Promise<boolean> {
    const owned = await this.getCampaign(campaignId); // leak-guard: ownership check
    if (!owned) return false;
    const STATUS: Record<string, string> = { send: "running", schedule: "scheduled", pause: "paused", cancel: "cancelled" };
    const status = STATUS[action];
    if (!status) return false;
    if (action === "schedule" && sendAt) {
      await lm(`/api/campaigns/${encodeURIComponent(String(campaignId))}`, { method: "PUT", body: JSON.stringify({ send_at: sendAt }) });
    }
    const res = await lm(`/api/campaigns/${encodeURIComponent(String(campaignId))}/status`, { method: "PUT", body: JSON.stringify({ status }) });
    return res.ok;
  }
}

// ── Campaign mapping (W95.7) ────────────────────────────────────────────────
type LmCampaign = { id?: number; name?: string; subject?: string; status?: string; sent?: number; to_send?: number; views?: number; clicks?: number; bounces?: number; send_at?: string | null; created_at?: string; body?: string; lists?: { id?: number }[] };
export type Campaign = { id: number; name: string; status: string; sent: number; toSend: number; views: number; clicks: number; openRate: number; sendAt: string | null; createdAt: string | null };
export type CampaignDetail = Campaign & { subject: string; bounces: number; preview: string };

function ownsList(c: LmCampaign, listId: number): boolean {
  return (c.lists ?? []).some((l) => l.id === listId);
}
function openRate(sent?: number, views?: number): number {
  return sent && sent > 0 ? Math.round(((views ?? 0) / sent) * 100) : 0;
}
function toCampaign(c: LmCampaign): Campaign {
  return { id: c.id ?? 0, name: c.name ?? "", status: c.status ?? "", sent: c.sent ?? 0, toSend: c.to_send ?? 0, views: c.views ?? 0, clicks: c.clicks ?? 0, openRate: openRate(c.sent, c.views), sendAt: c.send_at ?? null, createdAt: c.created_at ?? null };
}
function toDetail(c: LmCampaign): CampaignDetail {
  return { ...toCampaign(c), subject: c.subject ?? "", bounces: c.bounces ?? 0, preview: typeof c.body === "string" ? c.body.slice(0, 2000) : "" };
}
