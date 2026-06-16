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
  views?: number;
  clicks?: number;
  bounces?: number;
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

  const campaignId = new URL(req.url).searchParams.get("campaign_id");
  const auth = Buffer.from(`${user}:${pass}`).toString("base64");
  const headers = { Authorization: `Basic ${auth}` };

  // W80.1 — no campaign_id → LIST mode (recent campaigns for the Operations
  // Home card). With campaign_id → DETAIL mode (stats for one campaign).
  if (!campaignId) {
    try {
      const res = await fetch(`${base}/api/campaigns?page=1&per_page=5&order_by=created_at&order=DESC`, { headers });
      if (!res.ok) {
        return Response.json({ error: "Listmonk error", detail: (await res.text()).slice(0, 300) }, { status: 502 });
      }
      const data = (await res.json()) as { data?: { results?: LmCampaign[] } };
      const campaigns = (data.data?.results ?? []).map((c) => ({
        id: c.id ?? null,
        name: c.name ?? null,
        status: c.status ?? null,
        sent: c.sent ?? 0,
        views: c.views ?? 0,
        clicks: c.clicks ?? 0,
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
        views: c.views ?? 0,
        clicks: c.clicks ?? 0,
        bounces: c.bounces ?? 0,
      },
    });
  } catch (err) {
    console.error("Listmonk read error:", err);
    return Response.json({ error: "Failed to read campaign" }, { status: 500 });
  }
}
