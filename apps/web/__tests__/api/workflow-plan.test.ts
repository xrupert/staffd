/**
 * W73 (L4) — POST /api/workflow/plan materializes an LLM plan onto the execution
 * substrate: one parent workflow + a DAG of workflow_tasks with depends_on
 * resolved from plan step indices to created task ids. (Live LLM quality + the
 * actual drain run are operator-verified — here we lock the orchestration.)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "u@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));

const llm = vi.hoisted(() => ({ result: { ok: true, text: "" } as { ok: boolean; text?: string } }));
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: async () => llm.result }));
vi.mock("../../app/api/_lib/pb", () => ({ pbUrl: () => "https://pb.test", getAdminToken: async () => "tok" }));

import { POST } from "../../app/api/workflow/plan/route";

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

const post = (goal: unknown) => POST(new Request("https://t/api/workflow/plan", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify({ goal }) }));

describe("POST /api/workflow/plan", () => {
  it("401 without a session", async () => {
    auth.user = null;
    expect((await post("Launch the promo")).status).toBe(401);
  });

  it("400 on a too-short goal", async () => {
    expect((await post("x")).status).toBe(400);
  });

  it("502 when the planner LLM is unavailable", async () => {
    llm.result = { ok: false };
    expect((await post("Launch the spring promo")).status).toBe(502);
  });

  it("422 when the model returns an unsound plan (unknown department)", async () => {
    llm.result = { ok: true, text: '{"steps":[{"department":"accounting","task":"x","dependsOn":[]}]}' };
    const res = await post("Launch the spring promo");
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("plan_invalid");
  });

  it("materializes a workflow + a dependency-wired task DAG (tolerates code fences)", async () => {
    llm.result = { ok: true, text: '```json\n{"steps":[' +
      '{"department":"marketing","task":"Draft copy","dependsOn":[]},' +
      '{"department":"design","task":"Make visual","dependsOn":[0]},' +
      '{"department":"sales","task":"Outreach","dependsOn":[0,1]}' +
      ']}\n```' };
    const res = await post("Launch the spring promo");
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, workflowId: "wf1", taskCount: 3 });

    const wf = creates.find((c) => c.url.includes("/workflows/records"))!;
    expect(wf.body).toMatchObject({ user: "u1", status: "pending" });

    const tasks = creates.filter((c) => c.url.includes("/workflow_tasks/records"));
    expect(tasks).toHaveLength(3);
    expect(tasks[0]!.body).toMatchObject({ department_id: "marketing", depends_on: [] });
    expect(tasks[1]!.body.depends_on).toEqual(["t0"]);           // step 1 depends on step 0 → t0
    expect(tasks[2]!.body.depends_on).toEqual(["t0", "t1"]);     // step 2 depends on steps 0,1
    expect((tasks[2]!.body.input_payload as { goal: string }).goal).toBe("Launch the spring promo");
  });
});
