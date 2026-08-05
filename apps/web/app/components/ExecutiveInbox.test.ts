import { describe, expect, it } from "vitest";
import { buildInboxActionPrompt, isResearchReviewItem, type ExecutiveInboxItem } from "./ExecutiveInbox";

const baseItem: ExecutiveInboxItem = {
  id: "integration:chatwoot:customer_message:42",
  kind: "incoming",
  priority: "critical",
  title: "A customer has been waiting",
  summary: "Jordan has an unresolved support conversation.",
  evidence: ["28 hours since the last activity", "Conversation remains open"],
  actionLabel: "Review the conversation",
  actionHref: "/dashboard/reputation",
};

describe("buildInboxActionPrompt", () => {
  it("turns an inbox signal into a specific governed request", () => {
    const prompt = buildInboxActionPrompt(baseItem);

    expect(prompt).toContain("Review the conversation");
    expect(prompt).toContain("Jordan has an unresolved support conversation");
    expect(prompt).toContain("28 hours since the last activity");
    expect(prompt).toContain("do not send or publish anything without my approval");
  });

  it("does not invent evidence when none was supplied", () => {
    const prompt = buildInboxActionPrompt({ ...baseItem, evidence: [] });

    expect(prompt).not.toContain("Evidence:");
    expect(prompt).toContain(baseItem.summary);
  });
});

describe("isResearchReviewItem", () => {
  it("recognizes governed research approvals", () => {
    expect(isResearchReviewItem({
      ...baseItem,
      source: "research",
      sourceId: "record-1",
      kind: "approval",
    })).toBe(true);
  });

  it("does not treat generic approvals as research decisions", () => {
    expect(isResearchReviewItem({
      ...baseItem,
      source: "mission",
      sourceId: "mission-1",
      kind: "approval",
    })).toBe(false);
  });
});
