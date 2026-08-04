import type { MissionPlan } from "./mission-control";

export type CreatedWorkflow = { id: string };
export type CreatedTask = { id: string };

export type MissionWorkflowBridgeDeps = {
  createWorkflow: (body: Record<string, unknown>) => Promise<CreatedWorkflow>;
  createTask: (body: Record<string, unknown>) => Promise<CreatedTask>;
  failWorkflow: (workflowId: string, reason: string) => Promise<void>;
};

export type MissionWorkflowBridgeInput = {
  missionId: string;
  userId: string;
  plan: MissionPlan;
};

export type MissionWorkflowBridgeResult = {
  workflowId: string;
  taskIdsByStep: Record<string, string>;
};

function departmentFor(capability: MissionPlan["steps"][number]["capability"]): string {
  return capability === "business_architecture" ? "ceo" : capability;
}

export async function createWorkflowFromMission(
  input: MissionWorkflowBridgeInput,
  deps: MissionWorkflowBridgeDeps,
): Promise<MissionWorkflowBridgeResult> {
  const workflow = await deps.createWorkflow({
    user: input.userId,
    name: input.plan.goal,
    status: "pending",
    root_goal: input.plan.goal,
    started_at: new Date().toISOString(),
    review_required: input.plan.steps.some((step) => step.approvalRequired),
  });

  const taskIdsByStep: Record<string, string> = {};
  try {
    for (const step of input.plan.steps) {
      const dependsOn = step.dependsOn.map((dependency) => {
        const taskId = taskIdsByStep[dependency];
        if (!taskId) throw new Error(`Mission dependency ${dependency} has not been materialized`);
        return taskId;
      });

      const task = await deps.createTask({
        workflow_id: workflow.id,
        user: input.userId,
        specialist_id: null,
        department_id: departmentFor(step.capability),
        input_payload: {
          mission_id: input.missionId,
          mission_step_id: step.id,
          task: step.title,
          success_criteria: step.successCriteria,
          max_attempts: step.maxAttempts,
        },
        output_payload: null,
        status: "pending",
        depends_on: dependsOn,
        retry_count: 0,
        error: "",
        started_at: "",
        completed_at: "",
        cost_estimate_tokens: 0,
        cost_actual_tokens: 0,
      });
      taskIdsByStep[step.id] = task.id;
    }
  } catch (error) {
    await deps.failWorkflow(
      workflow.id,
      error instanceof Error ? error.message : "Mission task materialization failed",
    );
    throw error;
  }

  return { workflowId: workflow.id, taskIdsByStep };
}
