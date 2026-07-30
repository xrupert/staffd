/**
 * PR-Loop-V1 (#2) — grader integration with drainTasks: a rejected output
 * rides the existing retry machinery with actionable feedback; exhaustion
 * fails honestly with the rejected draft preserved for audit.
 */

import { describe, it, expect, vi } from "vitest";
import { drainTasks } from "../../app/api/_lib/workflow";
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
    runAgent: vi.fn().mockResolvedValue({ text: "result text", tokensActual: 100 }),
    ...overrides,
  };
}

describe("drainTasks × grader (PR-Loop-V1)", () => {
  it("no grader dep → outputs pass exactly as before", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const result = await drainTasks(
      makeDeps({ fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]), updateTask }),
    );
    expect(result.succeeded).toBe(1);
    expect(result.graderRejected).toBe(0);
    const final = updateTask.mock.calls.at(-1)?.[1];
    expect(final.status).toBe("succeeded");
  });

  it("grader pass → succeeded, output persisted normally", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]),
        updateTask,
        gradeOutput: () => ({ pass: true }),
      }),
    );
    expect(result.succeeded).toBe(1);
    expect(result.graderRejected).toBe(0);
  });

  it("grader reject → retrying with grader_feedback stashed on input_payload", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([makeTask()]),
        updateTask,
        gradeOutput: () => ({ pass: false, reasons: ["vendor_leak: found \"muapi\""] }),
      }),
    );
    expect(result.succeeded).toBe(0);
    expect(result.graderRejected).toBe(1);
    expect(result.failed).toBe(0);
    const final = updateTask.mock.calls.at(-1)?.[1];
    expect(final.status).toBe("retrying");
    expect(final.retry_count).toBe(1);
    expect(final.error).toContain("grader_rejected");
    expect(final.input_payload.grader_feedback).toContain("vendor_leak");
    expect(final.input_payload.task).toBe("write a blog post"); // original task preserved
    expect(final.completed_at).toBeUndefined();
  });

  it("grader reject at retry_count=2 → failed, rejected draft kept for audit", async () => {
    const updateTask = vi.fn().mockResolvedValue(undefined);
    const result = await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([makeTask({ retry_count: 2, status: "retrying" })]),
        updateTask,
        runAgent: vi.fn().mockResolvedValue({ text: "still leaking muapi", tokensActual: 10 }),
        gradeOutput: () => ({ pass: false, reasons: ["vendor_leak"] }),
      }),
    );
    expect(result.failed).toBe(1);
    expect(result.graderRejected).toBe(1);
    const final = updateTask.mock.calls.at(-1)?.[1];
    expect(final.status).toBe("failed");
    expect(final.completed_at).toBeTruthy();
    expect(final.output_payload).toEqual({ text: "still leaking muapi", rejected: true });
  });

  it("system tasks skip grading via the route's isSystemTask wiring (grader sees the flag)", async () => {
    // The drain passes the task to gradeOutput — assert the dep receives it.
    const gradeOutput = vi.fn().mockReturnValue({ pass: true });
    const task = makeTask({ specialist_id: "mirror_retry_worker" });
    await drainTasks(
      makeDeps({ fetchPendingTasks: vi.fn().mockResolvedValue([task]), gradeOutput }),
    );
    expect(gradeOutput).toHaveBeenCalledWith(task, expect.objectContaining({ text: "result text" }));
  });
});
