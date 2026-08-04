import { describe, expect, it } from "vitest";
import { integrationIncidentInboxItem } from "./integration-health-inbox";

describe("integrationIncidentInboxItem", () => {
  it("creates a critical customer-facing repair item", () => {
    const item = integrationIncidentInboxItem(
      "chatwoot",
      "401 invalid token",
      new Date("2026-08-04T18:00:00.000Z"),
    );

    expect(item).toMatchObject({
      id: "integration:chatwoot:integration_incident:chatwoot",
      source: "integration",
      sourceId: "chatwoot",
      kind: "incoming",
      priority: "critical",
      title: "Customer support needs attention",
      summary: "STAFFD cannot currently use the connected customer support service.",
      evidence: ["401 invalid token"],
      actionLabel: "Repair the connection",
      actionHref: "/dashboard/settings",
      occurredAt: "2026-08-04T18:00:00.000Z",
    });
  });

  it("uses capability language instead of exposing provider names", () => {
    const item = integrationIncidentInboxItem("twenty", undefined);

    expect(item.title).toBe("Sales workspace needs attention");
    expect(item.summary).not.toContain("Twenty");
    expect(item.evidence).toEqual(["The connection probe failed"]);
  });
});
