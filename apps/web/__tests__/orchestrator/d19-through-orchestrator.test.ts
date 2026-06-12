/**
 * W61′ — D-19 chain pin THROUGH the orchestrator envelope.
 *
 * Real handler, real registry, real bridging helper: an industry-bridged
 * restaurant user whose route decision comes back without an agentId falls
 * through to the smart picker, which must surface the restaurants pack
 * specialist (activePacks pool inclusion + 1.5× industry boost — the full
 * W58/W58.0.1/W59 chain) inside intent:"route".
 *
 * Only the LLM, vault IO, trial IO, and logging are mocked — the routing
 * brain runs for real.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../app/api/_lib/orchestrator/llm", () => ({
  callLLM: async () => ({
    ok: true,
    // Department-only decision (no agentId) — triggers pickAgentForDept.
    text: 'ROUTE:{"department":"finance","task":"help with a vendor invoice","rationale":"Finance fits.","lockedAlternative":""}',
    attempts: 1,
    latencyMs: 10,
    tokensIn: 100,
    tokensOut: 50,
    model: "test",
    costUsd: 0,
  }),
}));

vi.mock("../../app/api/_lib/vault", () => ({
  fetchVault: async () => ({
    id: "biz_1",
    business_name: "Luigi's",
    industry: "Italian restaurant",
    industry_category: "restaurants",
  }),
  renderVaultBlock: () => "",
  retrieve: async () => ({ items: [], costFlag: "ok", tokensReturned: 0, latencyMs: 0 }),
  vaultLines: () => [],
}));

vi.mock("../../app/api/_lib/vault/voice", () => ({
  getVoiceBlock: async () => "",
}));

vi.mock("../../app/api/_lib/vault/outcomes", () => ({
  fetchRecentDecisions: async () => [],
}));

vi.mock("../../app/api/_lib/trial", () => ({
  resolveDepartments: async (_userId: string, opts?: { vaultIndustry?: string | null }) => ({
    plan: "growth",
    resolved: ["marketing", "sales", "legal", "finance"],
    unlockedDepartments: ["finance"],
    trialRuns: {},
    needsDepartmentSelection: false,
    subId: "sub_1",
    comp: false,
    // Mirror the real W58.0.1 bridging: industry resolves → pack activates.
    activePacks: opts?.vaultIndustry ? ["restaurants"] : [],
  }),
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbFirst: async () => null,
}));

vi.mock("../../app/api/_lib/orchestrator/logger", () => ({
  logDecision: async () => undefined,
}));

import { runOrchestrator } from "../../app/api/_lib/orchestrator";

describe("D-19 through the orchestrator (W61′)", () => {
  it("intent:'route' surfaces the restaurants pack specialist for the bridged user", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({}) })));

    const response = await runOrchestrator({
      intent: "route",
      userId: "user-1",
      pbToken: "tok",
      context: { message: "help with a vendor invoice" },
    });

    expect(response.ok).toBe(true);
    if (response.ok) {
      expect(response.decision.department).toBe("finance");
      // The W58 boost in action: pack specialist beats the generic
      // invoice generator on the 1-tag tie because the user's industry
      // matches (verified W58 Test 4 scenario, now pinned inside the
      // orchestrator envelope).
      expect(response.decision.agentId).toBe("pack-restaurants-finance-cogs-tracker");
    }
    vi.unstubAllGlobals();
  });
});
