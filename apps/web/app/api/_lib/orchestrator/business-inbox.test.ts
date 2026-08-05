import { describe, expect, it } from "vitest";
import { bookingInboxItem, buildBusinessInbox, missionInboxItem, researchInboxItem } from "./business-inbox";

describe("business inbox", () => {
  it("prioritizes approval work above completed work", () => {
    const items = buildBusinessInbox([
      missionInboxItem({ id: "done", goal: "Prepare report", status: "completed", updated: "2026-08-04T10:00:00Z" }),
      missionInboxItem({ id: "approval", goal: "Send campaign", status: "waiting_for_approval", updated: "2026-08-03T10:00:00Z" }),
    ]);
    expect(items.map((item) => item.sourceId)).toEqual(["approval", "done"]);
  });

  it("deduplicates stable inbox identifiers", () => {
    const item = missionInboxItem({ id: "m1", goal: "Fix workflow", status: "repairing" });
    expect(buildBusinessInbox([item, item])).toHaveLength(1);
  });

  it("only includes upcoming bookings within 72 hours", () => {
    const now = new Date("2026-08-04T12:00:00Z");
    expect(bookingInboxItem({ id: "soon", start_time: "2026-08-05T12:00:00Z" }, now)?.priority).toBe("high");
    expect(bookingInboxItem({ id: "later", start_time: "2026-08-10T12:00:00Z" }, now)).toBeNull();
    expect(bookingInboxItem({ id: "cancelled", start_time: "2026-08-05T12:00:00Z", status: "cancelled" }, now)).toBeNull();
  });

  it("surfaces pending high-risk research as a critical approval", () => {
    const item = researchInboxItem({
      id: "r1",
      topic: "Payroll compliance",
      claim: "The procedure is current.",
      verified_at: "2026-08-05T12:00:00Z",
      review_status: "pending",
      answer: { confidence: "high", reason: "Two authorities agree." },
      citations: [{ title: "A" }, { title: "B" }],
    });
    expect(item).toMatchObject({
      source: "research",
      kind: "approval",
      priority: "critical",
      sourceId: "r1",
    });
    expect(item?.evidence).toContain("2 cited sources");
  });

  it("hides research that is no longer pending", () => {
    expect(researchInboxItem({
      id: "r1",
      topic: "Payroll compliance",
      claim: "The procedure is current.",
      verified_at: "2026-08-05T12:00:00Z",
      review_status: "approved",
    })).toBeNull();
  });
});
