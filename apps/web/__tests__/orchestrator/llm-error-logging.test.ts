/**
 * PR-Tranche-2.6 (W27.1) — callLLM error logging contract.
 *
 * Pre-W27 the catch block at llm.ts:213 discarded `lastErr` via `void lastErr`,
 * collapsing every Anthropic SDK exception (auth, rate limit, timeout, parse)
 * into an opaque "upstream_error" fallback with no observable signal in
 * production logs.
 *
 * This test asserts:
 *   1. callLLM still returns the structured envelope on failure (no regression
 *      on degraded-path UX — the fallback consumer doesn't see the throw)
 *   2. console.error is called with structured error fields (name, message,
 *      status, stack snippet) so future operators can diagnose triggers
 *      from Vercel logs
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock the Anthropic SDK to throw a recognizable error
class FakeAnthropicError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AuthenticationError";
    this.status = status;
  }
}

// vi.mock is hoisted above imports; use vi.hoisted to make the mock state
// available to the factory before module imports run.
const { messagesCreateMock } = vi.hoisted(() => ({ messagesCreateMock: vi.fn() }));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    messages = { create: messagesCreateMock };
  },
}));

// Set a valid ANTHROPIC_API_KEY so the W27.2 resolver inside attempt() passes
process.env.ANTHROPIC_API_KEY = "sk-ant-test-key-fake-for-tests";

import { callLLM } from "../../app/api/_lib/orchestrator/llm";

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  messagesCreateMock.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

describe("callLLM error logging (W27.1 contract)", () => {
  it("logs structured error fields when Anthropic SDK throws", async () => {
    messagesCreateMock.mockRejectedValue(new FakeAnthropicError("invalid x-api-key", 401));

    const result = await callLLM({
      intent: "route",
      system: "You are a coordinator.",
      messages: [{ role: "user", content: "test prompt" }],
    });

    // Envelope shape preserved
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.fallback).toBe("upstream_error");
    }

    // console.error called with structured fields (NOT silent)
    expect(errorSpy).toHaveBeenCalled();
    const call = errorSpy.mock.calls.find((args) =>
      String(args[0] ?? "").includes("[orchestrator/llm] callLLM exhausted retries"),
    );
    expect(call).toBeDefined();
    const payload = call![1] as Record<string, unknown>;
    expect(payload.intent).toBe("route");
    expect(payload.name).toBe("AuthenticationError");
    expect(payload.message).toBe("invalid x-api-key");
    expect(payload.status).toBe(401);
    expect(payload.fallback).toBe("upstream_error");
  });

  it("returns structured envelope (no regression on degraded UX) even with logging", async () => {
    messagesCreateMock.mockRejectedValue(new Error("network down"));

    const result = await callLLM({
      intent: "route",
      system: "x",
      messages: [{ role: "user", content: "y" }],
    });

    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.fallback).toBeDefined();
      expect(result.tokensIn).toBeGreaterThanOrEqual(0);
      expect(result.model).toBeTruthy();
    }
    // Logging happened — fallback consumer doesn't care, but operators do
    expect(errorSpy).toHaveBeenCalled();
  });
});
