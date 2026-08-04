import { describe, expect, it } from "vitest";
import {
  adaptInboxSource,
  externalInboxItem,
  type InboxSourceAdapter,
} from "./inbox-source-adapters";

describe("externalInboxItem", () => {
  it("normalizes a vendor signal without exposing vendor UI concepts", () => {
    const item = externalInboxItem({
      provider: "Chatwoot",
      sourceId: "conversation-42",
      kind: "customer_message",
      title: "  Customer needs a reply  ",
      summary: "A customer asked for help with an overdue order.",
      occurredAt: "2026-08-04T18:00:00.000Z",
      urgency: "urgent",
      evidence: ["Unread for 2 hours"],
      actionLabel: "Review the conversation",
      actionHref: "/dashboard/inbox/conversation-42",
    });

    expect(item).toMatchObject({
      id: "integration:chatwoot:customer_message:conversation-42",
      source: "integration",
      kind: "incoming",
      priority: "critical",
      title: "Customer needs a reply",
      actionLabel: "Review the conversation",
    });
  });

  it("rejects incomplete or invalid signals", () => {
    expect(externalInboxItem({
      provider: "Twenty",
      sourceId: "",
      kind: "lead_follow_up",
      title: "Follow up",
      summary: "A lead is waiting.",
      occurredAt: "not-a-date",
      actionLabel: "Review lead",
      actionHref: "/dashboard",
    })).toBeNull();
  });
});

describe("adaptInboxSource", () => {
  it("adapts only actionable records", () => {
    type Lead = { id: string; name: string; needsFollowUp: boolean };
    const adapter: InboxSourceAdapter<Lead> = {
      id: "twenty-leads",
      normalize: (lead) => lead.needsFollowUp ? {
        provider: "twenty",
        sourceId: lead.id,
        kind: "lead_follow_up",
        title: "A warm lead needs follow-up",
        summary: `${lead.name} has not received a response.`,
        occurredAt: "2026-08-04T18:00:00.000Z",
        urgency: "important",
        actionLabel: "Prepare follow-up",
        actionHref: `/dashboard/missions?lead=${lead.id}`,
      } : null,
    };

    const items = adaptInboxSource(adapter, [
      { id: "1", name: "Ada", needsFollowUp: true },
      { id: "2", name: "Grace", needsFollowUp: false },
    ]);

    expect(items).toHaveLength(1);
    expect(items[0]?.priority).toBe("high");
    expect(items[0]?.sourceId).toBe("1");
  });
});
