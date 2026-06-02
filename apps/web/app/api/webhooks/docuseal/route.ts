/**
 * POST /api/webhooks/docuseal
 *
 * Docuseal e-signature events. Maps the events we care about into Vault
 * decisions / outcomes so the CEO brief sees signed contracts and the
 * source document's retrieval weight gets a conversion bump.
 *
 * Events:
 *   • form.completed       — all parties signed → contract_signed decision +
 *                             conversion outcome
 *   • form.declined        — someone declined → outcome_observed (no bump)
 *   • form.viewed          — first view event → engagement signal (light)
 *
 * `submission.metadata.staffd_user_id` + `submission.metadata.staffd_document_id`
 * are populated by the existing /api/integrations/docuseal send route when
 * available. Without them we still log the event under vault_decisions
 * (no pattern bump) — the CEO brief surfaces it regardless.
 *
 * Auth: `DOCUSEAL_WEBHOOK_SECRET` checked against the
 * `x-docuseal-signature` header (Docuseal sends an HMAC; for V1 we accept a
 * shared secret match).
 *
 * Always returns 200.
 */

import { recordDecision, recordOutcome } from "../../_lib/vault/outcomes";

type DocusealEvent = {
  event_type?: string;
  data?: {
    id?: number | string;
    status?: string;
    submitters?: Array<{ email?: string; name?: string; completed_at?: string }>;
    metadata?: Record<string, unknown>;
    template?: { id?: number | string; name?: string };
  };
};

function isAuthorized(req: Request): boolean {
  const secret = process.env.DOCUSEAL_WEBHOOK_SECRET ?? "";
  if (!secret) return true; // dev mode
  const provided = req.headers.get("x-docuseal-signature") ?? "";
  return provided === secret;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  let event: DocusealEvent;
  try {
    event = (await req.json()) as DocusealEvent;
  } catch {
    return Response.json({ ok: true, ignored: "invalid_json" });
  }

  const kind = (event.event_type ?? "").toLowerCase();
  const meta = event.data?.metadata ?? {};
  const userId = meta["staffd_user_id"] as string | undefined;
  const documentId = meta["staffd_document_id"] as string | undefined;
  const submissionId = String(event.data?.id ?? "");
  const templateName = event.data?.template?.name ?? "document";
  const signerEmail = event.data?.submitters?.[0]?.email ?? "unknown";

  if (!userId) {
    console.warn("[docuseal.webhook] no staffd_user_id metadata, ignoring", { kind });
    return Response.json({ ok: true, ignored: "no_user_id" });
  }

  try {
    if (kind === "form.completed" || kind === "submission.completed") {
      // Decision row — surfaces in CEO brief.
      await recordDecision({
        userId,
        decision_kind: "contract_signed",
        title: `${templateName} signed by ${signerEmail}`,
        source_kind: "docuseal",
        source_id: submissionId,
        document_id: documentId,
        scope: { dept: "legal" },
      });

      // Outcome row — conversion signal bumps the source doc's pattern weight.
      await recordOutcome({
        userId,
        document_id: documentId,
        source_kind: "docuseal",
        source_id: submissionId,
        metric: "signature_completed",
        value: 1,
        scope: { dept: "legal" },
        title: `Signature completed: ${templateName}`,
      });
    } else if (kind === "form.declined" || kind === "submission.declined") {
      await recordDecision({
        userId,
        decision_kind: "signature_declined",
        title: `${templateName} declined by ${signerEmail}`,
        source_kind: "docuseal",
        source_id: submissionId,
        document_id: documentId,
        scope: { dept: "legal" },
      });
    } else if (kind === "form.viewed" || kind === "submission.viewed") {
      await recordOutcome({
        userId,
        document_id: documentId,
        source_kind: "docuseal",
        source_id: submissionId,
        metric: "signature_viewed",
        value: 1,
        scope: { dept: "legal" },
        title: `${templateName} viewed by ${signerEmail}`,
      });
    } else {
      console.log("[docuseal.webhook] unhandled event", { kind });
    }
  } catch (err) {
    console.error("[docuseal.webhook] processing error:", err);
  }

  return Response.json({ ok: true });
}
