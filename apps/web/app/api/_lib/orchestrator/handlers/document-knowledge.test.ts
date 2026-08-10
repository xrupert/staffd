import { beforeEach, describe, expect, it, vi } from "vitest";

const callLLM = vi.fn();
vi.mock("../llm", () => ({ callLLM: (...args: unknown[]) => callLLM(...args) }));

import { extractDocumentKnowledgeCandidates } from "./document-knowledge";

beforeEach(() => vi.clearAllMocks());

describe("governed document knowledge extraction", () => {
  it("parses, normalizes, and deduplicates strict candidates", async () => {
    callLLM.mockResolvedValue({
      ok: true,
      text: JSON.stringify([
        { kind: "policy", subject: " Refund approvals ", statement: " Refunds above $500 require owner approval. ", confidence: 0.8, usageScopes: ["finance", "finance", "support"], sourceLocation: "Section 2", effectiveAt: null },
        { kind: "policy", subject: "Refund approvals", statement: "Refunds above $500 require owner approval.", confidence: 0.9, usageScopes: ["finance", "support"], sourceLocation: "Section 2", effectiveAt: null },
      ]),
      latencyMs: 100,
      tokensIn: 40,
      tokensOut: 20,
      costUsd: 0.01,
      attempts: 1,
      model: "test",
    });

    const result = await extractDocumentKnowledgeCandidates("Refund policy text");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      kind: "policy",
      subject: "Refund approvals",
      confidence: 0.9,
      usageScopes: ["finance", "support"],
    });
    expect(result).toMatchObject({ costUsd: 0.01, latencyMs: 100, tokensIn: 40, tokensOut: 20, truncated: false });
  });

  it("returns no candidates for empty document text without calling the model", async () => {
    expect(await extractDocumentKnowledgeCandidates("   ")).toMatchObject({ candidates: [], costUsd: 0, tokensIn: 0, tokensOut: 0 });
    expect(callLLM).not.toHaveBeenCalled();
  });

  it("fails closed on non-array or invalid candidate output", async () => {
    callLLM.mockResolvedValueOnce({ ok: true, text: "{}", latencyMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0, attempts: 1, model: "test" });
    await expect(extractDocumentKnowledgeCandidates("text")).rejects.toThrow("must return a JSON array");

    callLLM.mockResolvedValueOnce({
      ok: true,
      text: JSON.stringify([{ kind: "policy", subject: "Thing", statement: "Rule", confidence: 2, usageScopes: ["ops"] }]),
      latencyMs: 1, tokensIn: 1, tokensOut: 1, costUsd: 0, attempts: 1, model: "test",
    });
    await expect(extractDocumentKnowledgeCandidates("text")).rejects.toThrow("confidence is invalid");
  });

  it("propagates governed model failure instead of manufacturing candidates", async () => {
    callLLM.mockResolvedValue({ ok: false, fallback: "deadline_exceeded", latencyMs: 30_000, attempts: 1, model: "test", costUsd: 0 });
    await expect(extractDocumentKnowledgeCandidates("text")).rejects.toThrow("deadline_exceeded");
  });

  it("caps extremely long documents and reports truncation", async () => {
    callLLM.mockResolvedValue({ ok: true, text: "[]", latencyMs: 1, tokensIn: 10, tokensOut: 1, costUsd: 0, attempts: 1, model: "test" });
    const result = await extractDocumentKnowledgeCandidates("A".repeat(200_000));
    expect(callLLM).toHaveBeenCalledTimes(6);
    expect(result.truncated).toBe(true);
  });
});
