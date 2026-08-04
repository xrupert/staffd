import { describe, expect, it } from "vitest";
import { twentyOpportunityNeedsFollowUp } from "./live-inbox-sources";

describe("twentyOpportunityNeedsFollowUp", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("flags active opportunities older than seven days", () => {
    expect(twentyOpportunityNeedsFollowUp({
      id: "opp-1",
      name: "Roofing account",
      stage: "NEW",
      createdAt: "2026-07-20T12:00:00.000Z",
    }, now)).toBe(true);
  });

  it("does not flag recent opportunities", () => {
    expect(twentyOpportunityNeedsFollowUp({
      id: "opp-2",
      name: "Recent lead",
      stage: "NEW",
      createdAt: "2026-08-01T12:00:00.000Z",
    }, now)).toBe(false);
  });

  it("does not flag closed opportunities", () => {
    expect(twentyOpportunityNeedsFollowUp({
      id: "opp-3",
      name: "Won deal",
      stage: "CLOSED_WON",
      createdAt: "2026-07-01T12:00:00.000Z",
    }, now)).toBe(false);
  });

  it("rejects missing or invalid timestamps", () => {
    expect(twentyOpportunityNeedsFollowUp({ id: "opp-4", name: "Unknown" }, now)).toBe(false);
    expect(twentyOpportunityNeedsFollowUp({ id: "opp-5", name: "Bad", createdAt: "not-a-date" }, now)).toBe(false);
  });
});
