/**
 * W63 — ActionAffordances component + mount wiring pins.
 *
 * Pins: the SA-locked ACTION_UI label set, hidden-action suppression
 * (publish_social), reason-as-title tooltips, no visible confidence, the
 * locked staffd:action-select CustomEvent seam, empty-state silence, and
 * the D10' coexistence + T3.0 invariants at both mount points.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, cleanup, fireEvent } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

import ActionAffordances, { handleActionSelect } from "../../app/components/ActionAffordances";
import { ACTION_UI } from "../../app/api/_lib/orchestrator/action-vocabulary";
import type { ActionCandidate } from "../../app/api/_lib/orchestrator/action-vocabulary";

void React;

const WEB = join(__dirname, "..", "..");

const CTX = { department: "marketing", documentId: "doc_1" };

const CANDIDATES: ActionCandidate[] = [
  { id: "generate_image", confidence: 0.92, reason: "Ad copy explicitly describes a visual scene." },
  { id: "publish_social", confidence: 0.85, reason: "Hashtags present." },
  { id: "schedule_followup", confidence: 0.7, reason: "Campaign implies a next touch.", params: { when: "tomorrow" } },
];

afterEach(cleanup);

describe("ACTION_UI — locked label set (W63 Decision 4)", () => {
  it("matches the SA-locked labels verbatim; growth/drift fails", () => {
    expect(ACTION_UI).toEqual({
      generate_image:    { label: "Generate the visual →",   icon: "🖼️" },
      generate_video:    { label: "Generate the video →",    icon: "🎬" },
      publish_social:    { label: "Publish to social →",     icon: "📣", hidden: true },
      schedule_followup: { label: "Schedule a follow-up →",  icon: "🗓️" },
      draft_email:       { label: "Draft the email →",       icon: "✉️" },
      export_document:   { label: "Export as document →",    icon: "📄" },
      send_to_crm:         { label: "Add to CRM →",          icon: "📇" },
      send_email_campaign: { label: "Send as campaign →",    icon: "📧" },
      open_support_ticket: { label: "Open support ticket →", icon: "🎫" },
      send_for_signature:  { label: "Send for signature →",  icon: "✍️" },
    });
  });
});

describe("ActionAffordances (W63)", () => {
  it("renders visible candidates with locked labels; publish_social never renders (Decision 8)", () => {
    const { container, getByText, queryByText } = render(
      <ActionAffordances candidates={CANDIDATES} context={CTX} />
    );
    expect(getByText(/Generate the visual/)).toBeTruthy();
    expect(getByText(/Schedule a follow-up/)).toBeTruthy();
    expect(queryByText(/Publish to social/)).toBeNull();
    expect(container.textContent).toContain("Your staff can take it from here");
  });

  it("all six action types render correctly when visible (full-vocabulary sweep)", () => {
    const all: ActionCandidate[] = (Object.keys(ACTION_UI) as Array<ActionCandidate["id"]>)
      .map((id) => ({ id, confidence: 0.9, reason: `reason for ${id}` }));
    const { container } = render(<ActionAffordances candidates={all} context={CTX} />);
    const buttons = Array.from(container.querySelectorAll("button"));
    // 10 in vocabulary, 1 hidden (publish_social) → 9 rendered.
    expect(buttons).toHaveLength(9);
    for (const b of buttons) {
      expect(b.getAttribute("title")).toMatch(/^reason for /);
    }
  });

  it("reason surfaces via the title attribute and matches the candidate field (Decision 6)", () => {
    const { getByText } = render(<ActionAffordances candidates={CANDIDATES} context={CTX} />);
    const chip = getByText(/Generate the visual/).closest("button")!;
    expect(chip.getAttribute("title")).toBe("Ad copy explicitly describes a visual scene.");
  });

  it("confidence is never visible in the rendered output (Decision 7)", () => {
    const { container } = render(<ActionAffordances candidates={CANDIDATES} context={CTX} />);
    expect(container.textContent).not.toMatch(/0\.9|0\.92|0\.85|0\.7|92%|85%|confidence/i);
  });

  it("click emits the locked staffd:action-select CustomEvent + console.info (Decision 5)", () => {
    const events: Array<CustomEvent> = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("staffd:action-select", listener);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const { getByText } = render(<ActionAffordances candidates={CANDIDATES} context={CTX} />);
    fireEvent.click(getByText(/Generate the visual/));

    expect(events).toHaveLength(1);
    expect(events[0]!.detail).toEqual({
      candidate: CANDIDATES[0],
      context: CTX,
    });
    expect(infoSpy.mock.calls.flat().map(String).join(" ")).toContain("[W63] action selected");

    window.removeEventListener("staffd:action-select", listener);
    infoSpy.mockRestore();
  });

  it("empty / absent candidates render nothing — static buttons remain the fallback", () => {
    const a = render(<ActionAffordances candidates={[]} context={CTX} />);
    expect(a.container.innerHTML).toBe("");
    cleanup();
    const b = render(<ActionAffordances candidates={undefined} context={CTX} />);
    expect(b.container.innerHTML).toBe("");
  });

  it("hidden-only candidate sets also render nothing", () => {
    const { container } = render(
      <ActionAffordances
        candidates={[{ id: "publish_social", confidence: 0.9, reason: "r" }]}
        context={CTX}
      />
    );
    expect(container.innerHTML).toBe("");
  });

  it("handleActionSelect is the exported seam (W64 attaches here)", () => {
    const events: Array<CustomEvent> = [];
    const listener = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("staffd:action-select", listener);
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    handleActionSelect(CANDIDATES[2]!, { department: "operations" });
    expect(events[0]!.detail.candidate.params).toEqual({ when: "tomorrow" });
    window.removeEventListener("staffd:action-select", listener);
    infoSpy.mockRestore();
  });
});

describe("mount wiring + invariants (W63)", () => {
  it("HandoffPanel consumes actionCandidates from the same response and renders the shared component", () => {
    const src = readFileSync(join(WEB, "app", "components", "HandoffPanel.tsx"), "utf8");
    expect(src).toContain("import ActionAffordances");
    expect(src).toContain("data?.ok ? data.actionCandidates : data?.degraded?.actionCandidates");
    expect(src).toContain("<ActionAffordances");
    // Candidates-only state renders (FollowUp-parse degraded but analyzer succeeded).
    expect(src).toContain("visibleCandidates.length === 0");
  });

  it("CommandCenter consumes actionCandidates in its done-block (D10' — static surfaces untouched)", () => {
    const src = readFileSync(join(WEB, "app", "components", "CommandCenter.tsx"), "utf8");
    expect(src).toContain("import ActionAffordances");
    expect(src).toContain("setActionCandidates(data.actionCandidates ?? data.degraded?.actionCandidates ?? [])");
    expect(src).toContain("(followUps.length > 0 || actionCandidates.length > 0)");
    // T3.0 invariant — still no credit strings.
    expect(src).not.toMatch(/agent.{0,5}credit|credits remaining/i);
  });

  it("CommandCenter wires the FC-2 integration handlers (no dead buttons)", () => {
    const src = readFileSync(join(WEB, "app", "components", "CommandCenter.tsx"), "utf8");
    // Both new vocabulary actions have a registered dispatcher handler.
    expect(src).toMatch(/send_to_crm:\s*\(\)\s*=>/);
    expect(src).toMatch(/send_email_campaign:\s*\(\)\s*=>/);
    // Handlers hit the connected write routes.
    expect(src).toContain("/api/integrations/twenty");
    expect(src).toContain("/api/integrations/listmonk");
    // FC-2b — the two recipient-email actions are wired + hit their routes.
    expect(src).toMatch(/open_support_ticket:\s*\(\)\s*=>/);
    expect(src).toMatch(/send_for_signature:\s*\(\)\s*=>/);
    expect(src).toContain("/api/integrations/chatwoot");
    expect(src).toContain("/api/integrations/docuseal");
  });

  it("D10' coexistence — DepartmentRoom static affordances untouched", () => {
    const src = readFileSync(join(WEB, "app", "components", "DepartmentRoom.tsx"), "utf8");
    expect(src).toContain("Generate Image");
    expect(src).toContain("Save PDF");
    expect(src).toContain("exportToDocx");
    // No inline credit indicator regression (T3.0).
    expect(src).not.toContain("creditsRemaining");
  });
});
