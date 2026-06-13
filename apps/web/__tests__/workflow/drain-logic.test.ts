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

// ── T15: error field populated on failure ─────────────────────────────────

describe("W71 T15 — failure populates error field with err.message", () => {
  it("error field is set to the thrown error message on agent failure", async () => {
    const task = makeTask({ id: "task-err", retry_count: 0 });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockRejectedValue(new Error("agent timed out after 30s")),
      })
    );

    const failureUpdate = updates.find(([, p]) => p.error !== undefined);
    expect(failureUpdate).toBeDefined();
    expect(failureUpdate![1].error).toBe("agent timed out after 30s");
  });
});

// ── T16: cost_actual_tokens from agentResult ──────────────────────────────

describe("W71 T16 — success propagates cost_actual_tokens from AgentResult", () => {
  it("cost_actual_tokens on the succeeded update equals agentResult.tokensActual", async () => {
    const task = makeTask({ id: "task-cost" });
    const updates: Array<[string, Partial<WorkflowTask>]> = [];

    await drainTasks(
      makeDeps({
        fetchPendingTasks: vi.fn().mockResolvedValue([task]),
        updateTask: vi.fn().mockImplementation(async (id: string, patch: Partial<WorkflowTask>) => {
          updates.push([id, patch]);
        }),
        runAgent: vi.fn().mockResolvedValue({ text: "output content", tokensActual: 387 }),
      })
    );

    const successUpdate = updates.find(([, p]) => p.status === "succeeded");
    expect(successUpdate).toBeDefined();
    expect(successUpdate![1].cost_actual_tokens).toBe(387);
  });
});

// ── T17: TRUE PB row-rule enforcement (integration, skipped without creds) ─

const pbConfigured =
  !!(process.env.NEXT_PUBLIC_POCKETBASE_URL &&
     process.env.PB_ADMIN_EMAIL &&
     process.env.PB_ADMIN_PASSWORD);

describe("W71 T17 — TRUE PB row-rule enforcement (integration test)", () => {
  it.skipIf(!pbConfigured)(
    "user B with valid PB token cannot read user A's workflow_task (PB enforcement, not mock)",
    async () => {
      const pb = process.env.NEXT_PUBLIC_POCKETBASE_URL!;

      // Authenticate as PB superuser
      const adminRes = await fetch(
        `${pb}/api/collections/_superusers/auth-with-password`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            identity: process.env.PB_ADMIN_EMAIL,
            password: process.env.PB_ADMIN_PASSWORD,
          }),
        },
      );
      expect(adminRes.ok, "Admin auth must succeed before row-rule test can run").toBe(true);
      const { token: adminToken } = (await adminRes.json()) as { token: string };

      const suffix = Date.now();
      const userAEmail = `w71-rr-a-${suffix}@staffd.test`;
      const userBEmail = `w71-rr-b-${suffix}@staffd.test`;
      const pwd = "T17RowRuleTest!";

      let userAId = "";
      let userBId = "";
      let taskId = "";

      try {
        // Create user A (no email verification needed — admin-created)
        const resA = await fetch(`${pb}/api/collections/users/records`, {
          method: "POST",
          headers: { Authorization: adminToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userAEmail,
            password: pwd,
            passwordConfirm: pwd,
            emailVisibility: false,
          }),
        });
        expect(resA.ok, `Create user A failed: ${resA.status}`).toBe(true);
        userAId = ((await resA.json()) as { id: string }).id;

        // Create user B
        const resB = await fetch(`${pb}/api/collections/users/records`, {
          method: "POST",
          headers: { Authorization: adminToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            email: userBEmail,
            password: pwd,
            passwordConfirm: pwd,
            emailVisibility: false,
          }),
        });
        expect(resB.ok, `Create user B failed: ${resB.status}`).toBe(true);
        userBId = ((await resB.json()) as { id: string }).id;

        // Log in as user B → user-level token (row rules apply to user-level tokens)
        const loginB = await fetch(`${pb}/api/collections/users/auth-with-password`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ identity: userBEmail, password: pwd }),
        });
        expect(loginB.ok, "Login as user B failed").toBe(true);
        const { token: tokenB } = (await loginB.json()) as { token: string };

        // Admin creates a workflow_task owned by user A
        const createTask = await fetch(`${pb}/api/collections/workflow_tasks/records`, {
          method: "POST",
          headers: { Authorization: adminToken, "Content-Type": "application/json" },
          body: JSON.stringify({
            user: userAId,
            workflow_id: "",
            department_id: "marketing",
            input_payload: { task: "w71 row-rule isolation test" },
            status: "pending",
            depends_on: [],
            retry_count: 0,
          }),
        });
        expect(createTask.ok, `Create task failed: ${createTask.status}`).toBe(true);
        taskId = ((await createTask.json()) as { id: string }).id;

        // ── THE ASSERTION: user B cannot read user A's record ────────────
        // PB evaluates: `user = @request.auth.id` → userAId = userBId → false → 404
        const readAsB = await fetch(
          `${pb}/api/collections/workflow_tasks/records/${taskId}`,
          { headers: { Authorization: tokenB } },
        );

        expect(
          readAsB.status,
          "PB must return 404 when USER_OWNED_RULES deny cross-user access. " +
          "If this is 200, the row rules are NOT applied — run POST /api/setup/workflow-tasks first.",
        ).toBe(404);
      } finally {
        // Always clean up test fixtures, even on failure
        const h = { Authorization: adminToken };
        if (taskId) {
          await fetch(`${pb}/api/collections/workflow_tasks/records/${taskId}`, { method: "DELETE", headers: h }).catch(() => null);
        }
        if (userAId) {
          await fetch(`${pb}/api/collections/users/records/${userAId}`, { method: "DELETE", headers: h }).catch(() => null);
        }
        if (userBId) {
          await fetch(`${pb}/api/collections/users/records/${userBId}`, { method: "DELETE", headers: h }).catch(() => null);
        }
      }
    },
    30_000, // 30s for real PB network round-trips
  );
});
