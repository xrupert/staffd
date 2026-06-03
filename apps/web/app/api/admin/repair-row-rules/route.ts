/**
 * POST /api/admin/repair-row-rules
 *
 * Decision 69 — Security Floor Restoration via Code.
 *
 * Bulk-PATCH every user-scoped collection's row rules to match the
 * canonical expected pattern in `_lib/security/row-rules`. Idempotent —
 * collections already at the expected state report `already-correct`
 * without a PB write.
 *
 * Auth: super-admin (ADMIN_EMAIL match via whoAmI). Same pattern as
 * verify-row-rules. CRON_SECRET deliberately NOT used — this is a
 * manual admin trigger, not a scheduled job.
 *
 * Operator flow:
 *   1. Sign in as ADMIN_EMAIL
 *   2. Navigate to /dashboard/admin/security
 *   3. Click "Run Security Repair" (only visible when overall_status is 🔴)
 *   4. Wait ~30-60 sec for repair to complete
 *   5. Dashboard refreshes; verify all ✅
 */

import { pbUrl } from "../../_lib/pb";
import {
  EXPECTED_COLLECTIONS,
  ensureCollectionRulesWithFreshToken,
  type EnsureResult,
  type RuleSet,
} from "../../_lib/security/row-rules";

type RepairStatus =
  | "✅ already-correct"
  | "✅ repaired"
  | "ℹ️ skipped-system-managed"
  | "🔴 skipped-not-found"
  | "🔴 failed";

type CollectionRepair = {
  collection: string;
  before: RuleSet | null;
  after: RuleSet | null;
  status: RepairStatus;
  error: string | null;
};

type RepairReport = {
  timestamp: string;
  repairs: CollectionRepair[];
  overall_status: "✅ all repaired" | "🔴 N failures" | string;
  total_repaired: number;
  total_already_correct: number;
  total_skipped: number;
  total_failed: number;
};

async function whoAmI(pbToken: string): Promise<{ id: string; email: string } | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/users/auth-refresh`, {
      method: "POST",
      headers: { Authorization: pbToken },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { record?: { id?: string; email?: string } };
    if (!data.record?.id || !data.record?.email) return null;
    return { id: data.record.id, email: data.record.email };
  } catch {
    return null;
  }
}

function mapResultToReport(name: string, result: EnsureResult): CollectionRepair {
  switch (result.status) {
    case "already-correct":
      return {
        collection: name,
        before: result.before,
        after: result.after,
        status: "✅ already-correct",
        error: null,
      };
    case "repaired":
      return {
        collection: name,
        before: result.before,
        after: result.after,
        status: "✅ repaired",
        error: null,
      };
    case "skipped-system-managed":
      return {
        collection: name,
        before: result.before,
        after: null,
        status: "ℹ️ skipped-system-managed",
        error: null,
      };
    case "skipped-not-found":
      return {
        collection: name,
        before: null,
        after: null,
        status: "🔴 skipped-not-found",
        error: result.reason,
      };
    case "failed":
      return {
        collection: name,
        before: result.before,
        after: null,
        status: "🔴 failed",
        error: result.reason,
      };
  }
}

export async function POST(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const pbToken = url.searchParams.get("pbToken") ?? req.headers.get("authorization") ?? "";
  if (!pbToken) return Response.json({ error: "missing_auth" }, { status: 401 });

  const me = await whoAmI(pbToken);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  const adminEmail = (process.env.ADMIN_EMAIL ?? "").trim().toLowerCase();
  if (!adminEmail) {
    return Response.json({ error: "admin_not_configured" }, { status: 503 });
  }
  if (me.email.trim().toLowerCase() !== adminEmail) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const repairs: CollectionRepair[] = [];
  for (const entry of EXPECTED_COLLECTIONS) {
    const result = await ensureCollectionRulesWithFreshToken(entry.name);
    repairs.push(mapResultToReport(entry.name, result));
  }

  const totals = repairs.reduce(
    (acc, r) => {
      if (r.status === "✅ repaired") acc.repaired++;
      else if (r.status === "✅ already-correct") acc.alreadyCorrect++;
      else if (r.status === "ℹ️ skipped-system-managed") acc.skipped++;
      else if (r.status === "🔴 failed" || r.status === "🔴 skipped-not-found") acc.failed++;
      return acc;
    },
    { repaired: 0, alreadyCorrect: 0, skipped: 0, failed: 0 },
  );

  const overall =
    totals.failed === 0
      ? "✅ all repaired"
      : `🔴 ${totals.failed} failure${totals.failed === 1 ? "" : "s"}`;

  const report: RepairReport = {
    timestamp: new Date().toISOString(),
    repairs,
    overall_status: overall,
    total_repaired: totals.repaired,
    total_already_correct: totals.alreadyCorrect,
    total_skipped: totals.skipped,
    total_failed: totals.failed,
  };

  return Response.json(report);
}
