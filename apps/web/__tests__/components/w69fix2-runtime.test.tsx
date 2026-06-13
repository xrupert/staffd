/**
 * W69.fix.2 FORENSIC RUNTIME TEST
 *
 * Renders CommandCenter, drives a full send() → orchestrate → READY parse →
 * runAgent → stream complete cycle, then asserts phase transitions to "done".
 *
 * Purpose: distinguish code bug from deployment/cache issue.
 *   PASS → source code is correct; bug is environment-specific (stale deploy / cache)
 *   FAIL → code bug exists; investigate failure output for root cause
 *
 * Run: pnpm vitest run __tests__/components/w69fix2-runtime.test.tsx
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, act, waitFor, fireEvent } from "@testing-library/react";

void React;

// ── Authenticated PocketBase mock ────────────────────────────────────────────
vi.mock("../../lib/pb", () => ({
  default: {
    authStore: {
      record: { id: "user-1" },
      isValid: true,
      token: "test-token",
    },
    collection: vi.fn(() => ({
      create: vi.fn().mockResolvedValue({ id: "doc-1" }),
      getList: vi.fn().mockResolvedValue({ items: [] }),
    })),
  },
}));

import CommandCenter from "../../app/components/CommandCenter";

// ── Stream helper ─────────────────────────────────────────────────────────────
function makeStreamBody(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("W69.fix.2 — runtime phase-transition (forensic)", () => {
  it("phase transitions to 'done' after natural stream completion — not stuck at 'generating'", async () => {
    // orchestrate returns READY:{...} to trigger W69 direct-execute path
    const orchestrateText =
      'Routing to Marketing.\nREADY:{"department":"marketing","task":"write a blog post","agentId":"marketing-content-creator"}';
    // agent returns enough text to satisfy the length > 50 handoff gate
    const agentText =
      "This is the generated blog post content, long enough to trigger the handoff suggestions fetch.";

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/orchestrate")) {
        return { ok: true, status: 200, body: makeStreamBody(orchestrateText), json: async () => ({}) };
      }
      if (u.includes("/api/agent")) {
        return { ok: true, status: 200, body: makeStreamBody(agentText), json: async () => ({}) };
      }
      // handoff/suggest, agents roster, vault/enqueue — fire-and-forget non-blocking calls
      return {
        ok: true,
        status: 200,
        body: null,
        json: async () => ({ ok: true, followUps: [], actionCandidates: [], degraded: undefined }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommandCenter />);

    // Allow mount effects (threadId load) to settle
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found — CommandCenter did not mount");

    // Enter text
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "write a blog post" } });
    });

    // Submit via Enter (same path as clicking Send)
    await act(async () => {
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    // Wait for phase === "done" (the footer renders "Enter to continue")
    // Timeout 8s — generous for happy-dom async stream processing
    await waitFor(
      () => {
        const text = container.textContent ?? "";
        expect(text).toContain("Enter to continue");
      },
      { timeout: 8000 }
    );

    // Confirm the generating state is gone
    const finalText = container.textContent ?? "";
    expect(finalText).not.toContain("generating…");
    expect(finalText).not.toContain("Stop →");
  });

  it("phase is 'generating' during agent stream (pre-done state is correct)", async () => {
    // Use a delayed stream to capture the in-progress state
    let resolveStream!: () => void;
    const streamPromise = new Promise<void>((r) => { resolveStream = r; });

    const encoder = new TextEncoder();
    const delayedStream = new ReadableStream<Uint8Array>({
      async start(controller) {
        controller.enqueue(encoder.encode("Partial content..."));
        // hold open until test signals
        await streamPromise;
        controller.close();
      },
    });

    const orchestrateText =
      'READY:{"department":"marketing","task":"test task","agentId":"marketing-content-creator"}';

    const fetchMock = vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes("/api/orchestrate")) {
        return { ok: true, status: 200, body: makeStreamBody(orchestrateText), json: async () => ({}) };
      }
      if (u.includes("/api/agent")) {
        return { ok: true, status: 200, body: delayedStream, json: async () => ({}) };
      }
      return { ok: true, status: 200, body: null, json: async () => ({ ok: true, followUps: [], actionCandidates: [] }) };
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = render(<CommandCenter />);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });

    const textarea = container.querySelector("textarea");
    if (!textarea) throw new Error("textarea not found");

    await act(async () => {
      fireEvent.change(textarea, { target: { value: "test task" } });
      fireEvent.keyDown(textarea, { key: "Enter", shiftKey: false });
    });

    // Give the orchestrate stream and phase="generating" transition time to land
    await act(async () => { await new Promise((r) => setTimeout(r, 200)); });

    // While stream is held open, phase should be "generating"
    const midText = container.textContent ?? "";
    expect(midText).toContain("generating…");
    expect(midText).toContain("Stop →");

    // Now close the stream — triggers finally block → setPhase("done")
    await act(async () => { resolveStream(); });

    // Should transition to done
    await waitFor(
      () => { expect(container.textContent ?? "").toContain("Enter to continue"); },
      { timeout: 5000 }
    );
    expect(container.textContent ?? "").not.toContain("generating…");
  });
});
