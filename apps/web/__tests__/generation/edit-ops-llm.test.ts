import { describe, it, expect, vi, beforeEach } from "vitest";

const callLLM = vi.fn();
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: (...a: unknown[]) => callLLM(...a) }));

import { classifyEditLLM } from "../../app/api/_lib/generation/edit-ops-llm";

beforeEach(() => callLLM.mockReset());

describe("classifyEditLLM", () => {
  it("maps an ambiguous image instruction to an op", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":"instruct_edit"}' });
    const r = await classifyEditLLM("lose the busy bits in the corner", "image");
    expect(r).toEqual({ op: "instruct_edit", editPrompt: "lose the busy bits in the corner" });
  });

  it("returns null when the model says it's not an edit", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":null}' });
    expect(await classifyEditLLM("how do refunds work", "image")).toBeNull();
  });

  it("never returns a non-ROUTE op (e.g. variations) from the LLM", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":"variations"}' });
    expect(await classifyEditLLM("hmm", "image")).toBeNull();
  });

  it("returns null on LLM failure (fail-safe → normal routing)", async () => {
    callLLM.mockResolvedValue({ ok: false });
    expect(await classifyEditLLM("anything", "image")).toBeNull();
  });
});
