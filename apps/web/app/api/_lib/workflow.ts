/**
 * W71 — Task Bus substrate core logic.
 *
 * drainTasks() is extracted for testability: callers pass deps
 * (fetch fns, agent runner) so tests mock without HTTP or PB.
 * The workflow-drain cron wires real PB + direct Anthropic calls.
 */

export type WorkflowTaskStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "retrying";

export type WorkflowTask = {
  id: string;
  workflow_id: string;
  user: string;
  specialist_id: string | null;
  department_id: string;
  input_payload: Record<string, unknown>;
  output_payload: Record<string, unknown> | null;
  status: WorkflowTaskStatus;
  depends_on: string[];
  retry_count: number;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  cost_estimate_tokens: number | null;
  cost_actual_tokens: number | null;
};

export type AgentResult = {
  text: string;
  tokensActual: number;
};

export type DrainDeps = {
  /** Returns tasks with status in ["pending", "retrying"] to process this tick. */
  fetchPendingTasks: () => Promise<WorkflowTask[]>;
  /** Returns the current status of a dependency task (by id), or null if not found. */
  getTaskStatus: (taskId: string) => Promise<WorkflowTaskStatus | null>;
  /** Applies a partial patch to the given task. */
  updateTask: (taskId: string, patch: Partial<WorkflowTask>) => Promise<void>;
  /** Runs the agent for the given task and returns its output. */
  runAgent: (task: WorkflowTask) => Promise<AgentResult>;
};

export type DrainResult = {
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
};

/**
 * Core drain loop: pull candidate tasks, gate on dependencies,
 * execute agent, and persist outcome. Idempotency: tasks that
 * already have completed_at set are skipped as a safety belt
 * (fetchPendingTasks should already exclude them, but defend here too).
 *
 * Retry boundary: retry_count 0/1 → "retrying"; retry_count 2 → "failed".
 * (3 total attempts: original + 2 retries = exhausted at retry_count=2.)
 */
export async function drainTasks(deps: DrainDeps): Promise<DrainResult> {
  const { fetchPendingTasks, getTaskStatus, updateTask, runAgent } = deps;

  const tasks = await fetchPendingTasks();
  const result: DrainResult = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
  };

  for (const task of tasks) {
    // Safety: idempotency belt — skip if already completed
    if (task.completed_at) {
      result.skipped++;
      continue;
    }

    // Dependency gate: all deps must be "succeeded" at tick start
    let depsReady = true;
    for (const depId of task.depends_on) {
      const depStatus = await getTaskStatus(depId);
      if (depStatus !== "succeeded") {
        depsReady = false;
        break;
      }
    }

    if (!depsReady) {
      result.skipped++;
      continue;
    }

    // Mark running before agent call (enables concurrent drain detection)
    await updateTask(task.id, {
      status: "running",
      started_at: new Date().toISOString(),
    });

    try {
      const agentResult = await runAgent(task);

      await updateTask(task.id, {
        status: "succeeded",
        output_payload: {
          text: agentResult.text,
          tokensActual: agentResult.tokensActual,
        },
        completed_at: new Date().toISOString(),
        cost_actual_tokens: agentResult.tokensActual,
      });

      result.processed++;
      result.succeeded++;
    } catch (err) {
      const nextRetryCount = task.retry_count + 1;
      const isFinalFailure = nextRetryCount >= 3;

      await updateTask(task.id, {
        status: isFinalFailure ? "failed" : "retrying",
        retry_count: nextRetryCount,
        error: err instanceof Error ? err.message : String(err),
        ...(isFinalFailure ? { completed_at: new Date().toISOString() } : {}),
      });

      result.processed++;
      if (isFinalFailure) {
        result.failed++;
      }
    }
  }

  return result;
}
