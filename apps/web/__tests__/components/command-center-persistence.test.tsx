/**
 * W49 Tests 3, 4 — Command Center generation persistence (GAP #2).
 *
 * The full orchestrate → confirm → generate flow, driven through the real
 * component: a completed generation saves to `documents` with the routed
 * specialist's department + name (SA H1/H2 — orchestrate itself persists
 * nothing; the generation record carries the attribution). A failed
 * generation saves nothing (Decision 3).
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, waitFor } from "@testing-library/react";

void React;

const pbMocks = vi.hoisted(() => ({
  creates: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1", email: "u@test" }, isValid: true, token: "tok" },
    collection: () => ({
      getList: async () => ({ items: [] }),
      create: async (payload: Record<string, unknown>) => {
        pbMocks.creates.push(payload);
        return { id: "doc_cc_1" };
      },
    }),
  },
}));

import CommandCenter from "../../app/components/CommandCenter";

function streamResponse(text: string) {
  let consumed = false;
  return {
    ok: true,
    body: {
      getReader: () => ({
        read: async () =>
          consumed
            ? { done: true, value: undefined }
            : ((consumed = true), { done: false, value: new TextEncoder().encode(text) }),
      }),
    },
    json: async () => ({}),
  };
}

let agentOk: boolean;

beforeEach(() => {
  pbMocks.creates = [];
  agentOk = true;
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes("/api/orchestrate")) {
      return streamResponse(
        'Your SEO Specialist is the right fit.\nREADY:{"department":"marketing","agentId":"marketing-seo-specialist","task":"audit my SEO","lockedAlternative":""}'
      );
    }
    if (url.includes("/api/agents/marketing")) {
      return {
        ok: true,
        json: async () => [{ id: "marketing-seo-specialist", name: "SEO Specialist" }],
        body: null,
      };
    }
    if (url.includes("/api/agent")) {
      if (!agentOk) return { ok: false, body: null, json: async () => ({}) };
      return streamResponse("# SEO Audit\n\nHere is the completed audit work, long enough to count as a real deliverable for downstream checks.");
    }
    // handoff suggestions, vault enqueue, credits — inert
    return { ok: true, json: async () => ({}), body: null };
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

async function driveGeneration(container: HTMLElement) {
  const textarea = container.querySelector("textarea");
  expect(textarea).toBeTruthy();

  // Turn 1 — routing.
  fireEvent.change(textarea!, { target: { value: "audit my SEO" } });
  fireEvent.keyDown(textarea!, { key: "Enter" });
  const sendBtn = Array.from(container.querySelectorAll("button")).find((b) =>
    /send|→|ask/i.test(b.textContent ?? "")
  );
  if (sendBtn) fireEvent.click(sendBtn);

  await waitFor(() => {
    expect((window as unknown as { __cc_pending?: boolean }).__cc_pending ?? true).toBeTruthy();
  });

  // Turn 2 — confirm → runAgent.
  await waitFor(() => expect(container.querySelector("textarea")).toBeTruthy());
  const ta2 = container.querySelector("textarea")!;
  fireEvent.change(ta2, { target: { value: "yes" } });
  const sendBtn2 = Array.from(container.querySelectorAll("button")).find((b) =>
    /send|→|ask/i.test(b.textContent ?? "")
  );
  if (sendBtn2) fireEvent.click(sendBtn2);
}

describe("Command Center persistence (W49 GAP #2)", () => {
  it("completed generation saves to documents with routed specialist attribution (Test 3)", async () => {
    const { container } = render(<CommandCenter />);
    await driveGeneration(container);

    await waitFor(() => {
      expect(pbMocks.creates).toHaveLength(1);
    }, { timeout: 3000 });

    const doc = pbMocks.creates[0]!;
    expect(doc.user).toBe("user-1");
    expect(doc.department).toBe("marketing");
    expect(doc.agent_name).toBe("SEO Specialist");
    expect(doc.prompt).toBe("audit my SEO");
    expect(String(doc.output)).toContain("Here is the completed audit work");
  });

  it("failed generation persists nothing (Test 4 / Decision 3)", async () => {
    agentOk = false;
    const { container } = render(<CommandCenter />);
    await driveGeneration(container);

    // Give any stray async saves a tick to land (they must not).
    await new Promise((r) => setTimeout(r, 100));
    expect(pbMocks.creates).toHaveLength(0);
  });
});
