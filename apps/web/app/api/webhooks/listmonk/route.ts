/**
 * POST /api/webhooks/listmonk
 *
 * Receives Listmonk campaign / subscriber events and routes them into the
 * Vault outcomes pipeline. Listmonk's built-in webhook payloads are minimal;
 * we translate the events we care about:
 *
 *   • campaign.complete  — total recipients, opens, clicks → outcome metrics
 *   • subscriber.bounced — hard bounce → bounce signal
 *   • subscriber.complaint — abuse complaint → bounce signal
 *
 * The campaign-id → document-id mapping isn't enforced here (the existing
 * `/api/integrations/listmonk` send path doesn't yet persist that link).
 * When the payload includes a `staffd_document_id` custom header / metadata,
 * we use it; otherwise the outcome lands in vault_decisions without a
 * pattern-weight bump (still useful for the CEO brief).
 *
 * Auth: `LISTMONK_WEBHOOK_SECRET` env var checked against the
 * `x-listmonk-secret` header. Skipped when env unset (dev mode).
 *
 * Always returns 200 — Listmonk retries indefinitely on non-2xx.
 */

import { recordOutcome } from "../../_lib/vault/outcomes";

type ListmonkEvent = {
  event?: string;
  campaign?: {
    id?: number | string;
    name?: string;
    user_id?: string;
    staffd_user_id?: string;
    staffd_document_id?: string;
    stats?: {
      recipients?: number;
      opens?: number;
      clicks?: number;
      bounces?: number;
      unsubscribes?: number;
    };
  };
  subscriber?: {
    email?: string;
    staffd_user_id?: string;
    staffd_document_id?: string;
  };
  // Some Listmonk events carry metrics at root
  recipients?: number;
  opens?: number;
  clicks?: number;
  bounces?: number;
  unsubscribes?: number;
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.LISTMONK_WEBHOOK_SECRET ?? "";
  if (!secret) return true; // dev mode — no secret configured
  const provided = req.headers.get("x-listmonk-secret") ?? "";
  return provided === secret;
}

function safeRate(numer: number | undefined, denom: number | undefined): number {
  if (!numer || !denom || denom <= 0) return 0;
  return numer / denom;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let event: ListmonkEvent;
  try {
    event = (await req.json()) as ListmonkEvent;
  } catch {
    return Response.json({ ok: true, ignored: "invalid_json" });
  }

  const kind = (event.event ?? "").toLowerCase();
  const userId = event.campaign?.staffd_user_id ?? event.subscriber?.staffd_user_id;
  const documentId = event.campaign?.staffd_document_id ?? event.subscriber?.staffd_document_id;

  if (!userId) {
    // Best-effort: log + 200. We can't route to a Vault without knowing
    // which STAFFD user this Listmonk account belongs to.
    console.warn("[listmonk.webhook] no staffd_user_id on payload, ignoring", { kind });
    return Response.json({ ok: true, ignored: "no_user_id" });
  }

  try {
    if (kind === "campaign.complete" || kind === "campaign:completed") {
      const stats = event.campaign?.stats ?? {
        recipients: event.recipients,
        opens: event.opens,
        clicks: event.clicks,
      };
      const campaignName = event.campaign?.name ?? "campaign";

      const openRate = safeRate(stats.opens, stats.recipients);
      const clickRate = safeRate(stats.clicks, stats.recipients);

      // Open-rate outcome
      await recordOutcome({
        userId,
        document_id: documentId,
        source_kind: "listmonk",
        source_id: String(event.campaign?.id ?? ""),
        metric: "email_open_rate",
        value: openRate,
        scope: { dept: "marketing" },
        title: `"${campaignName}" — ${(openRate * 100).toFixed(1)}% open rate (${stats.recipients ?? 0} recipients)`,
      });

      // Click-rate outcome (separate event, separate potential signal)
      if (stats.clicks !== undefined) {
        await recordOutcome({
          userId,
          document_id: documentId,
          source_kind: "listmonk",
          source_id: String(event.campaign?.id ?? ""),
          metric: "email_click_rate",
          value: clickRate,
          scope: { dept: "marketing" },
          title: `"${campaignName}" — ${(clickRate * 100).toFixed(1)}% click rate`,
        });
      }
    } else if (kind === "subscriber.bounced") {
      await recordOutcome({
        userId,
        document_id: documentId,
        source_kind: "listmonk",
        metric: "email_hard_bounce",
        value: 1,
        scope: { dept: "marketing" },
        title: `Email bounced — ${event.subscriber?.email ?? "unknown"}`,
      });
    } else if (kind === "subscriber.complaint") {
      await recordOutcome({
        userId,
        document_id: documentId,
        source_kind: "listmonk",
        metric: "email_complaint",
        value: 1,
        scope: { dept: "marketing" },
        title: `Abuse complaint — ${event.subscriber?.email ?? "unknown"}`,
      });
    } else {
      console.log("[listmonk.webhook] unhandled event", { kind });
    }
  } catch (err) {
    console.error("[listmonk.webhook] processing error:", err);
  }

  return Response.json({ ok: true });
}
