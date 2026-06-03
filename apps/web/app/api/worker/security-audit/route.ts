/**
 * GET /api/worker/security-audit — Daily cron (0 2 * * *).
 *
 * Wraps the same verification logic as /api/admin/verify-row-rules but
 * with cron-style auth (CRON_SECRET / WORKER_SECRET) and console logging
 * for Vercel log capture.
 *
 * Per Decision 69 refactor — imports expected rules from the shared
 * registry. No duplicate enum here.
 *
 * Returns 200 on gaps (gaps are findings, not handler errors). When
 * Tranche 6 PR-Super-Admin-Intelligence-A ships, this cron also writes
 * to `super_admin_signals` + emails ADMIN_EMAIL on regression.
 */

import { getAdminToken } from "../../_lib/pb";
import {
  EXPECTED_COLLECTIONS,
  compareRules,
  fetchCollectionRules,
} from "../../_lib/security/row-rules";

function authOk(req: Request): boolean {
  const cron = process.env.CRON_SECRET ?? "";
  const worker = process.env.WORKER_SECRET ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  if (cron && authHeader === `Bearer ${cron}`) return true;
  if (worker && workerHeader === worker) return true;
  return false;
}

export async function GET(req: Request): Promise<Response> {
  if (!authOk(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  let adminToken: string;
  try {
    adminToken = await getAdminToken();
  } catch (err) {
    console.error("[security-audit] admin token failed:", err);
    return Response.json({ ok: false, error: "admin_token_failed" }, { status: 503 });
  }

  const findings: Array<{ name: string; status: "✅" | "🔴"; gaps: string[] }> = [];
  let redCount = 0;
  let totalGaps = 0;

  for (const entry of EXPECTED_COLLECTIONS) {
    const current = await fetchCollectionRules(adminToken, entry.name);
    if (!current) {
      findings.push({ name: entry.name, status: "🔴", gaps: ["collection_not_found"] });
      redCount++;
      totalGaps++;
      continue;
    }
    const gaps = compareRules(entry.rules, current.rules);
    if (gaps.length === 0) {
      findings.push({ name: entry.name, status: "✅", gaps: [] });
    } else {
      findings.push({ name: entry.name, status: "🔴", gaps });
      redCount++;
      totalGaps += gaps.length;
    }
  }

  const summary = {
    timestamp: new Date().toISOString(),
    collections_checked: findings.length,
    secure_collections: findings.length - redCount,
    flagged_collections: redCount,
    total_gaps: totalGaps,
  };

  if (redCount > 0) {
    console.error(
      `[security-audit] 🔴 ${redCount} collection(s) failed verification — ${totalGaps} gaps`,
      { summary, flagged: findings.filter((f) => f.status === "🔴") },
    );
  } else {
    console.log(`[security-audit] ✅ ${findings.length} collections verified — no gaps`, { summary });
  }

  return Response.json({ ok: true, ...summary, findings });
}
