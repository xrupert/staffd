/**
 * GET /api/worker/muapi-catalog-sync (W95.7.3d-T1) — hourly Vercel cron that
 * refreshes the generation_models cache from Muapi's public /api/v1/models.
 * Auth: CRON_SECRET Bearer (Vercel cron) or WORKER_SECRET header (manual).
 * Routing-slug drift (C5) is surfaced in the response/logs, not fatal — the
 * catalog still syncs so generation keeps working.
 *
 * W95.7.3d-h3 — catalog drift signal. When the sync detects risk-bearing change
 * (a price/tier move = margin risk per Standard #33, a routed model vanishing,
 * or routing-slug drift = generation-impacting), it emits a structured
 * `[catalog-drift]` log line. That's the V1 alerting channel, matching the
 * security-audit cron (console-logs structured findings). Operator-email /
 * persisted signal row are deferred to the shared `super_admin_signals`
 * mechanism (see security-audit runbook) so both crons use one path — not a
 * bespoke email here. New models are reported but are not alert-worthy.
 */

import { syncMuapiCatalog } from "../../_lib/generation/catalog";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  const cronSecret = process.env.CRON_SECRET ?? "";
  const workerSecret = process.env.WORKER_SECRET ?? "";
  const validCron = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const validManual = workerSecret && workerHeader === workerSecret;
  if (!validCron && !validManual) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const result = await syncMuapiCatalog();
  console.log(`muapi-catalog-sync: ok=${result.ok} fetched=${result.fetched} upserted=${result.upserted}${result.routingDrift ? ` routingDrift=${result.routingDrift.join(",")}` : ""}`);

  const d = result.drift;
  const alertWorthy =
    (result.routingDrift?.length ?? 0) > 0 ||
    (d?.priceChanges.length ?? 0) > 0 ||
    (d?.removedModels.length ?? 0) > 0;
  if (alertWorthy) {
    console.warn(`[catalog-drift] ${JSON.stringify({
      at: new Date().toISOString(),
      routingDrift: result.routingDrift ?? [],
      priceChanges: d?.priceChanges ?? [],
      removedModels: d?.removedModels ?? [],
      newModels: d?.newModels ?? [],
    })}`);
  }

  return Response.json(result);
}
