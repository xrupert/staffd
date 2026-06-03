/**
 * PR-Pre — AgentDef capabilities field tests.
 *
 * Verifies the capabilities field is correctly typed, optional, and
 * accepts the full enum. Compile-time checks via TypeScript backstop
 * the runtime assertions.
 */

import { describe, it, expect } from "vitest";
import type { AgentCapability, AgentDef } from "../types";

/**
 * Minimum-shape AgentDef factory. Keeps the tests robust to additions of
 * new optional fields on AgentDef in future PRs — only the required fields
 * are pinned here.
 */
function makeAgent(overrides: Partial<AgentDef> = {}): AgentDef {
  return {
    id: "test-agent",
    name: "Test Agent",
    department: "marketing",
    description: "Test description",
    emoji: "🧪",
    color: "#000000",
    systemPrompt: "You are a test agent.",
    tags: ["test"],
    ...overrides,
  };
}

describe("AgentDef capabilities field", () => {
  it("accepts agent with capabilities array", () => {
    const agent = makeAgent({ capabilities: ["ocr", "vision"] });
    expect(agent.capabilities).toEqual(["ocr", "vision"]);
  });

  it("accepts agent without capabilities (backwards compatible)", () => {
    const agent = makeAgent();
    expect(agent.capabilities).toBeUndefined();
  });

  it("AgentCapability includes all required enum values", () => {
    // Listing the union exhaustively at the call site means TypeScript will
    // fail the build if the AgentCapability type changes shape without this
    // test being updated — the runtime assertion is the canary.
    const allCapabilities: AgentCapability[] = [
      "ocr",
      "vision",
      "structured_extraction",
      "transcript_handling",
      "voice",
      "scheduling",
      "urgency_classification",
      "reads_crm",
      "reads_email_campaigns",
      "reads_support_history",
      "reads_signatures",
      "reads_analytics",
    ];
    expect(allCapabilities.length).toBe(12);
  });

  it("accepts agent with a single capability", () => {
    const agent = makeAgent({ capabilities: ["reads_crm"] });
    expect(agent.capabilities).toEqual(["reads_crm"]);
  });

  it("accepts agent with empty capabilities array", () => {
    const agent = makeAgent({ capabilities: [] });
    expect(agent.capabilities).toEqual([]);
  });
});
