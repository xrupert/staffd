/**
 * Listmonk integration — creates a draft email campaign from generated content.
 * Requires LISTMONK_URL + LISTMONK_USERNAME + LISTMONK_PASSWORD env vars.
 * Returns 503 with setup instructions when not yet configured.
 *
 * ⚠️ OPERATOR-ONLY per Standard #22. Customer-facing email actions go through
 * /api/intent/commit (draft_campaign) and the per-customer /api/front-desk/campaigns
 * surface (list-per-customer partition, W95.7/.7.1). Do not call from customer UI.
 */

import { recordDecision } from "../../_lib/vault/outcomes";
import { whoAmI } from "../../_lib/integrations/identity";
import { resolveCredentials, type Resolved } from "../../_lib/integrations/resolve";

const NOT_CONFIGURED = {
  error: "not_configured",
  message: "Email isn't connected yet. Add your Listmonk URL, username, and API password in Settings → Connect Your Tools.",
};

/** Listmonk basic-auth tuple from resolved creds (key=password, config.username). */
function lm(creds: Resolved): { base: string; headers: Record<string, string> } {
  const base = creds.url.replace(/\/$/, "");
  const user = String(creds.config.username || "listmonk");
  const auth = Buffer.from(`${user}:${creds.key}`).toString("base64");
  return { base, headers: { "Content-Type": "application/json", Authorization: `Basic ${auth}` } };
}

export async function POST(req: Request) {
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

    const creds = await resolveCredentials({ id: userId ?? "" }, "listmonk");
    if (!creds) return Response.json(NOT_CONFIGURED, { status: 503 });
    const { base: LISTMONK_URL, headers: lmHeaders } = lm(creds);

    // Create a draft campaign in Listmonk
    const res = await fetch(`${LISTMONK_URL}/api/campaigns`, {
      method: "POST",
      headers: lmHeaders,
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
  // W91 — any authenticated user; creds resolve per-user (own → operator).
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const creds = await resolveCredentials(me, "listmonk");
  if (!creds) return Response.json(NOT_CONFIGURED, { status: 503 });
  const { base, headers } = lm(creds);

  const params = new URL(req.url).searchParams;
  const campaignId = params.get("campaign_id");
  const resource = params.get("resource");
  const limit = Math.min(50, Math.max(1, Number.parseInt(params.get("limit") ?? "5", 10) || 5));

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
  // W91 — any authenticated user manages their own campaigns.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

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

  const creds = await resolveCredentials(me, "listmonk");
  if (!creds) return Response.json(NOT_CONFIGURED, { status: 503 });
  const { base, headers } = lm(creds);

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
