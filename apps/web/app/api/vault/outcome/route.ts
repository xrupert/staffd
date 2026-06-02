/**
 * POST /api/vault/outcome — unified outcome ingestion endpoint (Phase 5).
 *
 * Webhook receivers under `/api/webhooks/*` translate their upstream payloads
 * and call `_lib/vault/outcomes` directly (no self-HTTP). This endpoint is
 * the PUBLIC contract for:
 *   • manual operator events ("we just signed Acme — log it")
 *   • future third-party integrations that don't have a dedicated receiver
 *   • admin debugging
 *
 * Auth: shared bearer token via the `Authorization: Bearer <secret>` header.
 * Accepted secrets (any one): `OUTCOME_WEBHOOK_SECRET`, `WORKER_SECRET`.
 *
 * Two body shapes, discriminated by `type`:
 *
 *   { type: "outcome", userId, source_kind, metric, value, document_id?, ... }
 *   { type: "decision", userId, decision_kind, title, ... }
 */

import { recordOutcome, recordDecision, type OutcomeSourceKind } from "../../_lib/vault/outcomes";

function isAuthorized(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const outcomeSecret = process.env.OUTCOME_WEBHOOK_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  if (outcomeSecret && auth === `Bearer ${outcomeSecret}`) return true;
  if (workerSecret && auth === `Bearer ${workerSecret}`) return true;
  return false;
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const type = body.type as string | undefined;
  if (type !== "outcome" && type !== "decision") {
    return Response.json({ error: "type must be 'outcome' or 'decision'" }, { status: 400 });
  }

  const userId = body.userId as string | undefined;
  if (!userId) {
    return Response.json({ error: "userId required" }, { status: 400 });
  }

  if (type === "outcome") {
    const result = await recordOutcome({
      userId,
      client: (body.client as string | undefined) ?? null,
      document_id: body.document_id as string | undefined,
      source_kind: (body.source_kind as OutcomeSourceKind) ?? "manual",
      source_id: body.source_id as string | undefined,
      metric: (body.metric as string) ?? "",
      value: typeof body.value === "number" ? body.value : Number(body.value ?? 0),
      signal: body.signal as RecordOutcomeSignal,
      observed_at: body.observed_at as string | undefined,
      scope: body.scope as Record<string, unknown> | undefined,
      title: body.title as string | undefined,
    });
    return Response.json(result);
  }

  // type === "decision"
  const result = await recordDecision({
    userId,
    client: (body.client as string | undefined) ?? null,
    decision_kind: (body.decision_kind as string) ?? "manual",
    title: (body.title as string) ?? "(untitled)",
    source_kind: (body.source_kind as OutcomeSourceKind | undefined),
    source_id: body.source_id as string | undefined,
    document_id: body.document_id as string | undefined,
    scope: body.scope as Record<string, unknown> | undefined,
    impact: body.impact as Record<string, unknown> | undefined,
    expires_at: body.expires_at as string | undefined,
  });
  return Response.json(result);
}

type RecordOutcomeSignal = Parameters<typeof recordOutcome>[0]["signal"];
