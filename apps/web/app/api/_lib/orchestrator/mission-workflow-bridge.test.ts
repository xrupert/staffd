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

  it("carries trusted mission constraints and graph context into every workflow task", async () => {
    const base = planMission({ goal: "Launch a campaign", requestedBy: "user-1" });
    const plan = {
      ...base,
      constraints: ["policy: Campaigns above $5,000 require owner approval"],
      planningContext: {
        source: "business_knowledge_graph" as const,
        generatedAt: "2026-08-10T12:00:00.000Z",
        degraded: false,
        items: [{
          nodeId: "policy:knowledge-1",
          type: "policy" as const,
          label: "Campaigns above $5,000 require owner approval",
          confidence: 0.95,
          provenance: ["business_knowledge:knowledge-1"],
        }],
        constraints: ["policy: Campaigns above $5,000 require owner approval"],
        priorOutcomes: [],
        warnings: [],
      },
    };
    const createTask = vi.fn(async (_body: Record<string, unknown>) => ({ id: `task-${createTask.mock.calls.length + 1}` }));

    await createWorkflowFromMission(
      { missionId: "mission-1", userId: "user-1", plan },
      {
        createWorkflow: vi.fn(async () => ({ id: "workflow-1" })),
        createTask,
        failWorkflow: vi.fn(),
      },
    );

    for (const [body] of createTask.mock.calls) {
      expect(body.input_payload).toMatchObject({
        mission_constraints: ["policy: Campaigns above $5,000 require owner approval"],
        planning_context: { source: "business_knowledge_graph", degraded: false },
      });
    }
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
