import { describe, expect, it } from "vitest";
import {
  docusealSubmissionNeedsReminder,
  listmonkCampaignNeedsAttention,
  twentyOpportunityNeedsFollowUp,
} from "./live-inbox-sources";

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

describe("listmonkCampaignNeedsAttention", () => {
  it("flags meaningful campaigns with poor opens", () => {
    expect(listmonkCampaignNeedsAttention({
      id: 1,
      status: "finished",
      sent: 1000,
      views: 90,
      bounces: 5,
    })).toBe(true);
  });

  it("flags campaigns with elevated bounces", () => {
    expect(listmonkCampaignNeedsAttention({
      id: 2,
      status: "finished",
      sent: 500,
      views: 200,
      bounces: 30,
    })).toBe(true);
  });

  it("ignores drafts and campaigns without enough recipients", () => {
    expect(listmonkCampaignNeedsAttention({ id: 3, status: "draft", sent: 1000, views: 1 })).toBe(false);
    expect(listmonkCampaignNeedsAttention({ id: 4, status: "finished", sent: 20, views: 0 })).toBe(false);
  });
});

describe("docusealSubmissionNeedsReminder", () => {
  const now = new Date("2026-08-04T12:00:00.000Z");

  it("flags pending signature requests older than three days", () => {
    expect(docusealSubmissionNeedsReminder({
      id: 1,
      status: "pending",
      created_at: "2026-07-29T12:00:00.000Z",
    }, now)).toBe(true);
  });

  it("does not flag recent or completed submissions", () => {
    expect(docusealSubmissionNeedsReminder({
      id: 2,
      status: "pending",
      created_at: "2026-08-03T12:00:00.000Z",
    }, now)).toBe(false);
    expect(docusealSubmissionNeedsReminder({
      id: 3,
      status: "completed",
      created_at: "2026-07-20T12:00:00.000Z",
    }, now)).toBe(false);
  });

  it("rejects missing and invalid creation dates", () => {
    expect(docusealSubmissionNeedsReminder({ id: 4, status: "pending" }, now)).toBe(false);
    expect(docusealSubmissionNeedsReminder({ id: 5, status: "pending", created_at: "bad-date" }, now)).toBe(false);
  });
});
