/**
 * W95.1 — conversational intent extraction (create_contact).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const llm = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: llm.fn }));

import { extractIntent, INTENT_CONFIDENCE_THRESHOLD } from "../../app/api/_lib/orchestrator/intent";

const ok = (text: string) => ({ ok: true, text, attempts: 1, latencyMs: 1, tokensIn: 1, tokensOut: 1, model: "m", costUsd: 0 });

beforeEach(() => llm.fn.mockReset());

describe("extractIntent", () => {
  it("parses 'I met X at Y, email Z' into create_contact with fields", async () => {
    llm.fn.mockResolvedValue(ok(`{"type":"create_contact","fields":{"name":"Jane Doe","email":"jane@example.com","context":"trade show"},"confidence":0.92}`));
    const r = await extractIntent("I met Jane Doe at the trade show, her email is jane@example.com");
    expect(r).not.toBeNull();
    expect(r!.type).toBe("create_contact");
    expect(r!.fields).toMatchObject({ name: "Jane Doe", email: "jane@example.com", context: "trade show" });
    expect(r!.confidence).toBe(0.92);
  });

  it("returns null when the model finds no contact intent", async () => {
    llm.fn.mockResolvedValue(ok(`{"type":"none","confidence":0}`));
    expect(await extractIntent("how do I find more leads?")).toBeNull();
  });

  it("returns null when name is missing (not a real contact)", async () => {
    llm.fn.mockResolvedValue(ok(`{"type":"create_contact","fields":{"email":"x@y.com"},"confidence":0.85}`));
    expect(await extractIntent("add this email x@y.com")).toBeNull();
  });

  it("returns null on LLM failure (never throws, chat continues)", async () => {
    llm.fn.mockResolvedValue({ ok: false, fallback: "x", attempts: 1, latencyMs: 1, tokensIn: 0, tokensOut: 0, model: "m", costUsd: 0 });
    expect(await extractIntent("I met Jane Doe, jane@x.com")).toBeNull();
  });

  it("returns null on an empty message without calling the model", async () => {
    expect(await extractIntent("   ")).toBeNull();
    expect(llm.fn).not.toHaveBeenCalled();
  });

  it("confidence threshold is 0.7 (tunable constant)", () => {
    expect(INTENT_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});
