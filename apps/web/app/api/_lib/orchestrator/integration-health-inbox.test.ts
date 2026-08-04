import { describe, expect, it } from "vitest";
import { integrationHealthInboxItem } from "./integration-health-inbox";

describe("integrationHealthInboxItem", () => {
  const now = new Date("2026-08-05T00:00:00.000Z");

  it("creates repair work for a configured unhealthy integration", () => {
    const item = integrationHealthInboxItem({
      type: "chatwoot",
      configured: true,
      healthy: false,
      error: "401 unauthorized",
    }, now);

    expect(item).toMatchObject({
      id: "integration:chatwoot:integration_incident:health:chatwoot",
      priority: "high",
      title: "Customer support needs reconnection",
      actionHref: "/dashboard/settings?tab=integrations",
      occurredAt: now.toISOString(),
    });
    expect(item?.evidence).toEqual(["401 unauthorized"]);
  });

  it("ignores healthy and unconfigured integrations", () => {
    expect(integrationHealthInboxItem({
      type: "twenty",
      configured: true,
      healthy: true,
    }, now)).toBeNull();

    expect(integrationHealthInboxItem({
      type: "docuseal",
      configured: false,
      healthy: false,
    }, now)).toBeNull();
  });
});
