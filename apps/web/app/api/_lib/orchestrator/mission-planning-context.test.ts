import { describe, expect, it } from "vitest";
import { buildMissionPlanningContext } from "./mission-planning-context";
import type { KnowledgeGraphNode } from "./business-knowledge-graph";

function node(overrides: Partial<KnowledgeGraphNode>): KnowledgeGraphNode {
  return {
    id: "node-1",
    ownerId: "owner-1",
    type: "policy",
    label: "Campaigns above $5,000 require owner approval",
    properties: {},
    provenance: [{ sourceType: "business_knowledge", sourceId: "knowledge-1", observedAt: "2026-08-01T12:00:00Z" }],
    confidence: 0.95,
    effectiveAt: null,
    expiresAt: null,
    ...overrides,
  };
}

describe("graph-grounded mission planning context", () => {
  it("turns trusted policies, risks, and measured outcomes into compact planning context", () => {
    const context = buildMissionPlanningContext("Launch a campaign and improve qualified leads", [
      node({ id: "policy-1" }),
      node({ id: "risk-1", type: "risk", label: "Campaign frequency can increase unsubscribe risk" }),
      node({ id: "outcome-1", type: "outcome", label: "Shorter qualification flow improved qualified leads", confidence: 0.9 }),
      node({ id: "customer-1", type: "customer", label: "Acme Corporation", confidence: 0.8 }),
    ], new Date("2026-08-10T12:00:00Z"));

    expect(context.constraints).toContain("policy: Campaigns above $5,000 require owner approval");
    expect(context.warnings).toContain("Campaign frequency can increase unsubscribe risk");
    expect(context.priorOutcomes).toContain("Shorter qualification flow improved qualified leads");
    expect(context.items.some((item) => item.nodeId === "customer-1")).toBe(false);
    expect(context.items.find((item) => item.nodeId === "policy-1")?.provenance).toEqual(["business_knowledge:knowledge-1"]);
  });

  it("excludes expired knowledge", () => {
    const context = buildMissionPlanningContext("Launch a campaign", [
      node({ expiresAt: "2026-08-09T00:00:00Z" }),
    ], new Date("2026-08-10T12:00:00Z"));
    expect(context.items).toEqual([]);
  });

  it("caps context to prevent graph dumps from overwhelming the planner", () => {
    const nodes = Array.from({ length: 20 }, (_, index) => node({ id: `policy-${index}`, label: `Campaign policy ${index}` }));
    expect(buildMissionPlanningContext("campaign", nodes).items).toHaveLength(12);
  });

  it("preserves degraded state when graph retrieval is unavailable", () => {
    expect(buildMissionPlanningContext("Run payroll", [], new Date("2026-08-10T12:00:00Z"), true)).toMatchObject({
      degraded: true,
      items: [],
      constraints: [],
    });
  });

  it("rejects an invalid planning timestamp", () => {
    expect(() => buildMissionPlanningContext("Launch campaign", [], new Date("invalid"))).toThrow("Mission planning context time is invalid");
  });
});
