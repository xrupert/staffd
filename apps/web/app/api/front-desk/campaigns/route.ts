/**
 * GET/POST/PUT /api/front-desk/campaigns (W95.7) — this customer's email
 * campaigns (list-per-customer via ListmonkClient). Repoints the Email
 * Campaigns surface off the operator-wide integrations/listmonk route so the
 * Front Desk is fully per-customer (SA ruling, W95.7).
 *
 * GET            → { connected, campaigns: Campaign[] }
 * GET ?campaign_id=X → { campaign: CampaignDetail | null }
 * POST {subject, body}            → create a draft on this customer's list
 * PUT  {campaignId, action, sendAt?} → send / schedule / pause / cancel (owned only)
 *
 * Vendor-invisible; every read/write scoped to the customer's own list.
 */

import { whoAmI } from "../../_lib/integrations/identity";
import { ListmonkClient } from "../../_lib/integrations/listmonk/client";
import { recordDecision } from "../../_lib/vault/outcomes";

export async function GET(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!ListmonkClient.configured) return Response.json({ connected: false, campaigns: [] });

  const url = new URL(req.url);
  const campaignId = url.searchParams.get("campaign_id");
  const c = ListmonkClient.forCustomer(me.id);
  try {
    if (campaignId) return Response.json({ campaign: await c.getCampaign(campaignId) });
    const limit = Math.min(50, Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50));
    return Response.json({ connected: true, campaigns: await c.listCampaigns(limit) });
  } catch {
    return Response.json({ connected: true, campaigns: [] });
  }
}

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { subject?: string; body?: string } | null;
  const subject = (body?.subject ?? "").trim();
  const content = (body?.body ?? "").trim();
  if (!subject || !content) return Response.json({ error: "subject and body are required" }, { status: 400 });

  const id = await ListmonkClient.forCustomer(me.id).createDraft({ subject, body: content });
  if (!id) return Response.json({ error: "create_failed" }, { status: 502 });
  void recordDecision({ userId: me.id, decision_kind: "campaign_drafted", title: `Drafted email campaign "${subject}"`, source_kind: "listmonk", source_id: String(id) });
  return Response.json({ success: true, campaignId: id });
}

export async function PUT(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { campaignId?: number | string; action?: string; sendAt?: string } | null;
  const campaignId = body?.campaignId;
  const action = body?.action;
  if (!campaignId || !action) return Response.json({ error: "campaignId and action are required" }, { status: 400 });
  if (!["send", "schedule", "pause", "cancel"].includes(action)) return Response.json({ error: "unsupported action" }, { status: 400 });

  const ok = await ListmonkClient.forCustomer(me.id).setStatus(campaignId, action as "send" | "schedule" | "pause" | "cancel", body?.sendAt);
  if (!ok) return Response.json({ error: "not_found_or_failed" }, { status: 404 });
  if (action === "send") void recordDecision({ userId: me.id, decision_kind: "campaign_sent", title: "Sent an email campaign", source_kind: "listmonk", source_id: String(campaignId) });
  return Response.json({ success: true });
}
