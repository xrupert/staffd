/**
 * GET /api/admin/usage/[userId] — per-user metadata drill-in (W92).
 *
 * Super-admin gated. Returns METADATA ONLY (counts, plan, credits, last
 * activity, integration-outcome counts) — never conversation content or
 * document bodies (D4 privacy ruling). Every call writes a super_admin_audit_log
 * row via the existing logging helper (Standard #9 — no new logging substrate):
 * action_type "usage_drill_in", resource = userId.
 */

import { getAdminToken, pbEscape, pbUrl } from "../../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../../_lib/auth/super-admin";
import { logSuperAdminAccess } from "../../../_lib/auth/super-admin-logging";
import { classifyUser, lastActivityProxy } from "../../../_lib/usage";
import { effectivePlan } from "../../../_lib/comp";

type RouteContext = { params: Promise<{ userId: string }> };

const DECISION_CAP = 1000;

async function totalItems(url: string, token: string): Promise<number> {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) return 0;
  return ((await res.json()) as { totalItems?: number }).totalItems ?? 0;
}

export async function GET(req: Request, { params }: RouteContext) {
  const { userId } = await params;

  let me: { id: string; email: string };
  try {
    me = await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }
  if (!userId) return Response.json({ error: "missing_user_id" }, { status: 400 });

  // Audit the access (operator-acknowledged drill-in trail). Non-blocking.
  void logSuperAdminAccess(me, "usage_drill_in", userId, { request: req });

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  const pb = pbUrl();
  const esc = pbEscape(userId);
  const uf = encodeURIComponent(`user = "${esc}"`);

  // User + subscription (list-filter so this also resolves under test stubs).
  const userRes = await fetch(`${pb}/api/collections/users/records?filter=${encodeURIComponent(`id = "${esc}"`)}&perPage=1&fields=id,email,created`, { headers: { Authorization: token } });
  const user = userRes.ok ? ((await userRes.json()) as { items?: { id: string; email: string; created: string }[] }).items?.[0] : undefined;
  if (!user) return Response.json({ error: "not_found" }, { status: 404 });

  const subRes = await fetch(`${pb}/api/collections/subscriptions/records?filter=${uf}&perPage=1&fields=plan,active_until,image_credits_used,video_credits_used,agent_credits_topup`, { headers: { Authorization: token } });
  const sub = subRes.ok ? ((await subRes.json()) as { items?: Record<string, unknown>[] }).items?.[0] : undefined;

  const [documents, threads, workflows, lastDoc, lastConvo, lastWf, decisions] = await Promise.all([
    totalItems(`${pb}/api/collections/documents/records?filter=${uf}&perPage=1&fields=id`, token),
    totalItems(`${pb}/api/collections/conversation_threads/records?filter=${uf}&perPage=1&fields=id`, token),
    totalItems(`${pb}/api/collections/workflows/records?filter=${uf}&perPage=1&fields=id`, token),
    fetch(`${pb}/api/collections/documents/records?filter=${uf}&perPage=1&sort=-created&fields=created`, { headers: { Authorization: token } }),
    fetch(`${pb}/api/collections/conversations/records?filter=${uf}&perPage=1&sort=-created&fields=created`, { headers: { Authorization: token } }),
    fetch(`${pb}/api/collections/workflows/records?filter=${uf}&perPage=1&sort=-created&fields=created`, { headers: { Authorization: token } }),
    // Capped at DECISION_CAP — paginate at scale.
    fetch(`${pb}/api/collections/vault_decisions/records?filter=${uf}&perPage=${DECISION_CAP}&fields=decision_kind`, { headers: { Authorization: token } }),
  ]);

  const firstCreated = async (res: Response): Promise<string | null> => {
    if (!res.ok) return null;
    return ((await res.json()) as { items?: { created?: string }[] }).items?.[0]?.created ?? null;
  };
  const lastActivity = lastActivityProxy([await firstCreated(lastDoc), await firstCreated(lastConvo), await firstCreated(lastWf)]);

  const decRows = decisions.ok ? ((await decisions.json()) as { items?: { decision_kind?: string }[] }).items ?? [] : [];
  const outMap = new Map<string, number>();
  for (const d of decRows) { const k = d.decision_kind || "unknown"; outMap.set(k, (outMap.get(k) ?? 0) + 1); }
  const outcomes = Array.from(outMap.entries()).map(([decision_kind, count]) => ({ decision_kind, count })).sort((a, b) => b.count - a.count);

  return Response.json({
    ok: true,
    user: { id: user.id, email: user.email, type: classifyUser(user.email, me.email), plan: effectivePlan(user.email, sub?.plan as string | undefined, me.email), created: user.created, lastActivity },
    counts: {
      documents,
      threads,
      workflows,
      imageCredits: (sub?.image_credits_used as number) ?? 0,
      videoCredits: (sub?.video_credits_used as number) ?? 0,
      agentCreditsTopup: (sub?.agent_credits_topup as number) ?? 0,
    },
    outcomes,
  });
}
