/**
 * W92 — /api/admin/usage + /api/admin/usage/[userId] (runtime tests).
 *
 * Super-admin gated. The aggregator returns a payload shaped for all four
 * tabs; the drill-in returns per-user metadata AND writes a super_admin_audit_log
 * row (reusing the existing logging helper — Standard #9).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const adminMock = vi.hoisted(() => ({ ok: true }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({
  requireSuperAdmin: vi.fn(async () => {
    if (!adminMock.ok) {
      const e = new Error("forbidden") as Error & { __auth: boolean };
      e.__auth = true;
      throw e;
    }
    return { id: "admin", email: "chris.rupert@cybridagency.com" };
  }),
  toAuthErrorResponse: () => Response.json({ error: "forbidden" }, { status: 403 }),
}));

const accessMock = vi.hoisted(() => ({ fn: vi.fn(async (..._a: unknown[]) => {}) }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({
  logSuperAdminAccess: accessMock.fn,
}));

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin-token",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { GET as usageGET } from "../../app/api/admin/usage/route";
import { GET as drillGET } from "../../app/api/admin/usage/[userId]/route";

/** Canned PB responses keyed by URL substring. */
function stubPb(now = "2026-06-16T00:00:00Z") {
  const recent = "2026-06-14T00:00:00Z";
  void now;
  return vi.fn(async (url: string) => {
    const u = String(url);
    const json = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => "" });
    // O(1) totalItems counters (perPage=1)
    if (u.includes("workflow_tasks") && u.includes("status%20%3D%20%22succeeded%22")) return json({ totalItems: 3, items: [] });
    if (u.includes("workflow_tasks")) return json({ totalItems: 4, items: [] });
    if (u.includes("/users/records")) return json({ items: [
      { id: "u1", email: "jane@acme.com", created: "2026-05-01T00:00:00Z", hidden_from_user_lists: false },
      { id: "u2", email: "dana@jrw-solutions.com", created: "2026-03-01T00:00:00Z", hidden_from_user_lists: false },
      { id: "admin", email: "chris.rupert@cybridagency.com", created: "2026-01-01T00:00:00Z", hidden_from_user_lists: false },
    ] });
    if (u.includes("/subscriptions/records")) return json({ items: [
      { user: "u1", plan: "growth", active_until: "2026-09-01T00:00:00Z", image_credits_used: 5, video_credits_used: 0, agent_credits_topup: 0 },
      { user: "u2", plan: "starter", active_until: "2026-06-20T00:00:00Z", image_credits_used: 2, video_credits_used: 1, agent_credits_topup: 10 }, // comp user: stored "starter", effective "agency"
    ] });
    if (u.includes("/documents/records")) return json({ items: [
      { user: "u1", department: "marketing", agent_name: "Copywriter", created: recent },
      { user: "u1", department: "sales", agent_name: "SDR", created: "2026-06-02T00:00:00Z" },
      { user: "u2", department: "marketing", agent_name: "Copywriter", created: "2026-06-10T00:00:00Z" },
    ] });
    if (u.includes("/conversations/records")) return json({ items: [
      { user: "u1", created: recent },
    ] });
    if (u.includes("/workflows/records")) return json({ items: [
      { user: "u1", status: "completed", created: "2026-06-05T00:00:00Z", completed_at: "2026-06-06T00:00:00Z" },
      { user: "u2", status: "running", created: "2026-06-12T00:00:00Z", completed_at: null },
    ] });
    if (u.includes("/vault_decisions/records")) return json({ items: [
      { decision_kind: "campaign_sent", user: "u1" },
      { decision_kind: "campaign_sent", user: "u2" },
      { decision_kind: "crm_contact", user: "u1" },
    ] });
    if (u.includes("super_admin_usage_log")) return json({ items: [
      { operation_detail: "wf-1: running → completed", created: "2026-06-15T00:00:00Z", user: "u1" },
    ] });
    return json({ items: [], totalItems: 0 });
  });
}

beforeEach(() => {
  adminMock.ok = true;
  accessMock.fn.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

function req(url: string): Request { return new Request(url); }

describe("GET /api/admin/usage", () => {
  it("rejects a non-super-admin", async () => {
    adminMock.ok = false;
    const res = await usageGET(req("https://t/api/admin/usage"));
    expect(res.status).toBe(403);
  });

  it("returns a payload shaped for all four tabs", async () => {
    vi.stubGlobal("fetch", stubPb());
    const res = await usageGET(req("https://t/api/admin/usage"));
    expect(res.status).toBe(200);
    const d = await res.json();
    // Tab 1 — Users
    expect(d.users.total).toBe(3);
    expect(d.users.byType).toMatchObject({ "super-admin": 1, comp: 1, customer: 1 });
    // W92.1 — effective plan: the customer keeps "growth"; the comp user (u2)
    // and the operator both render as "agency" (stored plan ignored for comp).
    expect(d.users.byPlan).toMatchObject({ growth: 1, agency: 2 });
    expect(d.users.churn.expiring).toBeGreaterThanOrEqual(1); // u2 active_until within 14d
    const operatorRow = d.users.roster.find((r: { id: string }) => r.id === "admin");
    expect(operatorRow.type).toBe("super-admin");
    expect(operatorRow.plan).toBe("agency"); // W92.1 — operator shows effective Agency tier
    const compRow = d.users.roster.find((r: { email: string }) => r.email.includes("jrw-solutions"));
    expect(compRow.plan).toBe("agency"); // comp user shows Agency, not stored "starter"
    // Tab 2 — Departments
    expect(d.departments.byDept.find((x: { department: string }) => x.department === "marketing").count).toBe(2);
    expect(d.departments.specialists[0]).toHaveProperty("agent_name");
    // Tab 3 — Integrations (W91-rollback: operator health + outcomes + note;
    // the customer-adoption block is gone under Model B3).
    expect(d.integrations.outcomes.find((o: { decision_kind: string }) => o.decision_kind === "campaign_sent").count).toBe(2);
    expect(Array.isArray(d.integrations.health)).toBe(true);
    expect(d.integrations.adoption).toBeUndefined();
    expect(d.integrations.note).toMatch(/operator-shared|STAFFD-native|W95/i);
    // Tab 4 — Workflows
    expect(d.workflows.byStatus).toMatchObject({ completed: 1, running: 1 });
    expect(d.workflows.taskSuccess).toMatchObject({ succeeded: 3, total: 4, rate: 75 });
    expect(d.workflows.recentTransitions.length).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/admin/usage/[userId]", () => {
  it("rejects a non-super-admin", async () => {
    adminMock.ok = false;
    const res = await drillGET(req("https://t/api/admin/usage/u1"), { params: Promise.resolve({ userId: "u1" }) });
    expect(res.status).toBe(403);
    expect(accessMock.fn).not.toHaveBeenCalled();
  });

  it("returns per-user metadata AND writes a usage_drill_in audit row", async () => {
    vi.stubGlobal("fetch", stubPb());
    const res = await drillGET(req("https://t/api/admin/usage/u1"), { params: Promise.resolve({ userId: "u1" }) });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.user.id).toBe("u1");
    expect(d).toHaveProperty("counts");
    expect(accessMock.fn).toHaveBeenCalledTimes(1);
    const [, actionType, resource] = accessMock.fn.mock.calls[0]!;
    expect(actionType).toBe("usage_drill_in");
    expect(resource).toBe("u1");
  });
});
