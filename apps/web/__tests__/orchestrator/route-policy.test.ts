/**
 * PR-Tranche-2.6.5 (W37) — route intent deadline + retry budget pin.
 *
 * Regression guard: if anyone bumps these back down without explicit
 * SA approval, this test breaks. W37 raised the budget to absorb
 * transient Anthropic latency / rate-limit blips that were intermittently
 * degrading prompts post-T2.6.4.
 */

import { describe, it, expect } from "vitest";
import { policyFor } from "../../app/api/_lib/orchestrator/policies";

describe("route intent policy (W37 budget bump)", () => {
  it("deadlineMs is 8000 (bumped from 4000 in T2.6.5)", () => {
    const policy = policyFor("route");
    expect(policy.deadlineMs).toBe(8000);
  });

  it("retries is 3 (bumped from 0 in T2.6.5)", () => {
    const policy = policyFor("route");
    expect(policy.retries).toBe(3);
  });

  it("other policy fields untouched (regression guard)", () => {
    const policy = policyFor("route");
    expect(policy.maxTokens).toBe(512);
    expect(policy.vaultTopK).toBe(3);
    expect(policy.vaultMaxTokens).toBe(1000);
    expect(policy.messageCap).toBe(6);
    expect(policy.systemAgentId).toBe("ceo-agents-orchestrator");
  });

  it("other intent policies untouched by route bump (regression guard)", () => {
    const handoff = policyFor("handoff");
    expect(handoff.deadlineMs).toBe(6000);
    expect(handoff.retries).toBe(0);
    const brief = policyFor("brief");
    expect(brief.deadlineMs).toBe(25000);
    expect(brief.retries).toBe(1);
  });
});
