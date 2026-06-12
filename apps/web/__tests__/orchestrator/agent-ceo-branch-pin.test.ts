/**
 * W61′ — /api/agent CEO-branch pin (intent:"synthesize" delegation, B4).
 *
 * department === "ceo" short-circuits the specialist streaming path and
 * delegates to the orchestrator's synthesize handler, streaming the
 * result as a single chunk. Pinned functionally with everything except
 * the route's translation layer mocked.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.example.test";

const orchMocks = vi.hoisted(() => ({
  calls: [] as Array<Record<string, unknown>>,
}));

// The route constructs the SDK client at module scope; stub the SDK so the
// import succeeds without an API key (the CEO branch never touches it).
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = {
      stream: () => { throw new Error("CEO branch must not reach the streaming path"); },
      create: async () => { throw new Error("CEO branch must not reach the streaming path"); },
    };
  },
}));

vi.mock("../../app/api/_lib/orchestrator", () => ({
  runOrchestrator: async (req: Record<string, unknown>) => {
    orchMocks.calls.push(req);
    return {
      ok: true,
      intent: "synthesize",
      decision: { task: "## Synthesis\n\nCross-department answer." },
      latencyMs: 5,
      attempts: 1,
    };
  },
}));
vi.mock("../../app/api/_lib/trial", () => ({
  recordTrialRun: async () => ({ allowed: true, plan: "pro", trialRuns: {}, remaining: 99 }),
  resolveDepartments: async () => ({
    plan: "pro", resolved: ["marketing", "sales", "legal", "ceo"], unlockedDepartments: [],
    trialRuns: {}, needsDepartmentSelection: false, subId: "s", comp: false, activePacks: [],
  }),
}));
vi.mock("../../app/api/_lib/ratelimit", () => ({
  checkAndIncrementRateLimit: async () => ({ allowed: true, remaining: 49 }),
}));
vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin_tok",
  pbUrl: () => "https://pb.example.test",
  pbEscape: (s: string) => s,
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbFirst: async () => null,
}));
vi.mock("../../app/api/_lib/vault", () => ({
  fetchVault: async () => null,
  renderVaultBlock: () => "",
  retrieve: async () => ({ items: [], costFlag: "ok", tokensReturned: 0, latencyMs: 0 }),
  vaultLines: () => [],
}));
vi.mock("../../app/api/_lib/vault/queue", () => ({ enqueue: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/vault/voice", () => ({ getVoiceBlock: async () => "" }));
vi.mock("../../app/api/_lib/conversations", () => ({ ensureConversationThreadRow: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminFromToken: async () => null }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: vi.fn(async () => undefined) }));

import { POST } from "../../app/api/agent/route";

beforeEach(() => {
  orchMocks.calls = [];
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "rec" }) })));
});

describe("/api/agent CEO branch (W61′ pin)", () => {
  it("department:'ceo' delegates to intent:'synthesize' and streams the result", async () => {
    const res = await POST(new Request("https://t/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "What should I focus on this quarter?",
        department: "ceo",
        userId: "user-1",
        pbToken: "tok",
      }),
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("Cross-department answer.");

    expect(orchMocks.calls).toHaveLength(1);
    expect(orchMocks.calls[0]).toMatchObject({
      intent: "synthesize",
      userId: "user-1",
    });
    expect((orchMocks.calls[0]!.context as { query: string }).query).toBe("What should I focus on this quarter?");
  });
});
