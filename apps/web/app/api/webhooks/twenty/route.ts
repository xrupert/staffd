/**
 * POST /api/webhooks/twenty
 *
 * Twenty CRM events. We listen for opportunity stage changes (deal moved
 * to closed-won, etc.) and meeting bookings so the CEO brief sees real
 * sales motion and the source document (the proposal / email STAFFD
 * generated) gets a conversion bump when it can be linked.
 *
 * Events:
 *   • opportunity.updated → if stage transitions to closed-won → decision
 *   • activity.created    → meeting / call → decision (kind=meeting_booked)
 *
 * STAFFD user mapping: Twenty's webhook payload includes the workspace it
 * came from. The existing /api/integrations/twenty route stores STAFFD's
 * user id in opportunity metadata when contacts/opportunities are pushed.
 * Without that mapping the event is logged + 200 (no Vault write).
 *
 * Auth: `TWENTY_WEBHOOK_SECRET` against `x-twenty-secret` header. Skipped
 * when env unset (dev mode).
 *
 * Always returns 200.
 */

import { recordDecision, recordOutcome } from "../../_lib/vault/outcomes";

type TwentyEvent = {
  eventName?: string;
  recordId?: string;
  workspaceId?: string;
  objectMetadata?: { nameSingular?: string };
  record?: Record<string, unknown> & {
    stage?: string;
    amount?: number;
    name?: string;
    metadata?: Record<string, unknown>;
  };
  updatedFields?: string[];
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.TWENTY_WEBHOOK_SECRET ?? "";
  if (!secret) return true; // dev mode
  const provided = req.headers.get("x-twenty-secret") ?? "";
  return provided === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let event: TwentyEvent;
  try {
    event = (await req.json()) as TwentyEvent;
  } catch {
    return Response.json({ ok: true, ignored: "invalid_json" });
  }

  const eventName = (event.eventName ?? "").toLowerCase();
  const meta = event.record?.metadata ?? {};
  const userId = meta["staffd_user_id"] as string | undefined;
  const documentId = meta["staffd_document_id"] as string | undefined;
  const recordName = event.record?.name as string | undefined;
  const recordId = event.recordId ?? "";

  if (!userId) {
    console.warn("[twenty.webhook] no staffd_user_id metadata, ignoring", { eventName });
    return Response.json({ ok: true, ignored: "no_user_id" });
  }

  try {
    const objectKind = event.objectMetadata?.nameSingular ?? "";

    // Opportunity stage change → if closed-won, mark as deal_closed.
    if (objectKind === "opportunity" && eventName.includes("updated")) {
      const stage = String(event.record?.stage ?? "").toLowerCase();
      if (stage.includes("won") || stage.includes("closed_won") || stage.includes("closed-won")) {
        const amount = typeof event.record?.amount === "number" ? event.record.amount : undefined;
        await recordDecision({
          userId,
          decision_kind: "deal_closed",
          title: `Deal won: ${recordName ?? "opportunity"}${amount ? ` ($${amount.toLocaleString()})` : ""}`,
          source_kind: "twenty",
          source_id: recordId,
          document_id: documentId,
          scope: { dept: "sales" },
          impact: amount !== undefined
            ? { metric: "revenue", value: amount, currency: "usd" }
            : undefined,
        });

        await recordOutcome({
          userId,
          document_id: documentId,
          source_kind: "twenty",
          source_id: recordId,
          metric: "deal_closed",
          value: 1,
          scope: { dept: "sales" },
          title: `Deal won: ${recordName ?? "opportunity"}`,
        });
      }
    } else if (objectKind === "activity" && eventName.includes("created")) {
      // Meeting / call logged in CRM.
      await recordDecision({
        userId,
        decision_kind: "meeting_booked",
        title: `Activity logged: ${recordName ?? "meeting"}`,
        source_kind: "twenty",
        source_id: recordId,
        document_id: documentId,
        scope: { dept: "sales" },
      });
    } else {
      console.log("[twenty.webhook] unhandled event", { eventName, objectKind });
    }
  } catch (err) {
    console.error("[twenty.webhook] processing error:", err);
  }

  return Response.json({ ok: true });
}
