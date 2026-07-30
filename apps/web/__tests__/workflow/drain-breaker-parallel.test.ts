/**
 * PR-Loop-V2 (#4 + #7) — parallel drain + per-workflow circuit breaker.
 *
 * Breaker: a workflow with >= WORKFLOW_BREAKER_THRESHOLD terminal failures
 * stops spending its remaining steps — tasks fail WITHOUT the agent
 * running. Failures observed mid-tick open the breaker immediately.
 *
 * Parallelism: ready tasks execute concurrently up to the cap; serial
 * behavior (concurrency 1 / absent) is byte-for-byte the pre-V2 machine.
 */

import { describe, it, expect, vi } from "vitest";
import { drainTasks, WORKFLOW_BREAKER_THRESHOLD } from "../../app/api/_lib/workflow";
import type { WorkflowTask, DrainDeps } from "../../app/api/_lib/workflow";

function makeTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "task-1",
    workflow_id: "wf-1",
    user: "user-a",
    specialist_id: null,
    department_id: "marketing",
    input_payload: { task: "write a blog post" },
    output_payload: null,
    status: "pending",
    depends_on: [],
    retry_count: 0,
    error: null,
    started_at: null,
    completed_at: null,
    cost_estimate_tokens: null,
    cost_actual_tokens: null,
    ...overrides,
  };
}

function makeDeps(overrides: Partial<DrainDeps> = {}): DrainDeps {
  return {
    fetchPendingTasks: vi.fn().mockResolvedValue([]),
    getTaskStatus: vi.fn().mockResolvedValue(null),
    updateTask: vi.fn().mockResolvedValue(undefined),
    runAgent: vi.fn().mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 100 }),
    ...overrides,
  };
}

describe("circuit breaker (#7)", () => {
  it("threshold is 2 — the ratified waste bound", () => {
    expect(WORKFLOW_BREAKER_THRESHOLD).toBe(2);
  });

  it("persisted failures at threshold → task failed WITHOUT agent execution", async () => {
    const runAgent = vi.fn();
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]),
        runAgent,
        updateTask,
        getWorkflowFailedCount: vi.fn().mockResolvedValue(2),
      }),
    );
    expect(runAgent).not.toHaveBeenCalled();
    expect(result.breakerTripped).toBe(1);
    expect(result.failed).toBe(1);
    const final = updateTask.mock.calls.at(-1)?.[1];
    expect(final.status).toBe("failed");
    expect(final.error).toContain("circuit_breaker");
    expect(final.completed_at).toBeTruthy();
  });

  it("below threshold → runs normally", async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 5 });
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]),
        runAgent,
        getWorkflowFailedCount: vi.fn().mockResolvedValue(1),
      }),
    );
    expect(runAgent).toHaveBeenCalledOnce();
    expect(result.succeeded).toBe(1);
    expect(result.breakerTripped).toBe(0);
  });

  it("mid-tick terminal failures open the breaker for later tasks in the same workflow", async () => {
    // Task A exhausts its retries this tick (agent throws at retry_count 2);
    // tasks B and C in the same workflow must then trip without executing.
    // (1 persisted failure + 1 tick failure = threshold.)
    const runAgent = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 5 });
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([
          makeTask({ id: "a", retry_count: 2, status: "retrying" }),
          makeTask({ id: "b" }),
          makeTask({ id: "c" }),
        ]),
        runAgent,
        getWorkflowFailedCount: vi.fn().mockResolvedValue(1),
      }),
    );
    expect(runAgent).toHaveBeenCalledTimes(1); // only task A executed
    expect(result.failed).toBe(3);
    expect(result.breakerTripped).toBe(2);
  });

  it("other workflows are unaffected by a tripped one", async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 5 });
    const counts: Record<string, number> = { "wf-broken": 5, "wf-healthy": 0 };
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([
          makeTask({ id: "x", workflow_id: "wf-broken" }),
          makeTask({ id: "y", workflow_id: "wf-healthy" }),
        ]),
        runAgent,
        getWorkflowFailedCount: vi.fn(async (id: string) => counts[id] ?? 0),
      }),
    );
    expect(result.breakerTripped).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it("no dep provided → breaker disabled (pre-V2 behavior)", async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 5 });
    const result = await drainTasks(
      makeDeps({ fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]), runAgent }),
    );
    expect(result.succeeded).toBe(1);
    expect(result.breakerTripped).toBe(0);
  });
});

describe("parallel execution (#4)", () => {
  it("processes every task and caps in-flight agents at the concurrency limit", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const runAgent = vi.fn(async () => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return { text: "a perfectly complete deliverable for the customer to review", tokensActual: 1 };
    });
    const tasks = Array.from({ length: 6 }, (_, i) => makeTask({ id: `t${i}`, workflow_id: `wf-${i}` }));
    const result = await drainTasks(
      makeDeps({ fetchPendingTasks: vi.fn().mockResolvedValue(tasks), runAgent, concurrency: 3 }),
    );
    expect(result.succeeded).toBe(6);
    expect(runAgent).toHaveBeenCalledTimes(6);
    expect(maxInFlight).toBeGreaterThan(1); // genuinely parallel
    expect(maxInFlight).toBeLessThanOrEqual(3); // capped
  });

  it("dependency gate still holds under concurrency — unready dependents are skipped", async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: "a perfectly complete deliverable for the customer to review", tokensActual: 1 });
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([
          makeTask({ id: "a" }),
          makeTask({ id: "b", depends_on: ["a"] }), // a not yet succeeded in PB
        ]),
        getTaskStatus: vi.fn().mockResolvedValue("running"),
        runAgent,
        concurrency: 4,
      }),
    );
    expect(result.succeeded).toBe(1);
    expect(result.skipped).toBe(1);
  });
});
