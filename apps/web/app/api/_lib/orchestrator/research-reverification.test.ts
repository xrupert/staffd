import { describe, expect, it } from "vitest";
import {
  buildReverificationQuery,
  evaluateReverification,
  nextReverificationDeadline,
  type ResearchKnowledgeRecord,
} from "./research-reverification";

const approved: ResearchKnowledgeRecord = {
  id: "r1",
  user: "u1",
  topic: "Accounting",
  claim: "The procedure remains compliant.",
  risk: "high",
  review_status: "approved",
  verified_at: "2026-06-01T00:00:00.000Z",
  reverify_after: "2026-07-01T00:00:00.000Z",
};

describe("research re-verification", () => {
  it("marks approved expired knowledge as due", () => {
    expect(evaluateReverification(approved, new Date("2026-08-05T00:00:00.000Z"))).toEqual({
      due: true,
      reason: "approved_knowledge_expired",
    });
  });

  it("does not reverify pending, future, or superseded records", () => {
    expect(evaluateReverification({ ...approved, review_status: "pending" }, new Date("2026-08-05T00:00:00.000Z")).due).toBe(false);
    expect(evaluateReverification({ ...approved, reverify_after: "2026-09-01T00:00:00.000Z" }, new Date("2026-08-05T00:00:00.000Z")).due).toBe(false);
    expect(evaluateReverification({ ...approved, superseded_by: "r2" }, new Date("2026-08-05T00:00:00.000Z")).due).toBe(false);
  });

  it("uses tighter deadlines for high-risk knowledge", () => {
    const from = new Date("2026-08-05T00:00:00.000Z");
    expect(nextReverificationDeadline("high", from)).toBe("2026-09-04T00:00:00.000Z");
    expect(nextReverificationDeadline("standard", from)).toBe("2026-11-03T00:00:00.000Z");
  });

  it("builds an adversarial current-evidence query", () => {
    const query = buildReverificationQuery(approved);
    expect(query).toContain(approved.claim);
    expect(query).toContain("primary and authoritative sources");
    expect(query).toContain("do not assume the prior conclusion");
  });
});
