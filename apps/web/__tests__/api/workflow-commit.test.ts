/**
 * W73 (L4) — POST /api/workflow/commit materializes an APPROVED plan onto the
 * execution substrate: one parent workflow + a DAG of workflow_tasks with
 * depends_on resolved from plan step indices to created task ids. The client-sent
 * plan is re-validated through parsePlan (never trusted).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "u@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "tok" }));

import { POST } from "../../app/api/workflow/commit/route";

let creates: { url: string; body: Record<string, unknown> }[];
beforeEach(() => {
  auth.user = { id: "u1", email: "u@x.com" };
  creates = [];
  let taskN = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(init.body as string) : {};
    creates.push({ url: String(url), body });
    if (String(url).includes("/workflows/records")) return { ok: true, json: async () => ({ id: "wf1" }) };
    if (String(url).includes("/workflow_tasks/records")) return { ok: true, json: async () => ({ id: `t${taskN++}` }) };
    return { ok: true, json: async () => ({}) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const goodPlan = { steps: [
  { department: "marketing", task: "Draft copy", dependsOn: [] },
  { department: "design", task: "Make visual", dependsOn: [0] },
  { department: "sales", task: "Outreach", dependsOn: [0, 1] },
] };
const post = (b: object) => POST(new Request("https://t/api/workflow/commit", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify(b) }));

describe("POST /api/workflow/commit", () => {
  it("401 without a session", async () => { auth.user = null; expect((await post({ goal: "Launch", plan: goodPlan })).status).toBe(401); });

  it("422 re-validates and rejects a tampered/unsound client plan", async () => {
    const res = await post({ goal: "Launch", plan: { steps: [{ department: "accounting", task: "x", dependsOn: [] }] } });
    expect(res.status).toBe(422);
    expect(creates.some((c) => c.url.includes("/records"))).toBe(false); // nothing created
  });

  it("materializes the workflow + a dependency-wired task DAG", async () => {
    const res = await post({ goal: "Launch the spring promo", plan: goodPlan });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, workflowId: "wf1", taskCount: 3 });

    const wf = creates.find((c) => c.url.includes("/workflows/records"))!;
    expect(wf.body).toMatchObject({ user: "u1", status: "pending" });

    const tasks = creates.filter((c) => c.url.includes("/workflow_tasks/records"));
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.body).toMatchObject({ department_id: "marketing", depends_on: [] });
    expect(tasks[1]!.body.depends_on).toEqual(["t0"]);
    expect(tasks[2]!.body.depends_on).toEqual(["t0", "t1"]);
    expect((tasks[2]!.body.input_payload as { goal: string }).goal).toBe("Launch the spring promo");
  });
});
