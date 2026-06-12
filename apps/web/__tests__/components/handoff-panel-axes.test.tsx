/**
 * W63 — HandoffPanel two-axis functional pins.
 *
 * The card hosts both axes from the same handoff/suggest response:
 * FollowUps (cross-department) and ActionCandidates (platform actions).
 * Pins the three states: followUps-only (backward compat), candidates-only
 * (FollowUp parse degraded but analyzer succeeded), and both-empty silence.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";

void React;

vi.mock("../../lib/pb", () => ({
  default: {
    authStore: { record: { id: "user-1" }, isValid: true, token: "tok" },
    collection: () => ({ getList: async () => ({ items: [] }) }),
  },
}));

import HandoffPanel from "../../app/components/HandoffPanel";
import { ACTION_VOCABULARY, ACTION_UI } from "../../app/api/_lib/orchestrator/action-vocabulary";

function mockHandoffResponse(body: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const FOLLOWUP = { department: "design", task: "create the visual companion", rationale: "r", locked: false };
const CANDIDATE = { id: "generate_image", confidence: 0.9, reason: "visual scene described" };

describe("HandoffPanel — two-axis states (W63)", () => {
  it("followUps present, candidates empty → FollowUps render, no affordance row (backward compat)", async () => {
    mockHandoffResponse({ ok: true, followUps: [FOLLOWUP], actionCandidates: [] });
    const { container, findByText } = render(
      <HandoffPanel documentId="doc_1" sourceDepartment="marketing" sourceText="output" />
    );
    expect(await findByText(/create the visual companion/)).toBeTruthy();
    expect(container.textContent).toContain("Next steps your staff suggests");
    expect(container.textContent).not.toContain("Your staff can take it from here");
  });

  it("candidates-only (FollowUp parse degraded) → affordance row still renders", async () => {
    mockHandoffResponse({
      ok: false, fallback: "upstream_error",
      degraded: { followUps: [], actionCandidates: [CANDIDATE] },
    });
    const { container, findByText } = render(
      <HandoffPanel documentId="doc_2" sourceDepartment="marketing" sourceText="output" />
    );
    expect(await findByText(/Generate the visual/)).toBeTruthy();
    expect(container.textContent).toContain("Your staff can take it from here");
  });

  it("both axes empty → silent (no card)", async () => {
    mockHandoffResponse({ ok: true, followUps: [], actionCandidates: [] });
    const { container } = render(
      <HandoffPanel documentId="doc_3" sourceDepartment="marketing" sourceText="output" />
    );
    await new Promise((r) => setTimeout(r, 30));
    expect(container.textContent).not.toContain("Next steps");
    expect(container.textContent).not.toContain("take it from here");
  });

  it("vocabulary ↔ UI metadata stay in lockstep (every action id has UI, no extras)", () => {
    expect(Object.keys(ACTION_UI).sort()).toEqual(ACTION_VOCABULARY.map((a) => a.id).sort());
  });
});
