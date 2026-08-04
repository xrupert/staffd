import { describe, expect, it } from "vitest";
import {
  createPendingMissionEvent,
  enqueueMissionEvent,
  removeDeliveredMissionEvents,
} from "./mission-outbox";

describe("mission outbox", () => {
  it("creates deterministic queued events when a key and timestamp are supplied", () => {
    const event = createPendingMissionEvent({
      key: "approval-1",
      now: "2026-08-04T18:10:00.000Z",
      type: "mission_approved",
      message: "Approved",
    });

    expect(event).toMatchObject({
      key: "approval-1",
      queuedAt: "2026-08-04T18:10:00.000Z",
      type: "mission_approved",
    });
  });

  it("does not enqueue the same event twice", () => {
    const event = createPendingMissionEvent({
      key: "approval-1",
      type: "mission_approved",
      message: "Approved",
    });

    expect(enqueueMissionEvent([event], event)).toEqual([event]);
  });

  it("removes only successfully delivered events", () => {
    const first = createPendingMissionEvent({ key: "1", type: "mission_started", message: "Started" });
    const second = createPendingMissionEvent({ key: "2", type: "mission_failed", message: "Failed" });

    expect(removeDeliveredMissionEvents([first, second], new Set(["1"]))).toEqual([second]);
  });
});
