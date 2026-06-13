/**
 * W63.fix regression — handleHandoff must surface actionCandidates in the
 * degraded envelope even when callLLM fails (deadline exceeded, upstream error).
 *
 * Root cause: the !result.ok early-return path dropped the analyzer's results.
 * The !followUps parse-failure path already spread actionCandidates into
 * degraded; this test locks the same contract for the LLM-error path.
 *
 * Test invariant: when callLLM returns !ok, the response.degraded object MUST
 * contain actionCandidates (the analyzer runs in Promise.all regardless of
 * LLM outcome — dropping its results on LLM failure is the bug).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ---- module mocks (must be declared before dynamic imports) ----

vi.mock("../../app/api/_lib/orchestrator/llm", () => ({
  callLLM: vi.fn(),
}));

vi.mock("../../app/api/_lib/orchestrator/analyzer", () => ({
  analyzeOutput: vi.fn(),
}));

// Stub out every side-effectful module the handler pulls in.
vi.mock("../../app/api/_lib/vault", () => ({
  fetchVault: vi.fn().mockResolvedValue(null),
  renderVaultBlock: vi.fn().mockReturnValue(""),
  retrieve: vi.fn().mockResolvedValue({ items: [], costFlag: "degraded", tokensReturned: 0, latencyMs: 0 }),
}));
vi.mock("../../app/api/_lib/vault/voice", () => ({
  getVoiceBlock: vi.fn().mockResolvedValue(""),
}));
vi.mock("../../app/api/_lib/trial", () => ({
  resolveDepartments: vi.fn().mockResolvedValue({ resolved: ["marketing", "sales"] }),
}));
vi.mock("../../app/api/_lib/industry", () => ({
  bridgingIndustryFor: vi.fn().mockReturnValue(null),
  resolveBridgingIndustry: vi.fn().mockReturnValue(null),
}));
vi.mock("@staffd/agents", () => ({
  getAgent: vi.fn().mockReturnValue({ systemPrompt: "sys" }),
  resolveIndustryToPackId: vi.fn().mockReturnValue(null),
}));

import { callLLM } from "../../app/api/_lib/orchestrator/llm";
import { analyzeOutput } from "../../app/api/_lib/orchestrator/analyzer";
import { handleHandoff } from "../../app/api/_lib/orchestrator/handlers/handoff";
import type { OrchestratorRequest } from "../../app/api/_lib/orchestrator/types";

const mockCallLLM = callLLM as ReturnType<typeof vi.fn>;
const mockAnalyzeOutput = analyzeOutput as ReturnType<typeof vi.fn>;

function makeReq(overrides?: Partial<OrchestratorRequest>): OrchestratorRequest {
  return {
    intent: "handoff",
    userId: "user-1",
    pbToken: "tok",
    context: {
      sourceDoc: {
        department: "marketing",
        prompt: "write an ad",
        outputExcerpt: "Transform your home. Call now. Free estimate.",
      },
    },
    ...overrides,
  };
}

const SAMPLE_CANDIDATES = [
  { id: "export_document", confidence: 0.85, reason: "Client-ready document." },
  { id: "generate_image",  confidence: 0.90, reason: "Visual complements the copy." },
];

beforeEach(() => {
  mockCallLLM.mockReset();
  mockAnalyzeOutput.mockReset().mockResolvedValue(SAMPLE_CANDIDATES);
});

describe("handleHandoff — actionCandidates in degraded envelope (W63.fix)", () => {
  it("LLM deadline_exceeded: degraded.actionCandidates carries analyzer results", async () => {
    mockCallLLM.mockResolvedValue({ ok: false, fallback: "deadline_exceeded", latencyMs: 6001, attempts: 1 });

    const res = await handleHandoff(makeReq());

    if (res.ok) throw new Error("expected ok:false");
    expect(res.degraded.actionCandidates).toEqual(SAMPLE_CANDIDATES);
  });

  it("LLM upstream_error: degraded.actionCandidates still populated", async () => {
    mockCallLLM.mockResolvedValue({ ok: false, fallback: "upstream_error", latencyMs: 200, attempts: 1 });

    const res = await handleHandoff(makeReq());

    if (res.ok) throw new Error("expected ok:false");
    expect(res.degraded.actionCandidates).toEqual(SAMPLE_CANDIDATES);
  });

  it("LLM ok but parse fails: degraded.actionCandidates already worked (regression guard)", async () => {
    mockCallLLM.mockResolvedValue({
      ok: true, text: "No JSON array here — malformed.", latencyMs: 300, attempts: 1, tokensIn: 100, tokensOut: 20,
    });

    const res = await handleHandoff(makeReq());

    if (res.ok) throw new Error("expected ok:false (parse-failure path)");
    expect(res.degraded.actionCandidates).toEqual(SAMPLE_CANDIDATES);
  });

  it("LLM ok + parse ok: actionCandidates at top level (success path unchanged)", async () => {
    mockCallLLM.mockResolvedValue({
      ok: true,
      text: 'Some text.\nHANDOFFS:[{"department":"design","task":"Make a visual.","rationale":"Copy needs art."}]',
      latencyMs: 300, attempts: 1, tokensIn: 100, tokensOut: 40,
    });

    const res = await handleHandoff(makeReq());

    if (!res.ok) throw new Error("expected ok:true");
    expect(res.actionCandidates).toEqual(SAMPLE_CANDIDATES);
  });

  it("analyzer returns [] on its own failure: degraded.actionCandidates is [] not undefined", async () => {
    mockAnalyzeOutput.mockResolvedValue([]);
    mockCallLLM.mockResolvedValue({ ok: false, fallback: "upstream_error", latencyMs: 200, attempts: 1 });

    const res = await handleHandoff(makeReq());

    if (res.ok) throw new Error("expected ok:false");
    expect(Array.isArray(res.degraded.actionCandidates)).toBe(true);
  });
});
