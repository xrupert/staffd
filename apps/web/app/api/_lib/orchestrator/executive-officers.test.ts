import { describe, expect, it } from "vitest";
import {
  EXECUTIVE_OFFICERS,
  executiveOfficerPublicLabel,
} from "./executive-officers";

describe("STAFFD executive officers", () => {
  it("presents the approved CEO, COO, and CSO titles", () => {
    expect(executiveOfficerPublicLabel("ceo")).toBe("CEO — Chief Executive Officer");
    expect(executiveOfficerPublicLabel("coo")).toBe("COO — Chief Orchestrating Officer");
    expect(executiveOfficerPublicLabel("cso")).toBe("CSO — Chief Science Officer");
  });

  it("keeps prioritization, orchestration, and proof as separate responsibilities", () => {
    expect(EXECUTIVE_OFFICERS.ceo.primaryQuestion).toContain("most valuable");
    expect(EXECUTIVE_OFFICERS.coo.primaryQuestion).toContain("completed work");
    expect(EXECUTIVE_OFFICERS.cso.primaryQuestion).toContain("prove");
  });

  it("allows only the COO to coordinate execution", () => {
    expect(EXECUTIVE_OFFICERS.ceo.mayExecute).toBe(false);
    expect(EXECUTIVE_OFFICERS.coo.mayExecute).toBe(true);
    expect(EXECUTIVE_OFFICERS.cso.mayExecute).toBe(false);
  });
});
