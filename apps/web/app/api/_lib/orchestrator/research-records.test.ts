import { describe, expect, it } from "vitest";
import { persistResearchBundle, researchRecordFromBundle } from "./research-records";
import type { ResearchVerificationBundle } from "./research-verification";

function bundle(overrides: Partial<ResearchVerificationBundle> = {}): ResearchVerificationBundle {
  return {
    id: "research-abc",
    topic: "current payroll compliance",
    claim: "The supported procedure is current.",
    label: "fact",
    risk: "high",
    verifiedAt: "2026-08-05T12:00:00.000Z",
    verdict: {
      answerable: true,
      confidence: "high",
      reason: "Two authorities agree.",
      agreement: "corroborated",
      requiresHumanReview: true,
      sourceIds: ["a", "b"],
    },
    citations: [
      {
        id: "a",
        title: "Authority A",
        url: "https://example.gov/a",
        sourceClass: "government_or_regulator",
        retrievedAt: "2026-08-05T11:00:00.000Z",
        relationship: "supports",
      },
      {
        id: "b",
        title: "Authority B",
        url: "https://docs.example.com/b",
        sourceClass: "primary_documentation",
        retrievedAt: "2026-08-05T11:05:00.000Z",
        relationship: "supports",
      },
    ],
    answer: {
      supported: true,
      confidence: "high",
      statement: "The supported procedure is current.",
      reason: "Two authorities agree.",
      requiresHumanReview: true,
    },
    ...overrides,
  };
}

describe("research records", () => {
  it("creates a pending review record for high-risk conclusions", () => {
    const record = researchRecordFromBundle("owner-1", bundle());
    expect(record.review_status).toBe("pending");
    expect(record.reverify_after).toBe("2026-12-03T12:00:00.000Z");
    expect(record.citations).toHaveLength(2);
  });

  it("marks ordinary supported conclusions as not requiring review", () => {
    const record = researchRecordFromBundle("owner-1", bundle({
      risk: "standard",
      answer: {
        supported: true,
        confidence: "medium",
        statement: "A supported answer.",
        reason: "One authority supports it.",
        requiresHumanReview: false,
      },
    }));
    expect(record.review_status).toBe("not_required");
  });

  it("persists immutable verification attempts through the supplied store", async () => {
    let capturedUser = "";
    const result = await persistResearchBundle("owner-1", bundle(), {
      create: async (record) => {
        capturedUser = record.user;
        return { id: "record-1" };
      },
    });
    expect(capturedUser).toBe("owner-1");
    expect(result).toEqual({ id: "record-1", reviewStatus: "pending" });
  });

  it("rejects ownerless records", () => {
    expect(() => researchRecordFromBundle(" ", bundle())).toThrow("requires an owner");
  });
});
