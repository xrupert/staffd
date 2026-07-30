/**
 * PR-Loop-V4 (#9) — strategic mental models: CEO-department specialists
 * carry the anonymous thinking-discipline block; doers do not; and the
 * block never names the experts the models came from (brand law).
 */

import { describe, it, expect } from "vitest";
import { allAgents, getAgent } from "../index";
import { STRATEGIC_MENTAL_MODELS, MENTAL_MODEL_DEPARTMENTS } from "../mental-models";

describe("strategic mental models (PR-Loop-V4 #9)", () => {
  it("every CEO-department agent carries the discipline block", () => {
    const ceoAgents = allAgents.filter((a) => a.department === "ceo");
    expect(ceoAgents.length).toBeGreaterThan(0);
    for (const a of ceoAgents) {
      expect(a.systemPrompt).toContain("THINKING DISCIPLINE");
      expect(a.systemPrompt).toContain("WORK BACKWARDS");
      expect(a.systemPrompt).toContain("INVERT");
    }
  });

  it("doer departments do NOT carry it", () => {
    for (const dept of ["marketing", "legal", "design"]) {
      const agent = allAgents.find((a) => a.department === dept);
      expect(agent?.systemPrompt).not.toContain("THINKING DISCIPLINE");
    }
  });

  it("the block names no real people (brand law)", () => {
    for (const name of ["Bezos", "Munger", "Buffett", "Graham", "Amazon", "Berkshire"]) {
      expect(STRATEGIC_MENTAL_MODELS).not.toContain(name);
    }
  });

  it("registry: only ceo is enrolled", () => {
    expect([...MENTAL_MODEL_DEPARTMENTS]).toEqual(["ceo"]);
  });

  it("getAgent resolves an enriched CEO agent end-to-end", () => {
    const chief = allAgents.find((a) => a.department === "ceo");
    expect(chief).toBeTruthy();
    expect(getAgent(chief!.id)?.systemPrompt).toContain("SECOND-ORDER EFFECTS");
  });
});
