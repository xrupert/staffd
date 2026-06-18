/**
 * GET /api/admin/usage — fleet-wide usage aggregator (W92).
 *
 * One super-admin-gated endpoint returning the payload for all four tabs of
 * /dashboard/admin/usage: Users, Departments, Integrations, Workflows.
 *
 * Read-only. Counts use PB's O(1) `totalItems` (perPage=1 + filter) where
 * possible; list aggregations are CAPPED bounded scans (see comments) — at
 * 10k+ users these must move to server-side grouping / pagination.
 *
 * No new logging, no new collections (Standard #20): everything here is
 * derived from existing PB data + the existing super_admin_usage_log.
 */

import { getAdminToken, pbUrl } from "../../_lib/pb";
import { requireSuperAdmin, toAuthErrorResponse } from "../../_lib/auth/super-admin";
import { effectivePlan } from "../../_lib/comp";
import {
  classifyUser,
  lastActivityProxy,
  activityBucket,
  churnState,
  taskSuccessRate,
  type UserType,
  type ActivityBucket,
} from "../../_lib/usage";

// Bounded-scan caps — paginate / server-group at scale.
const USER_CAP = 500;
const DOC_CAP = 2000;
const CONVO_CAP = 2000;
const WF_CAP = 1000;
const DECISION_CAP = 2000;
const ROSTER_CAP = 100;
const SPECIALIST_TOP = 12;
const TRANSITION_RECENT = 30;

const KNOWN_INTEGRATIONS: { key: string; label: string; env: string }[] = [
  { key: "email", label: "Email Campaigns", env: "LISTMONK_URL" },
  { key: "pipeline", label: "Sales Pipeline", env: "TWENTY_API_KEY" },
  { key: "inbox", label: "Support Inbox", env: "CHATWOOT_API_KEY" },
  { key: "analytics", label: "Site Analytics", env: "PLAUSIBLE_API_KEY" },
];

async function totalItems(url: string, token: string): Promise<number> {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) return 0;
  return ((await res.json()) as { totalItems?: number }).totalItems ?? 0;
}

async function listItems<T>(url: string, token: string): Promise<T[]> {
  const res = await fetch(url, { headers: { Authorization: token } });
  if (!res.ok) return [];
  return ((await res.json()) as { items?: T[] }).items ?? [];
}

export async function GET(req: Request) {
  let me: { id: string; email: string };
  try {
    me = await requireSuperAdmin(req);
  } catch (err) {
    return toAuthErrorResponse(err);
  }

  let token: string;
  try {
    token = await getAdminToken();
  } catch {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }

  const pb = pbUrl();
  const now = new Date();
  const adminEmail = me.email; // operator identity drives classification

  type UserRow = { id: string; email: string; created: string };
  type SubRow = { user: string; plan?: string; active_until?: string; image_credits_used?: number; video_credits_used?: number; agent_credits_topup?: number };
  type DocRow = { user: string; department: string; agent_name?: string; created: string };
  type ActRow = { user: string; created: string };
  type WfRow = { user: string; status: string; created: string; completed_at?: string | null };
  type DecRow = { decision_kind?: string; user?: string };
  type LogRow = { operation_detail?: string; created?: string; user?: string };
  type BizRow = { user: string; plausible_site_id?: string };

  const [users, subs, docs, convos, workflows, decisions, transitions, businesses, taskTotal, taskSucceeded] = await Promise.all([
    listItems<UserRow>(`${pb}/api/collections/users/records?perPage=${USER_CAP}&fields=id,email,created&sort=-created`, token), // Capped at USER_CAP — paginate at scale.
    listItems<SubRow>(`${pb}/api/collections/subscriptions/records?perPage=${USER_CAP}&fields=user,plan,active_until,image_credits_used,video_credits_used,agent_credits_topup`, token),
    listItems<DocRow>(`${pb}/api/collections/documents/records?perPage=${DOC_CAP}&fields=user,department,agent_name,created&sort=-created`, token), // Capped at DOC_CAP — paginate at scale.
    listItems<ActRow>(`${pb}/api/collections/conversations/records?perPage=${CONVO_CAP}&fields=user,created&sort=-created`, token), // Capped at CONVO_CAP — paginate at scale.
    listItems<WfRow>(`${pb}/api/collections/workflows/records?perPage=${WF_CAP}&fields=user,status,created,completed_at&sort=-created`, token), // Capped at WF_CAP — paginate at scale.
    listItems<DecRow>(`${pb}/api/collections/vault_decisions/records?perPage=${DECISION_CAP}&fields=decision_kind,user`, token), // Capped at DECISION_CAP — paginate at scale.
    listItems<LogRow>(`${pb}/api/collections/super_admin_usage_log/records?filter=${encodeURIComponent(`operation_type = "workflow_transition"`)}&perPage=${TRANSITION_RECENT}&sort=-created&fields=operation_detail,created,user`, token),
    listItems<BizRow>(`${pb}/api/collections/businesses/records?perPage=${USER_CAP}&fields=user,plausible_site_id`, token), // W95.6.y — site-per-customer provisioning state.
    totalItems(`${pb}/api/collections/workflow_tasks/records?perPage=1&fields=id`, token),
    totalItems(`${pb}/api/collections/workflow_tasks/records?filter=${encodeURIComponent(`status = "succeeded"`)}&perPage=1&fields=id`, token),
  ]);

  // Per-user last-activity proxy: max(created) across docs / convos / workflows.
  const lastByUser = new Map<string, string[]>();
  const push = (u: string, d: string) => { const a = lastByUser.get(u) ?? []; a.push(d); lastByUser.set(u, a); };
  for (const d of docs) push(d.user, d.created);
  for (const c of convos) push(c.user, c.created);
  for (const w of workflows) push(w.user, w.created);

  const docCountByUser = new Map<string, number>();
  for (const d of docs) docCountByUser.set(d.user, (docCountByUser.get(d.user) ?? 0) + 1);

  const subByUser = new Map<string, SubRow>();
  for (const s of subs) subByUser.set(s.user, s);

  // W95.6.y — per-customer Plausible site id (operator-provisioned, no Sites API).
  const plausibleByUser = new Map<string, string>();
  for (const b of businesses) if (b.plausible_site_id) plausibleByUser.set(b.user, b.plausible_site_id);

  // ── Tab 1: Users ──
  const byType: Record<UserType, number> = { "super-admin": 0, comp: 0, customer: 0 };
  const byPlan: Record<string, number> = { starter: 0, growth: 0, pro: 0, agency: 0, none: 0 };
  const activity: Record<ActivityBucket, number> = { active7: 0, active30: 0, dormant: 0, never: 0 };
  let expired = 0, expiring = 0;
  const roster: unknown[] = [];

  for (const u of users) {
    const type = classifyUser(u.email, adminEmail);
    byType[type]++;
    const sub = subByUser.get(u.id);
    // W92.1 — display the EFFECTIVE tier: comp/operator accounts operate at
    // Agency even though their stored plan is still "starter".
    const plan = effectivePlan(u.email, sub?.plan as string | undefined, adminEmail);
    byPlan[plan] = (byPlan[plan] ?? 0) + 1;
    const last = lastActivityProxy(lastByUser.get(u.id) ?? []);
    activity[activityBucket(last, now)]++;
    const churn = churnState(sub?.active_until, now);
    if (churn === "expired") expired++;
    else if (churn === "expiring") expiring++;
    if (roster.length < ROSTER_CAP) {
      roster.push({ id: u.id, email: u.email, type, plan, lastActivity: last, docCount: docCountByUser.get(u.id) ?? 0, churn, isOperator: type !== "customer", plausibleSiteId: plausibleByUser.get(u.id) ?? null });
    }
  }

  // ── Tab 2: Departments ──
  const deptMap = new Map<string, { count: number; lastAt: string }>();
  const specMap = new Map<string, { agent_name: string; department: string; count: number }>();
  for (const d of docs) {
    const dept = d.department || "unknown";
    const de = deptMap.get(dept) ?? { count: 0, lastAt: d.created };
    de.count++; if (d.created > de.lastAt) de.lastAt = d.created;
    deptMap.set(dept, de);
    if (d.agent_name) {
      const se = specMap.get(d.agent_name) ?? { agent_name: d.agent_name, department: dept, count: 0 };
      se.count++; specMap.set(d.agent_name, se);
    }
  }
  const byDept = Array.from(deptMap.entries()).map(([department, v]) => ({ department, count: v.count, lastAt: v.lastAt })).sort((a, b) => b.count - a.count);
  const specialists = Array.from(specMap.values()).sort((a, b) => b.count - a.count).slice(0, SPECIALIST_TOP);

  // ── Tab 3: Integrations ──
  const health = KNOWN_INTEGRATIONS.map((i) => ({ key: i.key, label: i.label, connected: !!(process.env[i.env] ?? "").trim() }));
  const outMap = new Map<string, number>();
  for (const d of decisions) { const k = d.decision_kind || "unknown"; outMap.set(k, (outMap.get(k) ?? 0) + 1); }
  const outcomes = Array.from(outMap.entries()).map(([decision_kind, count]) => ({ decision_kind, count })).sort((a, b) => b.count - a.count);

  // ── Tab 4: Workflows ──
  const byStatus: Record<string, number> = { pending: 0, running: 0, completed: 0, failed: 0, partial: 0 };
  for (const w of workflows) byStatus[w.status] = (byStatus[w.status] ?? 0) + 1;

  // W95.2 — vendor mirror-retry health (Model B3 mirror discipline). Capped scan.
  const mirrorTasks = await listItems<{ status?: string }>(
    `${pb}/api/collections/workflow_tasks/records?filter=${encodeURIComponent(`specialist_id = "mirror_retry_worker"`)}&perPage=200&fields=status`,
    token,
  );
  const mirrorRetry: Record<string, number> = { pending: 0, retrying: 0, succeeded: 0, failed: 0 };
  for (const t of mirrorTasks) { const s = (t.status as string) || "pending"; mirrorRetry[s] = (mirrorRetry[s] ?? 0) + 1; }
  const recentTransitions = transitions.map((t) => ({ detail: t.operation_detail ?? "", at: t.created ?? "", user: t.user ?? "" }));
  // Transition velocity over the last 7 days (bucketed by day).
  const velocity7d: { date: string; count: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const day = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    velocity7d.push({ date: day, count: recentTransitions.filter((t) => (t.at || "").slice(0, 10) === day).length });
  }

  return Response.json({
    users: { total: users.length, byType, byPlan, activity, churn: { expired, expiring }, roster },
    departments: { byDept, specialists },
    integrations: { health, outcomes, note: "Vendor backends are operator-shared infrastructure; partitioned per-customer data lives in STAFFD-native collections (W95)." },
    workflows: {
      byStatus,
      taskSuccess: { succeeded: taskSucceeded, total: taskTotal, rate: taskSuccessRate(taskSucceeded, taskTotal) },
      recentTransitions,
      velocity7d,
      mirrorRetry,
    },
    meta: { generatedAt: now.toISOString(), caps: { USER_CAP, DOC_CAP, CONVO_CAP, WF_CAP, DECISION_CAP } },
  });
}
