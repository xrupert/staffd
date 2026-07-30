/**
 * W73 (L4) — POST /api/workflow/plan is PREVIEW: it returns a validated plan and
 * persists NOTHING (commit materializes it). So a multi-step workflow never
 * spends the customer's agent calls until they approve the plan.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: { id: "u1", email: "u@x.com" } as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));
// PR-Loop-V1: the route now makes TWO calls (planner, then critic). A queue
// serves per-call results; when empty, `result` serves every call (back-compat
// for pre-critic tests — a plan-shaped critic response degrades to approve).
const llm = vi.hoisted(() => ({
  result: { ok: true, text: "" } as { ok: boolean; text?: string },
  queue: [] as Array<{ ok: boolean; text?: string }>,
}));
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({
  callLLM: async () => (llm.queue.length ? llm.queue.shift()! : llm.result),
}));

import { POST } from "../../app/api/workflow/plan/route";

let fetchCalls: string[];
beforeEach(() => {
  auth.user = { id: "u1", email: "u@x.com" };
  llm.queue = [];
  fetchCalls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => { fetchCalls.push(String(url)); return { ok: true, json: async () => ({}) }; }));
});
afterEach(() => vi.unstubAllGlobals());

const post = (goal: unknown) => POST(new Request("https://t/api/workflow/plan", { method: "POST", headers: { authorization: "tok", "Content-Type": "application/json" }, body: JSON.stringify({ goal }) }));

describe("POST /api/workflow/plan (preview)", () => {
  it("401 without a session", async () => { auth.user = null; expect((await post("Launch the promo")).status).toBe(401); });
  it("400 on a too-short goal", async () => { expect((await post("x")).status).toBe(400); });
  it("502 when the planner LLM is unavailable", async () => { llm.result = { ok: false }; expect((await post("Launch the spring promo")).status).toBe(502); });

  it("422 when the model returns an unsound plan (unknown department)", async () => {
    llm.result = { ok: true, text: '{"steps":[{"department":"accounting","task":"x","dependsOn":[]}]}' };
    expect((await post("Launch the spring promo")).status).toBe(422);
  });

  it("returns the validated plan and persists NOTHING (tolerates code fences)", async () => {
    llm.result = { ok: true, text: '```json\n{"steps":[' +
      '{"department":"marketing","task":"Draft copy","dependsOn":[]},' +
      '{"department":"design","task":"Make visual","dependsOn":[0]}' +
      ']}\n```' };
    const res = await post("Launch the spring promo");
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ ok: true, goal: "Launch the spring promo" });
    expect(d.steps.map((s: { department: string }) => s.department)).toEqual(["marketing", "design"]);
    // PREVIEW: nothing written to PB.
    expect(fetchCalls.some((u) => u.includes("/records"))).toBe(false);
  });

  // ── PR-Loop-V1 (#3) — the critic pre-mortem ──────────────────────────────

  const PLANNER_OK = { ok: true, text: '{"steps":[{"department":"marketing","task":"Draft copy","dependsOn":[]}]}' };

  it("critic approve → original plan, critique surfaced", async () => {
    llm.queue = [PLANNER_OK, { ok: true, text: '{"verdict":"approve","concerns":["Consider timing around the holiday"]}' }];
    const d = await (await post("Launch the spring promo")).json();
    expect(d.steps.map((s: { department: string }) => s.department)).toEqual(["marketing"]);
    expect(d.critique).toEqual({ verdict: "approve", concerns: ["Consider timing around the holiday"] });
  });

  it("critic amend with a VALID plan → amended steps replace the original", async () => {
    llm.queue = [PLANNER_OK, {
      ok: true,
      text: '{"verdict":"amend","concerns":["A legal review is needed before this goes out"],"steps":[{"department":"marketing","task":"Draft copy","dependsOn":[]},{"department":"legal","task":"Review the promotion terms","dependsOn":[0]}]}',
    }];
    const d = await (await post("Launch the spring promo")).json();
    expect(d.steps.map((s: { department: string }) => s.department)).toEqual(["marketing", "legal"]);
    expect(d.critique.verdict).toBe("amend");
  });

  it("critic amend with an INVALID plan → original stands (critic can never damage)", async () => {
    llm.queue = [PLANNER_OK, {
      ok: true,
      text: '{"verdict":"amend","concerns":["x"],"steps":[{"department":"accounting","task":"y","dependsOn":[]}]}',
    }];
    const d = await (await post("Launch the spring promo")).json();
    expect(d.steps.map((s: { department: string }) => s.department)).toEqual(["marketing"]);
    expect(d.critique.verdict).toBe("approve");
  });

  it("critic LLM failure → original plan with critique unavailable (never stalls)", async () => {
    llm.queue = [PLANNER_OK, { ok: false }];
    const res = await post("Launch the spring promo");
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.steps.length).toBe(1);
    expect(d.critique.verdict).toBe("unavailable");
  });
});
