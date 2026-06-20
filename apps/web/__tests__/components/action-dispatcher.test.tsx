/**
 * W64 B1 — action-handler pins: useActionDispatcher contracts (attach/
 * cleanup, dispatch, debounce, error contracts, publish_social noop),
 * runExportDocument clipboard fallback (Decision 6), and source pins for
 * the surface wiring + D10'' conditional dedup that happy-dom can't
 * exercise end-to-end (DeptRoom/CC are too stateful to mount in
 * isolation — established W63 pattern).
 */

import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, cleanup, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

import { useActionDispatcher, type ActionHandlers } from "../../lib/hooks/useActionDispatcher";
import type { ActionCandidate } from "../../app/api/_lib/orchestrator/action-vocabulary";

void React;

const COMPONENTS = join(__dirname, "..", "..", "app", "components");
const LIB = join(__dirname, "..", "..", "lib");

// ---------------------------------------------------------------------------
// Harness + event helpers
// ---------------------------------------------------------------------------

function Harness({ handlers }: { handlers: ActionHandlers }) {
  useActionDispatcher(handlers);
  return null;
}

function fire(id: string, opts?: { department?: string; params?: Record<string, unknown>; badPayload?: boolean }) {
  const detail = opts?.badPayload
    ? { nope: true }
    : {
        candidate: { id, confidence: 0.9, reason: "test", params: opts?.params } as ActionCandidate,
        context: { department: opts?.department ?? "marketing" },
      };
  act(() => {
    window.dispatchEvent(new CustomEvent("staffd:action-select", { detail }));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Dispatcher contracts
// ---------------------------------------------------------------------------

describe("useActionDispatcher — dispatch + lifecycle (W64 D3′)", () => {
  it("routes an event to the registered handler with candidate + context", () => {
    const onExport = vi.fn();
    render(<Harness handlers={{ export_document: onExport }} />);
    fire("export_document", { department: "sales" });
    expect(onExport).toHaveBeenCalledTimes(1);
    const [candidate, context] = onExport.mock.calls[0]!;
    expect(candidate.id).toBe("export_document");
    expect(context.department).toBe("sales");
  });

  it("dispatches by id — only the matching handler fires", () => {
    const img = vi.fn();
    const vid = vi.fn();
    render(<Harness handlers={{ generate_image: img, generate_video: vid }} />);
    fire("generate_image");
    expect(img).toHaveBeenCalledTimes(1);
    expect(vid).not.toHaveBeenCalled();
  });

  it("reads fresh handler closures across re-renders without re-binding", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Harness handlers={{ generate_image: first }} />);
    rerender(<Harness handlers={{ generate_image: second }} />);
    fire("generate_image");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("removes the window listener on unmount", () => {
    const onExport = vi.fn();
    const { unmount } = render(<Harness handlers={{ export_document: onExport }} />);
    unmount();
    fire("export_document");
    expect(onExport).not.toHaveBeenCalled();
  });
});

describe("useActionDispatcher — debounce (double-click protection)", () => {
  it("suppresses a repeat of the same candidate id within 1s", () => {
    const img = vi.fn();
    render(<Harness handlers={{ generate_image: img }} />);
    fire("generate_image");
    fire("generate_image");
    expect(img).toHaveBeenCalledTimes(1);
  });

  it("allows the same candidate id again after the window passes", () => {
    const img = vi.fn();
    render(<Harness handlers={{ generate_image: img }} />);
    fire("generate_image");
    vi.advanceTimersByTime(1_100);
    fire("generate_image");
    expect(img).toHaveBeenCalledTimes(2);
  });

  it("debounce is per-id — a different action fires immediately", () => {
    const img = vi.fn();
    const exp = vi.fn();
    render(<Harness handlers={{ generate_image: img, export_document: exp }} />);
    fire("generate_image");
    fire("export_document");
    expect(img).toHaveBeenCalledTimes(1);
    expect(exp).toHaveBeenCalledTimes(1);
  });
});

describe("useActionDispatcher — error contracts (warn + noop)", () => {
  it("invalid payload (missing candidate/context) warns and noops", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const onExport = vi.fn();
    render(<Harness handlers={{ export_document: onExport }} />);
    fire("anything", { badPayload: true });
    expect(onExport).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("invalid payload"), expect.anything());
  });

  it("unhandled action id warns and noops — publish_social pin (D8′: no handler on any surface)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    render(<Harness handlers={{ export_document: vi.fn() }} />);
    fire("publish_social");
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no handler registered for action "publish_social"'));
  });
});

// ---------------------------------------------------------------------------
// export_document handler — clipboard fallback (Decision 6)
// ---------------------------------------------------------------------------

describe("runExportDocument — Decision 6 fallback chain", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  async function load(exportImpl: () => Promise<void>) {
    vi.doMock("../../app/components/DocExport", () => ({ exportToDocx: vi.fn(exportImpl) }));
    const mod = await import("../../lib/action-handlers/export-document");
    const doc = await import("../../app/components/DocExport");
    return { run: mod.runExportDocument, exportToDocx: doc.exportToDocx as ReturnType<typeof vi.fn> };
  }

  it("happy path: calls exportToDocx with output + business name, no notify", async () => {
    const { run, exportToDocx } = await load(async () => {});
    const notify = vi.fn();
    await run("# Plan", "Acme Co", notify);
    expect(exportToDocx).toHaveBeenCalledWith("# Plan", "Acme Co");
    expect(notify).not.toHaveBeenCalled();
  });

  it("export throws → content copied to clipboard + plain-language notice", async () => {
    const { run } = await load(async () => { throw new Error("docx boom"); });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const notify = vi.fn();
    await run("# Plan", undefined, notify);
    expect(writeText).toHaveBeenCalledWith("# Plan");
    expect(notify).toHaveBeenCalledWith(
      "Document export failed — the content is copied to your clipboard instead."
    );
  });

  it("export AND clipboard both fail → manual-copy notice, never throws", async () => {
    const { run } = await load(async () => { throw new Error("docx boom"); });
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockRejectedValue(new Error("no clipboard")) },
      configurable: true,
    });
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const notify = vi.fn();
    await expect(run("# Plan", undefined, notify)).resolves.toBeUndefined();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("Copy the work manually"));
  });

  it("empty output → warn + noop (no export attempt)", async () => {
    const { run, exportToDocx } = await load(async () => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await run("   ", undefined, vi.fn());
    expect(exportToDocx).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("empty output"));
  });
});

// ---------------------------------------------------------------------------
// Surface wiring pins (source-level — established W63/W67 pattern)
// ---------------------------------------------------------------------------

describe("DepartmentRoom wiring pins (W64 B1)", () => {
  const src = readFileSync(join(COMPONENTS, "DepartmentRoom.tsx"), "utf8");

  it("mounts the dispatcher with image/video/export handlers (D2: same functions as static buttons)", () => {
    expect(src).toContain("useActionDispatcher({");
    expect(src).toContain("generate_image: () => { void generateImage(); }");
    expect(src).toContain("generate_video: () => { void generateVideo(); }");
    expect(src).toContain("void runExportDocument(output, businessName || undefined");
  });

  it("registers no publish_social handler (D8′ — vendor-blocked, hidden, W17 tracker)", () => {
    expect(src).not.toContain("publish_social:");
  });

  it("D10'' conditional dedup — static image/video buttons hidden when a dynamic chip covers them", () => {
    expect(src).toContain('{!dynamicActions.has("generate_image") && (');
    expect(src).toContain('{!dynamicActions.has("generate_video") && (');
  });

  it("dedup state fed from HandoffPanel candidates, excluding hidden actions", () => {
    expect(src).toContain("onCandidates={(cands: ActionCandidate[]) =>");
    expect(src).toContain("cands.filter((c) => !ACTION_UI[c.id]?.hidden)");
  });

  it("dedup state resets on each new generation run (no stale suppression)", () => {
    expect(src).toContain("setDynamicActions(new Set()); // W64 D10'' — dedup resets per generation");
  });

  it("T3.0 re-pin — no credit display introduced", () => {
    expect(src).not.toContain("creditsRemaining");
  });
});

describe("CommandCenter wiring pins (W64 B1)", () => {
  const src = readFileSync(join(COMPONENTS, "CommandCenter.tsx"), "utf8");

  it("mounts the dispatcher with all five handlers — publish_social stays handlerless (D8′)", () => {
    expect(src).toContain("useActionDispatcher({");
    expect(src).toContain("export_document: () => {");
    // W95.7.3d-T1 — chips open the tier picker (openGenTier); the modal confirm
    // then runs generateInlineMedia(kind, tier).
    expect(src).toContain('generate_image: () => { openGenTier("image"); }');
    expect(src).toContain('generate_video: () => { openGenTier("video"); }');
    expect(src).toContain("schedule_followup: (candidate) => {");
    expect(src).toContain("draft_email: () => {");
    expect(src).not.toContain("publish_social:");
  });

  it("export reads the last completed output and notifies via an assistant thread message", () => {
    expect(src).toContain("lastCompleted?.output ?? \"\"");
    expect(src).toContain('setMessages((prev) => [...prev, { role: "assistant", content: msg }])');
  });

  it("T3.0 re-pin — no credit display introduced", () => {
    expect(src).not.toMatch(/agent.{0,5}credit|credits remaining/i);
  });
});

describe("HandoffPanel — additive onCandidates prop (render untouched)", () => {
  const src = readFileSync(join(COMPONENTS, "HandoffPanel.tsx"), "utf8");

  it("optional onCandidates prop reports raw candidates upward", () => {
    expect(src).toContain("onCandidates?: (candidates: ActionCandidate[]) => void");
    expect(src).toContain("onCandidates?.(candidates)");
  });

  it("W63 visible-candidates render path preserved", () => {
    expect(src).toContain("const visibleCandidates = actionCandidates");
  });
});

// ---------------------------------------------------------------------------
// W64 B2 wiring pins
// ---------------------------------------------------------------------------

describe("DepartmentRoom B2 pins — schedule + email + remaining dedup", () => {
  const src = readFileSync(join(COMPONENTS, "DepartmentRoom.tsx"), "utf8");

  it("schedule_followup opens the shared modal, seeded from classifier params or source work (D13)", () => {
    expect(src).toContain("schedule_followup: (candidate) => {");
    expect(src).toContain('typeof candidate.params?.task === "string"');
    expect(src).toContain("setFollowupOpen(true)");
    expect(src).toContain("<ScheduleFollowupModal");
  });

  it("draft_email deep-links to marketing via the existing handoff seam, guarded on savedDocId", () => {
    expect(src).toContain('handoffToDepartment("marketing")');
    expect(src).toContain("[W64] draft_email needs a saved document — noop");
  });

  it("D10'' remaining dedup — docx export + schedule static buttons suppress under dynamic chips", () => {
    expect(src).toContain('{!dynamicActions.has("export_document") && (');
    expect(src).toContain('{output && !dynamicActions.has("schedule_followup") && (');
  });

  it("exactly four dedup sites (image/video/export/schedule) — Save PDF stays static-only", () => {
    expect(src).toContain("window.print()");
    expect((src.match(/dynamicActions\.has\(/g) ?? []).length).toBe(4);
  });
});

describe("CommandCenter B2 pins — inline media + schedule + W35 email", () => {
  const src = readFileSync(join(COMPONENTS, "CommandCenter.tsx"), "utf8");

  it("inline media goes through the async runGeneration helper with an in-flight guard (W95.7.3b)", () => {
    // No longer a direct sync fetch — submit+poll via runGeneration, guarded so
    // a re-press during generation is a no-op (the operator's 3× press fix).
    expect(src).toContain("runGeneration({ userId, kind, prompt, aspectRatio");
    expect(src).toContain("mediaBusyRef");
    expect(src).not.toContain('fetch("/api/integrations/muapi"'); // sync path gone
  });

  it("D12 — image renders as markdown in the assistant thread; video as a link", () => {
    expect(src).toContain("![Generated visual](");
    expect(src).toContain("[▶ Watch it here](");
  });

  it("media failures land as plain assistant messages — no silent failure", () => {
    // CommandCenter surfaces the error from runGeneration as a thread message;
    // the "couldn't reach the service" wording now lives in generation-client.ts.
    expect(src).toContain("Couldn't generate the ${label} — try again.");
    const client = readFileSync(join(COMPONENTS, "..", "..", "lib", "generation-client.ts"), "utf8");
    expect(client).toContain("Couldn't reach the generation service:");
  });

  it("schedule_followup opens the shared modal (D13)", () => {
    expect(src).toContain("setFollowupOpen(true)");
    expect(src).toContain("<ScheduleFollowupModal");
  });

  it("draft_email is W35 one-click direct-execute into the Email Marketer", () => {
    expect(src).toContain('{ skipConfirm: true, preselectDept: "marketing", preselectAgent: "marketing-email-marketer" }');
  });

  it("draft_email / media noop with a warn when there is no completed output", () => {
    expect(src).toContain("[W64] draft_email with no completed output — noop");
    expect(src).toContain("[W64] generate_${kind} with no completed output — noop");
  });
});

describe("W63 emission seam preserved (W64 must not change the payload)", () => {
  it("ActionAffordances still emits staffd:action-select with {candidate, context}", () => {
    const src = readFileSync(join(COMPONENTS, "ActionAffordances.tsx"), "utf8");
    expect(src).toContain('"staffd:action-select"');
    expect(src).toContain("detail: { candidate, context }");
  });

  it("dispatcher listens on the exact same event name", () => {
    const src = readFileSync(join(LIB, "hooks", "useActionDispatcher.ts"), "utf8");
    expect(src).toContain('window.addEventListener("staffd:action-select", onSelect)');
    expect(src).toContain('window.removeEventListener("staffd:action-select", onSelect)');
  });
});
