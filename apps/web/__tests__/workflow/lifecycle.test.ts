/**
 * W72 — Workflow object lifecycle state machine (runtime tests).
 *
 * Standards #13-15: runtime-only — invoke the pure state machine +
 * reconcileWorkflow() with mocked deps and assert transitions, the
 * aggregate-hook invocation, the usage-log transition write, and the
 * row-rule access gate. No HTTP, no PB.
 */

import { describe, it, expect, vi } from "vitest";
import {
  computeWorkflowStatus,
  canAccessWorkflow,
  reconcileWorkflow,
} from "../../app/api/_lib/workflow";
import type {
  WorkflowTaskStatus,
  ReconcileDeps,
  WorkflowRecord,
} from "../../app/api/_lib/workflow";
import { EXPECTED_COLLECTIONS, USER_OWNED_RULES } from "../../app/api/_lib/security/row-rules";

// ── computeWorkflowStatus (pure) ─────────────────────────────────────────────

describe("W72 computeWorkflowStatus", () => {
  const cases: [string, WorkflowTaskStatus[], boolean, string][] = [
    ["no tasks → pending", [], false, "pending"],
    ["all pending → pending", ["pending", "pending"], false, "pending"],
    ["one running → running", ["running", "pending"], false, "running"],
    ["all succeeded, not aggregated → running (awaiting aggregation)", ["succeeded", "succeeded"], false, "running"],
    ["all succeeded, aggregated → completed", ["succeeded", "succeeded"], true, "completed"],
    ["all failed → failed", ["failed", "failed"], false, "failed"],
    ["mixed succeeded + failed, terminal → partial", ["succeeded", "failed"], false, "partial"],
    ["failure but work still active → running", ["failed", "running"], false, "running"],
    ["retrying counts as active → running", ["retrying", "failed"], false, "running"],
  ];
  for (const [name, statuses, aggregated, expected] of cases) {
    it(name, () => {
      expect(computeWorkflowStatus(statuses, aggregated)).toBe(expected);
    });
  }
});

// ── canAccessWorkflow (row-rule gate) ────────────────────────────────────────

describe("W72 canAccessWorkflow", () => {
  it("owner can read their own workflow", () => {
    expect(canAccessWorkflow("user-a", false, "user-a")).toBe(true);
  });
  it("super-admin can read any workflow", () => {
    expect(canAccessWorkflow("admin", true, "user-b")).toBe(true);
  });
  it("user A cannot read user B's workflow", () => {
    expect(canAccessWorkflow("user-a", false, "user-b")).toBe(false);
  });
});

// ── reconcileWorkflow (transitions + side effects) ───────────────────────────

function makeWorkflow(overrides: Partial<WorkflowRecord> = {}): WorkflowRecord {
  return { id: "wf-1", user: "user-a", status: "pending", aggregation_doc_id: null, started_at: null, ...overrides };
}

function makeDeps(wf: WorkflowRecord, statuses: WorkflowTaskStatus[], overrides: Partial<ReconcileDeps> = {}): ReconcileDeps {
  return {
    getWorkflow: vi.fn(async () => wf),
    getTaskStatuses: vi.fn(async () => statuses),
    updateWorkflow: vi.fn(async () => {}),
    runAggregator: vi.fn(async () => "doc-xyz"),
    logTransition: vi.fn(async () => {}),
    now: () => "2026-06-16T00:00:00.000Z",
    ...overrides,
  };
}

describe("W72 reconcileWorkflow", () => {
  it("a freshly created all-pending workflow stays pending (no transition, no log)", async () => {
    const wf = makeWorkflow({ status: "pending" });
    const deps = makeDeps(wf, ["pending", "pending"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(r.changed).toBe(false);
    expect(r.to).toBe("pending");
    expect(deps.logTransition).not.toHaveBeenCalled();
    expect(deps.updateWorkflow).not.toHaveBeenCalled();
  });

  it("first task running flips pending → running, sets started_at, logs the transition", async () => {
    const wf = makeWorkflow({ status: "pending" });
    const deps = makeDeps(wf, ["running", "pending"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(r).toMatchObject({ from: "pending", to: "running", changed: true });
    expect(deps.updateWorkflow).toHaveBeenCalledWith("wf-1", expect.objectContaining({ status: "running", started_at: "2026-06-16T00:00:00.000Z" }));
    expect(deps.logTransition).toHaveBeenCalledWith({ workflowId: "wf-1", user: "user-a", from: "pending", to: "running" });
  });

  it("all tasks succeeded triggers the aggregate hook, sets aggregation_doc_id, flips → completed", async () => {
    const wf = makeWorkflow({ status: "running" });
    const deps = makeDeps(wf, ["succeeded", "succeeded"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(deps.runAggregator).toHaveBeenCalledWith("wf-1");
    expect(r).toMatchObject({ to: "completed", aggregated: true, changed: true });
    const patch = (deps.updateWorkflow as ReturnType<typeof vi.fn>).mock.calls[0]![1];
    expect(patch).toMatchObject({ aggregation_doc_id: "doc-xyz", status: "completed", completed_at: "2026-06-16T00:00:00.000Z" });
    expect(deps.logTransition).toHaveBeenCalledWith(expect.objectContaining({ from: "running", to: "completed" }));
  });

  it("does NOT re-run the aggregator when a doc already exists", async () => {
    const wf = makeWorkflow({ status: "completed", aggregation_doc_id: "doc-existing" });
    const deps = makeDeps(wf, ["succeeded", "succeeded"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(deps.runAggregator).not.toHaveBeenCalled();
    expect(r.changed).toBe(false);
  });

  it("an unrecoverable task failure flips → failed and logs", async () => {
    const wf = makeWorkflow({ status: "running" });
    const deps = makeDeps(wf, ["failed"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(deps.runAggregator).not.toHaveBeenCalled();
    expect(r).toMatchObject({ to: "failed", changed: true });
    expect(deps.updateWorkflow).toHaveBeenCalledWith("wf-1", expect.objectContaining({ status: "failed", completed_at: "2026-06-16T00:00:00.000Z" }));
    expect(deps.logTransition).toHaveBeenCalledWith(expect.objectContaining({ from: "running", to: "failed" }));
  });

  it("a mix of succeeded + failed (no retries left) flips → partial", async () => {
    const wf = makeWorkflow({ status: "running" });
    const deps = makeDeps(wf, ["succeeded", "failed"]);
    const r = await reconcileWorkflow("wf-1", deps);
    expect(deps.runAggregator).not.toHaveBeenCalled();
    expect(r).toMatchObject({ to: "partial", changed: true });
    expect(deps.logTransition).toHaveBeenCalledWith(expect.objectContaining({ from: "running", to: "partial" }));
  });

  it("logs exactly one transition row per status change", async () => {
    const wf = makeWorkflow({ status: "pending" });
    const deps = makeDeps(wf, ["running"]);
    await reconcileWorkflow("wf-1", deps);
    expect(deps.logTransition).toHaveBeenCalledTimes(1);
  });
});

// ── Row-rule config (Standard #16: user-owned, field named `user`) ───────────

describe("W72 workflows collection row-rules", () => {
  it("workflows is registered USER_OWNED with the `user` field", () => {
    const entry = EXPECTED_COLLECTIONS.find((e) => e.name === "workflows");
    expect(entry).toBeDefined();
    expect(entry!.rules).toEqual(USER_OWNED_RULES);
    expect(USER_OWNED_RULES.view).toContain("user = @request.auth.id");
  });
});
