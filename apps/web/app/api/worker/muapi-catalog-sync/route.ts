/**
 * GET /api/worker/muapi-catalog-sync (W95.7.3d-T1) — hourly Vercel cron that
 * refreshes the generation_models cache from Muapi's public /api/v1/models.
 * Auth: CRON_SECRET Bearer (Vercel cron) or WORKER_SECRET header (manual).
 * Routing-slug drift (C5) is surfaced in the response/logs, not fatal — the
 * catalog still syncs so generation keeps working.
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
  console.log(`muapi-catalog-sync: ok=${result.ok} fetched=${result.fetched} upserted=${result.upserted}${result.routingDrift ? ` drift=${result.routingDrift.join(",")}` : ""}`);
  return Response.json(result);
}
