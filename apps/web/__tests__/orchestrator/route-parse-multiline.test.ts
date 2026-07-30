/**
 * PR-UX-1 — parseDecision tolerates pretty-printed (multiline) JSON.
 * The live "fall promotion" incident: the model returned a formatted JSON
 * block, the per-line scan missed it, and the route silently degraded to
 * the fallback department.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = { create: async () => ({}), stream: () => ({}) };
  },
}));

import { parseDecision } from "../../app/api/_lib/orchestrator/handlers/route";

describe("parseDecision — format tolerance", () => {
  it("single-line ROUTE: form (canonical)", () => {
    const r = parseDecision('ROUTE:{"department":"legal","agentId":"legal-compliance-checker","task":"Assess the claim","rationale":"x","lockedAlternative":"","multiDept":false}');
    expect(r?.decision.department).toBe("legal");
    expect(r?.decision.agentId).toBe("legal-compliance-checker");
  });

  it("pretty-printed multiline JSON (the live incident shape)", () => {
    const r = parseDecision(`Here's my routing decision:\nROUTE:{\n  "department": "marketing",\n  "agentId": "marketing-campaign-planner",\n  "task": "Plan the fall promotion",\n  "rationale": "Your Campaign Planner owns this.",\n  "lockedAlternative": "",\n  "multiDept": true\n}`);
    expect(r?.decision.department).toBe("marketing");
    expect(r?.decision.multiDept).toBe(true);
  });

  it("bare multiline JSON without the ROUTE: prefix", () => {
    const r = parseDecision(`{\n  "department": "finance",\n  "task": "Build the budget"\n}`);
    expect(r?.decision.department).toBe("finance");
  });

  it("still null on garbage", () => {
    expect(parseDecision("I'd route this to marketing probably")).toBeNull();
  });
});
