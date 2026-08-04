import { describe, expect, it, vi } from "vitest";
import { planMission } from "./mission-control";
import { createMission } from "./mission-repository";

const plan = planMission({
  goal: "Launch an email campaign",
  requestedBy: "user-1",
});

describe("createMission", () => {
  it("persists approval-aware mission state and evidence", async () => {
    const createRecord = vi.fn(async (body) => ({ id: "mission-record-1", ...body }));

    const record = await createMission(
      {
        userId: "user-1",
        outcomeId: "launch-email-campaign",
        plan,
        approvalRequired: true,
        evidence: ["audience", "campaign draft", "approval", "send results"],
        correlationId: "corr-1",
      },
      { createRecord },
    );

    expect(record.status).toBe("waiting_for_approval");
    expect(record.plan.steps).toEqual(plan.steps);
    expect(record.evidence).toContain("approval");
    expect(createRecord).toHaveBeenCalledOnce();
  });

  it("rejects an ownerless mission", async () => {
    await expect(
      createMission(
        {
          userId: "",
          outcomeId: "launch-email-campaign",
          plan,
          approvalRequired: true,
          evidence: [],
          correlationId: "corr-1",
        },
        { createRecord: vi.fn() },
      ),
    ).rejects.toThrow("Mission owner is required");
  });
});
