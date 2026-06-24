/**
 * T1-4 — /api/agent Groq → Anthropic fallback.
 *
 * When pickModel routes a short-form task to Groq and the Groq call throws
 * (outage / rate-limit / network), the route MUST fall back to Anthropic
 * Haiku and still deliver content — NOT return a 500. Pre-T1-4 the catch
 * returned `new Response("Something went wrong", { status: 500 })`, which
 * turned any Groq blip into a user-facing failure.
 *
 * Everything except the route's own fallback logic is mocked.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.example.test";

const anthropicMocks = vi.hoisted(() => ({ streamModel: "" }));

// Anthropic SDK stub — messages.stream yields a single text delta and
// exposes finalMessage(). Records the model it was asked to stream so the
// test can assert the fallback used Haiku.
vi.mock("@anthropic-ai/sdk", () => ({
  default: class AnthropicStub {
    messages = {
      stream: (opts: { model: string }) => {
        anthropicMocks.streamModel = opts.model;
        async function* gen() {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "Fallback answer." } };
        }
        const it = gen() as AsyncGenerator<unknown> & { finalMessage?: () => Promise<unknown> };
        it.finalMessage = async () => ({ usage: { input_tokens: 1, output_tokens: 2 } });
        return it;
      },
      create: async () => { throw new Error("create must not be used on this path"); },
    };
  },
}));

// Route short-form to Groq, then make Groq fail. MODELS must be present —
// the route reads MODELS.haiku for the fallback choice.
vi.mock("../../app/api/_lib/llm-router", () => ({
  pickModel: () => ({ provider: "groq", model: "llama-3.1-70b-versatile", family: "llama", reason: "test short-form" }),
  callGroq: async () => { throw new Error("Groq 503: upstream down"); },
  computeCostUsd: () => 0,
  MODELS: { sonnet: "claude-sonnet-4-6", haiku: "claude-haiku-4-5-20251001", llama: "llama-3.1-70b-versatile" },
}));

vi.mock("../../app/api/_lib/trial", () => ({
  recordTrialRun: async () => ({ allowed: true, plan: "pro", trialRuns: {}, remaining: 99 }),
  resolveDepartments: async () => ({
    plan: "pro", resolved: ["marketing", "sales", "legal"], unlockedDepartments: [],
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
// h6f — agent resolves the trusted userId from the token; honor the body id here.
vi.mock("../../app/api/_lib/integrations/identity", () => ({
  resolveAgentUserId: async (_pb: string | undefined, uid?: string) => uid ?? null,
}));
vi.mock("../../app/api/_lib/conversations", () => ({ ensureConversationThreadRow: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/orchestrator", () => ({ runOrchestrator: async () => ({ ok: true, decision: {} }) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminFromToken: async () => null }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: vi.fn(async () => undefined) }));

import { POST } from "../../app/api/agent/route";

beforeEach(() => {
  anthropicMocks.streamModel = "";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ id: "rec" }) })));
});

describe("/api/agent Groq → Anthropic fallback (T1-4)", () => {
  it("returns 200 with Anthropic content when Groq throws (no 500)", async () => {
    const res = await POST(new Request("https://t/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "write a tagline", // short-form → groq route
        department: "marketing",
        userId: "user-1",
        pbToken: "tok",
      }),
    }));

    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain("Fallback answer.");
  });

  it("uses Anthropic Haiku as the fallback model", async () => {
    await POST(new Request("https://t/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        task: "write a tagline",
        department: "marketing",
        userId: "user-1",
        pbToken: "tok",
      }),
    }));
    expect(anthropicMocks.streamModel).toBe("claude-haiku-4-5-20251001");
  });
});
