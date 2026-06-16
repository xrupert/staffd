/**
 * Listmonk integration — creates a draft email campaign from generated content.
 * Requires LISTMONK_URL + LISTMONK_USERNAME + LISTMONK_PASSWORD env vars.
 * Returns 503 with setup instructions when not yet configured.
 */

import { recordDecision } from "../../_lib/vault/outcomes";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";

const LISTMONK_URL = process.env.LISTMONK_URL ?? "";
const LISTMONK_USER = process.env.LISTMONK_USERNAME ?? "listmonk";
const LISTMONK_PASS = process.env.LISTMONK_PASSWORD ?? "";

export async function POST(req: Request) {
  if (!LISTMONK_URL || !LISTMONK_PASS) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Email sending is not set up yet. Deploy Listmonk and add LISTMONK_URL, LISTMONK_USERNAME, and LISTMONK_PASSWORD to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const { subject, body, listIds, userId } = (await req.json()) as {
      subject: string;
      body: string;
      listIds?: number[];
      userId?: string; // FC-3b — when present, the outcome is recorded to the vault
    };

    if (!subject?.trim() || !body?.trim()) {
      return Response.json({ error: "subject and body are required" }, { status: 400 });
    }

    const auth = Buffer.from(`${LISTMONK_USER}:${LISTMONK_PASS}`).toString("base64");

    // Create a draft campaign in Listmonk
    const res = await fetch(`${LISTMONK_URL}/api/campaigns`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify({
        name: subject,
        subject,
        lists: listIds ?? [],
        type: "regular",
        content_type: "richtext",
        body,
        status: "draft",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Listmonk error", detail: text }, { status: 502 });
    }

    const data = (await res.json()) as { data?: { id: number; uuid: string } };

    // FC-3b — record the drafted campaign as a vault outcome (fire-and-forget).
    if (userId) {
      void recordDecision({
        userId,
        decision_kind: "campaign_drafted",
        title: `Drafted email campaign "${subject}"`,
        source_kind: "listmonk",
        source_id: data.data?.id ? String(data.data.id) : undefined,
      });
    }

    return Response.json({
      success: true,
      campaignId: data.data?.id,
      campaignUrl: `${LISTMONK_URL}/campaigns/${data.data?.id}`,
    });
  } catch (err) {
    console.error("Listmonk route error:", err);
    return Response.json({ error: "Failed to create campaign" }, { status: 500 });
  }
}

/**
 * GET /api/integrations/listmonk?campaign_id=X  (FC-1c)
 *
 * Read side — gives the Email Strategist real campaign performance to learn
 * from. Env read inside the handler so config changes (and tests) take
 * effect without a reload.
 */
type LmCampaign = {
  id?: number;
  name?: string;
  subject?: string;
  status?: string;
  sent?: number;
  to_send?: number;
  views?: number;
  clicks?: number;
  bounces?: number;
  send_at?: string | null;
  created_at?: string;
  body?: string;
};

export async function GET(req: Request) {
  // Operator-private email data — super-admin only (W80.1).
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const base = (process.env.LISTMONK_URL ?? "").replace(/\/$/, "");
  const user = process.env.LISTMONK_USERNAME ?? "listmonk";
  const pass = process.env.LISTMONK_PASSWORD ?? "";
  if (!base || !pass) {
    return Response.json(
      {
        error: "not_configured",
        message:
          "Email is not set up yet. Deploy Listmonk and add LISTMONK_URL, LISTMONK_USERNAME, and LISTMONK_PASSWORD to your environment variables.",
      },
      { status: 503 }
    );
  }

  const params = new URL(req.url).searchParams;
  const campaignId = params.get("campaign_id");
  const resource = params.get("resource");
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "5", 10) || 5));
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  // W80.2 — recipient lists, for the compose view's audience picker.
  if (resource === "lists") {
    try {
      const res = await fetch(`${base}/api/lists?page=1&per_page=100`, { headers });
      if (!res.ok) {
        return Response.json({ error: "Listmonk error", detail: (await res.text()).slice(0, 300) }, { status: 502 });
      }
      const data = (await res.json()) as { data?: { results?: { id?: number; name?: string; subscriber_count?: number }[] } };
      const lists = (data.data?.results ?? []).map((l) => ({
        id: l.id ?? null,
        name: l.name ?? null,
        subscribers: l.subscriber_count ?? 0,
      }));
      return Response.json({ lists });
    } catch (err) {
      console.error("Listmonk lists error:", err);
      return Response.json({ error: "Failed to load lists" }, { status: 502 });
    }
  }

  // W80.1/W80.2 — no campaign_id → LIST mode (enriched for the native surface:
  // recipients + dates + open rate). With campaign_id → DETAIL mode.
  if (!campaignId) {
    try {
      const res = await fetch(`${base}/api/campaigns?page=1&per_page=${limit}&order_by=created_at&order=DESC`, { headers });
      if (!res.ok) {
        return Response.json({ error: "Listmonk error", detail: (await res.text()).slice(0, 300) }, { status: 502 });
      }
      const data = (await res.json()) as { data?: { results?: LmCampaign[] } };
      const campaigns = (data.data?.results ?? []).map((c) => ({
        id: c.id ?? null,
        name: c.name ?? null,
        status: c.status ?? null,
        sent: c.sent ?? 0,
        toSend: c.to_send ?? 0,
        views: c.views ?? 0,
        clicks: c.clicks ?? 0,
        openRate: c.sent && c.sent > 0 ? Math.round(((c.views ?? 0) / c.sent) * 100) : 0,
        sendAt: c.send_at ?? null,
        createdAt: c.created_at ?? null,
      }));
      return Response.json({ campaigns });
    } catch (err) {
      console.error("Listmonk list error:", err);
      return Response.json({ error: "Failed to list campaigns" }, { status: 502 });
    }
  }

  try {
    const res = await fetch(`${base}/api/campaigns/${encodeURIComponent(campaignId)}`, {
      headers,
    });
    if (!res.ok) {
      const text = await res.text();
      return Response.json({ error: "Listmonk error", detail: text.slice(0, 300) }, { status: 502 });
    }
    const data = (await res.json()) as { data?: LmCampaign };
    const c = data.data ?? {};
    return Response.json({
      campaign: {
        id: c.id ?? null,
        name: c.name ?? null,
        subject: c.subject ?? null,
        status: c.status ?? null,
        sent: c.sent ?? 0,
        toSend: c.to_send ?? 0,
        views: c.views ?? 0,
        clicks: c.clicks ?? 0,
        bounces: c.bounces ?? 0,
        openRate: c.sent && c.sent > 0 ? Math.round(((c.views ?? 0) / c.sent) * 100) : 0,
        sendAt: c.send_at ?? null,
        preview: typeof c.body === "string" ? c.body.slice(0, 2000) : "",
      },
    });
  } catch (err) {
    console.error("Listmonk read error:", err);
    return Response.json({ error: "Failed to read campaign" }, { status: 500 });
  }
}

/**
 * PUT /api/integrations/listmonk  (W80.2) — send or schedule a campaign.
 * Body: { campaignId, action: "send" | "schedule" | "pause" | "cancel", sendAt? }
 *
 * Listmonk drives sends via campaign status. "send" → running; "schedule"
 * sets send_at then status "scheduled". Super-admin gated. Records a vault
 * outcome on a real send.
 */
export async function PUT(req: Request) {
  try {
    await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  const base = (process.env.LISTMONK_URL ?? "").replace(/\/$/, "");
  const user = process.env.LISTMONK_USERNAME ?? "listmonk";
  const pass = process.env.LISTMONK_PASSWORD ?? "";
  if (!base || !pass) {
    return Response.json({ error: "not_configured", message: "Email isn't set up yet." }, { status: 503 });
  }

  const body = (await req.json().catch(() => null)) as
    | { campaignId?: number | string; action?: string; sendAt?: string; userId?: string }
    | null;
  const campaignId = body?.campaignId;
  const action = body?.action;
  if (!campaignId || !action) {
    return Response.json({ error: "campaignId and action are required" }, { status: 400 });
  }

  const STATUS: Record<string, string> = { send: "running", schedule: "scheduled", pause: "paused", cancel: "cancelled" };
  const status = STATUS[action];
  if (!status) {
    return Response.json({ error: "unsupported action" }, { status: 400 });
  }

  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const headers = { "Content-Type": "application/json", Authorization: `Basic ${auth}` };

  try {
    // Schedule first sets send_at on the campaign before flipping status.
    if (action === "schedule" && body?.sendAt) {
      await fetch(`${base}/api/campaigns/${encodeURIComponent(String(campaignId))}`, {
        method: "PUT", headers, body: JSON.stringify({ send_at: body.sendAt }),
      });
    }
    const res = await fetch(`${base}/api/campaigns/${encodeURIComponent(String(campaignId))}/status`, {
      method: "PUT", headers, body: JSON.stringify({ status }),
    });
    if (!res.ok) {
      return Response.json({ error: "Listmonk error", detail: (await res.text()).slice(0, 300) }, { status: 502 });
    }

    if (action === "send" && body?.userId) {
      void recordDecision({
        userId: body.userId,
        decision_kind: "campaign_sent",
        title: `Sent an email campaign`,
        source_kind: "listmonk",
        source_id: String(campaignId),
      });
    }
    return Response.json({ success: true, status });
  } catch (err) {
    console.error("Listmonk status error:", err);
    return Response.json({ error: "Failed to update campaign" }, { status: 502 });
  }
}
