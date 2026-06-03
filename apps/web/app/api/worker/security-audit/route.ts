/**
 * GET /api/worker/security-audit — Daily cron.
 *
 * PR-Bundle-10-Security-Audit. Wraps /api/admin/verify-row-rules in a
 * cron-safe handler that fires once daily at 2 AM UTC (per vercel.json).
 *
 * Auth: same dual-path as other workers — `Bearer ${CRON_SECRET}` (Vercel
 * cron-injected) OR `x-worker-secret: ${WORKER_SECRET}` (manual trigger
 * via curl).
 *
 * Behaviour:
 *   • Calls the verify-row-rules core logic in-process (no self-HTTP)
 *   • Logs structured findings to console for Vercel log capture
 *   • Returns 200 with the report regardless of gap count — gaps are
 *     findings, not handler errors
 *   • Future: write findings to super_admin_signals (ships with Tranche 6
 *     PR-Super-Admin-Intelligence-A) for trend tracking + admin alerts
 *
 * Cannot import the route handler directly (Next.js route modules export
 * an HTTP handler, not the inner logic). The simplest cron-safe shape is
 * to re-call the same endpoint with an admin-side service request, but
 * that doubles auth hops. Instead this worker duplicates the small
 * verification logic in-line so the cron is fully self-contained.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";

type RuleSet = {
  list: string | null;
  view: string | null;
  create: string | null;
  update: string | null;
  delete: string | null;
};

const USER_OWNED: RuleSet = {
  list: "user = @request.auth.id",
  view: "user = @request.auth.id",
  create: "user = @request.auth.id",
  update: "user = @request.auth.id",
  delete: "user = @request.auth.id",
};

const AGENCY_OWNED: RuleSet = {
  ...USER_OWNED,
  list: "agency_user = @request.auth.id",
  view: "agency_user = @request.auth.id",
  create: "agency_user = @request.auth.id",
  update: "agency_user = @request.auth.id",
  delete: "agency_user = @request.auth.id",
};

const DOCUMENT_VERSIONS_RELATIONAL: RuleSet = {
  list: "document.user = @request.auth.id",
  view: "document.user = @request.auth.id",
  create: "document.user = @request.auth.id",
  update: "document.user = @request.auth.id",
  delete: "document.user = @request.auth.id",
};

const USERS_SYSTEM: RuleSet = {
  list: null,
  view: "id = @request.auth.id",
  create: null,
  update: "id = @request.auth.id",
  delete: "id = @request.auth.id",
};

const EXPECTED: Array<{ name: string; expected: RuleSet }> = [
  { name: "subscriptions", expected: USER_OWNED },
  { name: "businesses", expected: USER_OWNED },
  { name: "documents", expected: USER_OWNED },
  { name: "vault_briefs", expected: USER_OWNED },
  { name: "vault_decisions", expected: USER_OWNED },
  { name: "vault_patterns", expected: USER_OWNED },
  { name: "vault_retrieval_metrics", expected: USER_OWNED },
  { name: "vault_voice_profile", expected: USER_OWNED },
  { name: "vault_embeddings_index", expected: USER_OWNED },
  { name: "vault_ingest_queue", expected: USER_OWNED },
  { name: "conversations", expected: USER_OWNED },
  { name: "conversation_threads", expected: USER_OWNED },
  { name: "push_subscriptions", expected: USER_OWNED },
  { name: "scheduled_content", expected: USER_OWNED },
  { name: "bookings", expected: USER_OWNED },
  { name: "orchestrator_decisions", expected: USER_OWNED },
  { name: "clients", expected: AGENCY_OWNED },
  { name: "document_versions", expected: DOCUMENT_VERSIONS_RELATIONAL },
  { name: "users", expected: USERS_SYSTEM },
  { name: "templates", expected: USER_OWNED },
];

function authOk(req: Request): boolean {
  const cron = process.env.CRON_SECRET ?? "";
  const worker = process.env.WORKER_SECRET ?? "";
  const authHeader = req.headers.get("authorization") ?? "";
  const workerHeader = req.headers.get("x-worker-secret") ?? "";
  if (cron && authHeader === `Bearer ${cron}`) return true;
  if (worker && workerHeader === worker) return true;
  return false;
}

async function fetchRules(token: string, name: string): Promise<RuleSet | null> {
  try {
    const url = pbUrl();
    const res = await fetch(`${url}/api/collections/${encodeURIComponent(name)}`, {
      headers: { Authorization: token },
    });
    if (!res.ok) return null;
    const col = (await res.json()) as {
      listRule?: string | null;
      viewRule?: string | null;
      createRule?: string | null;
      updateRule?: string | null;
      deleteRule?: string | null;
    };
    return {
      list: col.listRule ?? null,
      view: col.viewRule ?? null,
      create: col.createRule ?? null,
      update: col.updateRule ?? null,
      delete: col.deleteRule ?? null,
    };
  } catch {
    return null;
  }
}

function compareRules(expected: RuleSet, actual: RuleSet): string[] {
  const gaps: string[] = [];
  const fields: (keyof RuleSet)[] = ["list", "view", "create", "update", "delete"];
  const norm = (s: string | null) => (s ?? "").replace(/\s+/g, "").trim();
  for (const f of fields) {
    if (norm(expected[f]) === norm(actual[f])) continue;
    gaps.push(`${f}: expected=${expected[f]} | actual=${actual[f]}`);
  }
  return gaps;
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

  for (const entry of EXPECTED) {
    const actual = await fetchRules(adminToken, entry.name);
    if (!actual) {
      findings.push({ name: entry.name, status: "🔴", gaps: ["collection_not_found"] });
      redCount++;
      totalGaps++;
      continue;
    }
    const gaps = compareRules(entry.expected, actual);
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
    // Surface clearly in Vercel logs. Tranche 6 PR-Super-Admin-Intelligence-A
    // will route this into super_admin_signals + email ADMIN_EMAIL.
    console.error(
      `[security-audit] 🔴 ${redCount} collection(s) failed verification — ${totalGaps} gaps`,
      { summary, flagged: findings.filter((f) => f.status === "🔴") },
    );
  } else {
    console.log(`[security-audit] ✅ ${findings.length} collections verified — no gaps`, { summary });
  }

  return Response.json({ ok: true, ...summary, findings });
}
