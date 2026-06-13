/**
 * W71 — Task Bus substrate runtime tests.
 *
 * Standards #13-15: runtime-only tests (no readFileSync source checks).
 * Each test invokes drainTasks() with mocked deps and asserts resulting
 * state mutations. Tests for: depends_on gate, success path, retry
 * exhaustion, idempotency, row-rule config, multi-task processing.
 *
 * Floor: 453 tests → after W71 must be ≥ 465.
 */

import { describe, it, expect, vi } from "vitest";
import { drainTasks } from "../../app/api/_lib/workflow";
import type { WorkflowTask, DrainDeps } from "../../app/api/_lib/workflow";
import {
  EXPECTED_COLLECTIONS,
  USER_OWNED_RULES,
} from "../../app/api/_lib/security/row-rules";

// ── Helpers ────────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id: "task-1",
    workflow_id: "wf-1",
    user_id: "user-a",
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
    runAgent: vi.fn().mockResolvedValue({ text: "result text", tokensActual: 100 }),
    ...overrides,
  };
}

// ── T1: depends_on gate ────────────────────────────────────────────────────

describe("W71 T1 — depends_on gate: unresolved dep blocks execution", () => {
  it("task with a dep whose status is 'pending' is not executed", async () => {
    const task = makeTask({ id: "task-b", depends_on: ["task-a"] });
    const runAgent = vi.fn().mockResolvedValue({ text: "output", tokensActual: 50 });

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        getTaskStatus: vi.fn().mockResolvedValue("pending"),
        runAgent,
      })
    );

    expect(runAgent).not.toHaveBeenCalled();
  });

  it("task with all deps 'succeeded' is executed", async () => {
    const task = makeTask({ id: "task-b", depends_on: ["task-a"] });
    const runAgent = vi.fn().mockResolvedValue({ text: "output", tokensActual: 50 });

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        getTaskStatus: vi.fn().mockResolvedValue("succeeded"),
        runAgent,
      })
    );

    expect(runAgent).toHaveBeenCalledOnce();
  });
});

// ── T2: successful drain ───────────────────────────────────────────────────

describe("W71 T2 — successful drain populates output and timestamps", () => {
  it("status is updated to 'succeeded' after successful agent run", async () => {
    const task = makeTask({ id: "task-ok" });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockResolvedValue({ text: "great blog post", tokensActual: 300 }),
      })
    );

    const successUpdate = updates.find(([, p]) => p.status === "succeeded");
    expect(successUpdate).toBeDefined();
  });

  it("output_payload is populated from agent result", async () => {
    const task = makeTask({ id: "task-ok" });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockResolvedValue({ text: "great blog post", tokensActual: 300 }),
      })
    );

    const successUpdate = updates.find(([, p]) => p.status === "succeeded");
    expect(successUpdate![1].output_payload).toBeDefined();
    expect((successUpdate![1].output_payload as Record<string, unknown>)?.text).toBe("great blog post");
  });

  it("completed_at is set after successful agent run", async () => {
    const task = makeTask({ id: "task-ok" });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockResolvedValue({ text: "content", tokensActual: 200 }),
      })
    );

    const successUpdate = updates.find(([, p]) => p.status === "succeeded");
    expect(successUpdate![1].completed_at).toBeDefined();
    expect(typeof successUpdate![1].completed_at).toBe("string");
  });
});

// ── T3: retry exhaustion ──────────────────────────────────────────────────

describe("W71 T3 — retry exhaustion: 3 failures → failed status", () => {
  it("first failure (retry_count=0) sets status to 'retrying', not 'failed'", async () => {
    const task = makeTask({ id: "task-retry", retry_count: 0 });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockRejectedValue(new Error("transient failure")),
      })
    );

    const withStatus = updates.filter(([, p]) => p.status !== undefined);
    const lastStatus = withStatus[withStatus.length - 1]?.[1].status;
    expect(lastStatus).toBe("retrying");
  });

  it("third failure (retry_count=2) sets status to 'failed'", async () => {
    const task = makeTask({ id: "task-exhausted", retry_count: 2 });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockRejectedValue(new Error("final failure")),
      })
    );

    const withStatus = updates.filter(([, p]) => p.status !== undefined);
    const lastStatus = withStatus[withStatus.length - 1]?.[1].status;
    expect(lastStatus).toBe("failed");
  });

  it("retry_count is incremented on failure", async () => {
    const task = makeTask({ id: "task-count", retry_count: 0 });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockRejectedValue(new Error("failure")),
      })
    );

    const failureUpdate = updates.find(([, p]) => p.retry_count !== undefined);
    expect(failureUpdate![1].retry_count).toBe(1);
  });
});

// ── T4: idempotency ───────────────────────────────────────────────────────

describe("W71 T4 — idempotency: completed task not re-executed", () => {
  it("task with completed_at already set is skipped without calling runAgent", async () => {
    const task = makeTask({
      id: "task-done",
      status: "succeeded",
      completed_at: "2026-06-01T00:00:00Z",
    });
    const runAgent = vi.fn();

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        runAgent,
      })
    );

    expect(runAgent).not.toHaveBeenCalled();
  });
});

// ── T5: row rule configuration (runtime module import, not source text) ───

describe("W71 T5 — row rule configuration in EXPECTED_COLLECTIONS", () => {
  it("workflow_tasks is registered with USER_OWNED_RULES", () => {
    const entry = EXPECTED_COLLECTIONS.find((e) => e.name === "workflow_tasks");
    expect(entry).toBeDefined();
    expect(entry!.rules).toEqual(USER_OWNED_RULES);
  });

  it("workflows is registered with USER_OWNED_RULES", () => {
    const entry = EXPECTED_COLLECTIONS.find((e) => e.name === "workflows");
    expect(entry).toBeDefined();
    expect(entry!.rules).toEqual(USER_OWNED_RULES);
  });
});

// ── T6: multi-task tick ───────────────────────────────────────────────────

describe("W71 T6 — multi-task tick: ready tasks run, blocked tasks skip", () => {
  it("two independent tasks are both processed in one drain call", async () => {
    const taskA = makeTask({ id: "task-a", depends_on: [] });
    const taskC = makeTask({ id: "task-c", depends_on: [] });
    const processedIds: string[] = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([taskA, taskC]),
        runAgent: vi.fn().mockImplementation(async (task: WorkflowTask) => {
          processedIds.push(task.id);
          return { text: "ok", tokensActual: 50 };
        }),
      })
    );

    expect(processedIds).toContain("task-a");
    expect(processedIds).toContain("task-c");
  });

  it("dep-blocked task is skipped when its dep is not yet succeeded", async () => {
    const taskA = makeTask({ id: "task-a", depends_on: [] });
    const taskB = makeTask({ id: "task-b", depends_on: ["task-a"] });
    const processedIds: string[] = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([taskA, taskB]),
        getTaskStatus: vi.fn().mockImplementation(async (id: string) => {
          if (id === "task-a") return "pending"; // task-a hasn't succeeded yet at tick start
          return null;
        }),
        runAgent: vi.fn().mockImplementation(async (task: WorkflowTask) => {
          processedIds.push(task.id);
          return { text: "ok", tokensActual: 50 };
        }),
      })
    );

    expect(processedIds).toContain("task-a");
    expect(processedIds).not.toContain("task-b");
  });
});

// ── T7: running marker before agent call ─────────────────────────────────

describe("W71 T7 — task marked running before agent is invoked", () => {
  it("updateTask({ status: 'running' }) is called before runAgent", async () => {
    const task = makeTask({ id: "task-seq" });
    const callOrder: string[] = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (_id: string, patch: Partial<WorkflowTask>) => {
          if (patch.status === "running") callOrder.push("updateTask:running");
        }),
        runAgent: vi.fn().mockImplementation(async () => {
          callOrder.push("runAgent");
          return { text: "content", tokensActual: 100 };
        }),
      })
    );

    expect(callOrder.indexOf("updateTask:running")).toBeLessThan(
      callOrder.indexOf("runAgent")
    );
  });
});
