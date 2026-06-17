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

// ── W72 — Parent Workflow object lifecycle ───────────────────────────────────

export type WorkflowStatus = "pending" | "running" | "completed" | "failed" | "partial";

export type WorkflowRecord = {
  id: string;
  user: string;
  status: WorkflowStatus;
  aggregation_doc_id: string | null;
  started_at: string | null;
};

/**
 * Pure state machine: derive the parent workflow status from its tasks'
 * statuses plus whether the aggregation work product has been produced.
 *
 *   pending   — no tasks, or every task still pending (none started)
 *   running   — at least one task started; or all succeeded but the
 *               aggregator hasn't produced the unified doc yet
 *   completed — all tasks succeeded AND aggregation doc exists
 *   failed    — terminal (no active tasks) and nothing succeeded
 *   partial   — terminal with a mix of succeeded + failed
 *
 * "active" = pending | running | retrying (work the drain can still advance).
 */
export function computeWorkflowStatus(
  statuses: WorkflowTaskStatus[],
  aggregated: boolean,
): WorkflowStatus {
  if (statuses.length === 0) return "pending";
  if (statuses.every((s) => s === "pending")) return "pending";
  if (statuses.every((s) => s === "succeeded")) return aggregated ? "completed" : "running";
  const active = statuses.some((s) => s === "pending" || s === "running" || s === "retrying");
  if (active) return "running";
  // Terminal, not all succeeded: partial if anything landed, else failed.
  return statuses.some((s) => s === "succeeded") ? "partial" : "failed";
}

/** Row-rule access gate for a workflow record: super-admin or the owner. */
export function canAccessWorkflow(requesterId: string, isAdmin: boolean, workflowUser: string): boolean {
  return isAdmin || (!!requesterId && requesterId === workflowUser);
}

export type ReconcileDeps = {
  getWorkflow: (id: string) => Promise<WorkflowRecord | null>;
  getTaskStatuses: (workflowId: string) => Promise<WorkflowTaskStatus[]>;
  updateWorkflow: (id: string, patch: Record<string, unknown>) => Promise<void>;
  /** Invokes the aggregate hook; returns the produced document id. */
  runAggregator: (workflowId: string) => Promise<string>;
  /** Best-effort audit write — one row per status change (W92 trail). */
  logTransition: (e: { workflowId: string; user: string; from: WorkflowStatus; to: WorkflowStatus }) => Promise<void>;
  now?: () => string;
};

export type ReconcileResult = {
  workflowId: string;
  from: WorkflowStatus;
  to: WorkflowStatus;
  aggregated: boolean;
  changed: boolean;
};

/**
 * Recompute a workflow's status from its tasks and persist any transition.
 * Called by the drain after task outcomes land. When all tasks have
 * succeeded and no aggregation doc exists yet, the aggregate hook runs
 * first so the workflow can complete cleanly. Every status change is
 * persisted (with started_at / completed_at stamps) and logged once.
 */
export async function reconcileWorkflow(workflowId: string, deps: ReconcileDeps): Promise<ReconcileResult> {
  const now = deps.now ?? (() => new Date().toISOString());
  const wf = await deps.getWorkflow(workflowId);
  if (!wf) {
    return { workflowId, from: "pending", to: "pending", aggregated: false, changed: false };
  }

  const statuses = await deps.getTaskStatuses(workflowId);
  let aggregated = !!wf.aggregation_doc_id;
  const patch: Record<string, unknown> = {};

  const allSucceeded = statuses.length > 0 && statuses.every((s) => s === "succeeded");
  if (allSucceeded && !aggregated) {
    patch.aggregation_doc_id = await deps.runAggregator(workflowId);
    aggregated = true;
  }

  const target = computeWorkflowStatus(statuses, aggregated);
  const changed = target !== wf.status;

  if (changed) {
    patch.status = target;
    if (target === "running" && !wf.started_at) patch.started_at = now();
    if (target === "completed" || target === "failed" || target === "partial") patch.completed_at = now();
  }

  if (Object.keys(patch).length > 0) await deps.updateWorkflow(workflowId, patch);
  if (changed) await deps.logTransition({ workflowId, user: wf.user, from: wf.status, to: target });

  return { workflowId, from: wf.status, to: target, aggregated, changed };
}

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
