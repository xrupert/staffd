import { describe, expect, it } from "vitest";
import { reconcileMissionExecution } from "./mission-execution-sync";

describe("reconcileMissionExecution", () => {
  it("marks active work running and emits step events once", () => {
    const first = reconcileMissionExecution({
      missionId: "mission-1",
      currentStatus: "planned",
      tasks: [
        { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" }, cost_actual_tokens: 1200 },
        { id: "task-2", status: "running", input_payload: { mission_step_id: "step-2" } },
      ],
    });

    expect(first.status).toBe("running");
    expect(first.pending_events.map((event) => event.key)).toEqual([
      "mission-1:step-1:completed",
      "mission-1:step-2:started",
    ]);
    expect(first.pending_events[0]?.costCredits).toBe(2);

    const second = reconcileMissionExecution({
      missionId: "mission-1",
      currentStatus: first.status,
      pendingEvents: first.pending_events,
      tasks: [
        { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" }, cost_actual_tokens: 1200 },
        { id: "task-2", status: "running", input_payload: { mission_step_id: "step-2" } },
      ],
    });
    expect(second.pending_events).toHaveLength(2);
  });

  it("completes only when every task succeeds", () => {
    const result = reconcileMissionExecution({
      missionId: "mission-2",
      currentStatus: "running",
      tasks: [
        { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" } },
        { id: "task-2", status: "succeeded", input_payload: { mission_step_id: "step-2" } },
      ],
    });
    expect(result.status).toBe("completed");
    expect(result.pending_events.some((event) => event.type === "mission_completed")).toBe(true);
  });

  it("moves terminal failures into repair", () => {
    const result = reconcileMissionExecution({
      missionId: "mission-3",
      currentStatus: "running",
      tasks: [
        { id: "task-1", status: "succeeded", input_payload: { mission_step_id: "step-1" } },
        { id: "task-2", status: "failed", input_payload: { mission_step_id: "step-2" }, error: "Reviewer rejected the output" },
      ],
    });
    expect(result.status).toBe("repairing");
    expect(result.pending_events.some((event) => event.type === "step_escalated")).toBe(true);
  });
});
