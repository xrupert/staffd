import { describe, expect, it } from "vitest";
import { bookingInboxItem, buildBusinessInbox, missionInboxItem } from "./business-inbox";

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
});
