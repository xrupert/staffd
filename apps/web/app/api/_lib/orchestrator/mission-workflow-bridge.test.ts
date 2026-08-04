import { describe, expect, it, vi } from "vitest";
import { planMission } from "./mission-control";
import { createWorkflowFromMission } from "./mission-workflow-bridge";

describe("createWorkflowFromMission", () => {
  it("materializes mission dependencies as workflow task ids", async () => {
    const plan = planMission({
      goal: "Launch a viral campaign and measure performance",
      requestedBy: "user-1",
    });
    let taskCounter = 0;
    const taskBodies: Record<string, unknown>[] = [];
    const createTask = vi.fn(async (body: Record<string, unknown>) => {
      taskBodies.push(body);
      return { id: `task-${++taskCounter}` };
    });

    const result = await createWorkflowFromMission(
      { missionId: "mission-1", userId: "user-1", plan },
      {
        createWorkflow: vi.fn(async () => ({ id: "workflow-1" })),
        createTask,
        failWorkflow: vi.fn(),
      },
    );

    expect(result.workflowId).toBe("workflow-1");
    expect(Object.keys(result.taskIdsByStep)).toHaveLength(plan.steps.length);
    expect(createTask).toHaveBeenCalledTimes(plan.steps.length);
    expect(taskBodies[1]?.depends_on).toEqual(["task-1"]);
  });

  it("marks the workflow failed when task materialization breaks", async () => {
    const plan = planMission({ goal: "Review business performance", requestedBy: "user-1" });
    const failWorkflow = vi.fn(async () => undefined);

    await expect(
      createWorkflowFromMission(
        { missionId: "mission-1", userId: "user-1", plan },
        {
          createWorkflow: vi.fn(async () => ({ id: "workflow-1" })),
          createTask: vi.fn(async () => { throw new Error("PocketBase unavailable"); }),
          failWorkflow,
        },
      ),
    ).rejects.toThrow("PocketBase unavailable");

    expect(failWorkflow).toHaveBeenCalledWith("workflow-1", "PocketBase unavailable");
  });
});
