/**
 * W67 — VoiceInput pins: feature detection, the idle↔listening machine,
 * append semantics (snapshot prefix + cumulative transcript), silent
 * permission fallback, engine-initiated end handling, unmount cleanup,
 * and the two mount points.
 */

import React from "react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "fs";
import { join } from "path";

import VoiceInput from "../../app/components/VoiceInput";

void React;

const COMPONENTS = join(__dirname, "..", "..", "app", "components");

/** Controllable SpeechRecognition stub installed as the webkit global. */
class RecognitionStub {
  static instances: RecognitionStub[] = [];
  continuous = false;
  interimResults = false;
  lang = "";
  onresult: ((e: unknown) => void) | null = null;
  onerror: (() => void) | null = null;
  onend: (() => void) | null = null;
  started = 0;
  stopped = 0;
  static nextStartThrows = false;
  constructor() { RecognitionStub.instances.push(this); }
  start() { if (RecognitionStub.nextStartThrows) throw new Error("denied"); this.started++; }
  stop() { this.stopped++; }
  emitResults(parts: Array<{ text: string; final: boolean }>) {
    const results = parts.map((p) => ({ isFinal: p.final, 0: { transcript: p.text } }));
    this.onresult?.({ results: { ...results, length: results.length } });
  }
}

function installRecognition() {
  RecognitionStub.instances = [];
  RecognitionStub.nextStartThrows = false;
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition = RecognitionStub;
}
function removeRecognition() {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  delete (window as unknown as Record<string, unknown>).SpeechRecognition;
}

beforeEach(installRecognition);
afterEach(() => {
  cleanup();
  removeRecognition();
});

describe("VoiceInput — feature detection (W67 Decision 2)", () => {
  it("renders nothing when no recognition API exists (Firefox case)", () => {
    removeRecognition();
    const { container } = render(<VoiceInput value="" onChange={() => {}} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders the mic button when the webkit-prefixed API exists", () => {
    const { container } = render(<VoiceInput value="" onChange={() => {}} />);
    expect(container.querySelector("button")).toBeTruthy();
    expect(container.textContent).toContain("🎤");
  });
});

describe("VoiceInput — state machine + recognition config", () => {
  it("click → listening (indicator + config per Decisions 10/13/14)", () => {
    const { container, getByRole } = render(<VoiceInput value="" onChange={() => {}} />);
    fireEvent.click(getByRole("button"));

    const rec = RecognitionStub.instances[0]!;
    expect(rec.started).toBe(1);
    expect(rec.continuous).toBe(true);
    expect(rec.interimResults).toBe(true);
    expect(rec.lang).toBeTruthy();
    expect(container.textContent).toContain("Listening…");
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("click while listening → stop() called, back to idle (Decision 6)", () => {
    const { container, getByRole } = render(<VoiceInput value="" onChange={() => {}} />);
    fireEvent.click(getByRole("button"));
    fireEvent.click(getByRole("button"));
    expect(RecognitionStub.instances[0]!.stopped).toBe(1);
    expect(container.textContent).toContain("🎤");
    expect(container.textContent).not.toContain("Listening…");
  });

  it("engine-initiated onend → idle, no crash, text preserved upstream (iOS quirk)", () => {
    const onChange = vi.fn();
    const { container, getByRole } = render(<VoiceInput value="" onChange={onChange} />);
    fireEvent.click(getByRole("button"));
    const rec = RecognitionStub.instances[0]!;
    act(() => rec.emitResults([{ text: "hello", final: true }]));
    act(() => rec.onend?.());
    expect(container.textContent).not.toContain("Listening…");
    // The last committed value stands — nothing reset it.
    expect(onChange).toHaveBeenLastCalledWith("hello");
  });

  it("permission denied (onerror) → silent idle, no error UI (Decision 7)", () => {
    const { container, getByRole } = render(<VoiceInput value="" onChange={() => {}} />);
    fireEvent.click(getByRole("button"));
    act(() => RecognitionStub.instances[0]!.onerror?.());
    expect(container.textContent).not.toContain("Listening…");
    expect(container.textContent).not.toMatch(/denied|error|blocked/i);
  });

  it("start() throwing → stays idle coherently", () => {
    const { container, getByRole } = render(<VoiceInput value="" onChange={() => {}} />);
    RecognitionStub.nextStartThrows = true;
    fireEvent.click(getByRole("button"));
    RecognitionStub.nextStartThrows = false;
    expect(container.textContent).not.toContain("Listening…");
  });

  it("unmount while listening → recognition stopped (no leak)", () => {
    const { getByRole, unmount } = render(<VoiceInput value="" onChange={() => {}} />);
    fireEvent.click(getByRole("button"));
    unmount();
    expect(RecognitionStub.instances[0]!.stopped).toBe(1);
  });
});

describe("VoiceInput — append semantics (W67 Decision 11, SA pin)", () => {
  it("interim results stream live; finals replace interim (cumulative rebuild)", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<VoiceInput value="" onChange={onChange} />);
    fireEvent.click(getByRole("button"));
    const rec = RecognitionStub.instances[0]!;

    act(() => rec.emitResults([{ text: "draft a fol", final: false }]));
    expect(onChange).toHaveBeenLastCalledWith("draft a fol");
    act(() => rec.emitResults([{ text: "draft a follow-up email", final: true }]));
    expect(onChange).toHaveBeenLastCalledWith("draft a follow-up email");
  });

  it("typed prefix preserved: 'Draft an email saying ' + spoken 'thank you' (SA smoke step 5)", () => {
    const onChange = vi.fn();
    const { getByRole } = render(
      <VoiceInput value="Draft an email saying " onChange={onChange} />
    );
    fireEvent.click(getByRole("button"));
    act(() => RecognitionStub.instances[0]!.emitResults([{ text: "thank you", final: true }]));
    expect(onChange).toHaveBeenLastCalledWith("Draft an email saying thank you");
  });

  it("prefix without trailing space gets a separator", () => {
    const onChange = vi.fn();
    const { getByRole } = render(<VoiceInput value="Draft an email" onChange={onChange} />);
    fireEvent.click(getByRole("button"));
    act(() => RecognitionStub.instances[0]!.emitResults([{ text: "about pricing", final: true }]));
    expect(onChange).toHaveBeenLastCalledWith("Draft an email about pricing");
  });
});

describe("mount points + invariants (W67)", () => {
  it("CommandCenter mounts VoiceInput wired to the input state, beside Send", () => {
    const src = readFileSync(join(COMPONENTS, "CommandCenter.tsx"), "utf8");
    expect(src).toContain('import VoiceInput from "./VoiceInput"');
    expect(src).toContain("<VoiceInput value={input} onChange={setInput} disabled={isWorking} />");
    // T3.0 re-pin.
    expect(src).not.toMatch(/agent.{0,5}credit|credits remaining/i);
  });

  it("DepartmentRoom mounts VoiceInput wired to the task state, beside Generate", () => {
    const src = readFileSync(join(COMPONENTS, "DepartmentRoom.tsx"), "utf8");
    expect(src).toContain('import VoiceInput from "./VoiceInput"');
    expect(src).toContain("<VoiceInput value={task}");
    // T3.0 re-pin.
    expect(src).not.toContain("creditsRemaining");
  });

  it("no third-party speech dependency, no server transmission (Decisions 1/3)", () => {
    const pkg = readFileSync(join(__dirname, "..", "..", "package.json"), "utf8");
    expect(pkg).not.toMatch(/speech|whisper|deepgram|assembly/i);
    const src = readFileSync(join(COMPONENTS, "VoiceInput.tsx"), "utf8");
    expect(src).not.toContain("fetch(");
  });
});
