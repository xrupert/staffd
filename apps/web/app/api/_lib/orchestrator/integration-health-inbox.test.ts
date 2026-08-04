import { describe, expect, it } from "vitest";
import {
  customerFacingProbeError,
  integrationIncidentInboxItem,
} from "./integration-health-inbox";

describe("customerFacingProbeError", () => {
  it("translates authentication, timeout, and network errors", () => {
    expect(customerFacingProbeError("401 invalid token")).toBe("The saved credentials were rejected");
    expect(customerFacingProbeError("probe timed out")).toBe("The connection check timed out");
    expect(customerFacingProbeError("fetch failed")).toBe("The connected service could not be reached");
  });

  it("does not leak unknown provider details", () => {
    expect(customerFacingProbeError("Vendor-specific internal failure details")).toBe("The connection check failed");
  });
});

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
      evidence: ["The saved credentials were rejected"],
      actionLabel: "Repair the connection",
      actionHref: "/dashboard/settings",
      occurredAt: "2026-08-04T18:00:00.000Z",
    });
  });

  it("uses capability language instead of exposing provider names", () => {
    const item = integrationIncidentInboxItem("twenty", undefined);

    expect(item.title).toBe("Sales workspace needs attention");
    expect(item.summary).not.toContain("Twenty");
    expect(item.evidence).toEqual(["The connection check failed"]);
  });
});
