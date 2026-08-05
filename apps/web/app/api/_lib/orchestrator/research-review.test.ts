import { describe, expect, it } from "vitest";
import { researchReviewPatch } from "./research-review";

describe("research review transitions", () => {
  it("approves a pending record with reviewer evidence", () => {
    expect(researchReviewPatch("pending", "approved", "owner-1", new Date("2026-08-05T16:00:00Z"))).toEqual({
      review_status: "approved",
      reviewed_at: "2026-08-05T16:00:00.000Z",
      reviewed_by: "owner-1",
    });
  });

  it("rejects a pending record", () => {
    expect(researchReviewPatch("pending", "rejected", "owner-1").review_status).toBe("rejected");
  });

  it.each(["not_required", "approved", "rejected", "superseded"] as const)(
    "refuses a transition from %s",
    (status) => {
      expect(() => researchReviewPatch(status, "approved", "owner-1")).toThrow("cannot transition");
    },
  );

  it("requires reviewer identity", () => {
    expect(() => researchReviewPatch("pending", "approved", " ")).toThrow("requires a reviewer");
  });
});
