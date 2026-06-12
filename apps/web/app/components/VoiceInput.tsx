"use client";

/**
 * VoiceInput (W67) — browser-native speech-to-text for chat inputs.
 *
 * Web Speech API only: no third-party SDK, no audio leaves the browser,
 * no transcript persistence — STAFFD receives final text exactly as if
 * typed (Decisions 1/3/9). Feature detection hides the button entirely
 * on unsupported browsers (Firefox) — invisible beats broken (Decision 2).
 *
 * State machine: idle → listening → idle. Start AND stop are user clicks
 * (Decision 6); `onend`/`onerror` returning to idle is correctness
 * handling of browser-initiated termination (iOS Safari ends `continuous`
 * sessions on long pauses) — text is preserved, the user re-taps.
 * Permission denial lands in `onerror` and falls back silently
 * (Decision 7) — the browser owns re-prompting.
 *
 * Append semantics (Decision 11): the value at mic-start is snapshotted
 * as a fixed prefix; every recognition event rebuilds the full transcript
 * (finals + interim) and writes `prefix + transcript` through onChange —
 * typed text is never lost, interim text is live, and the user can edit
 * before sending.
 */

import { useEffect, useRef, useState } from "react";

type Props = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
};

/* Minimal structural types — lib.dom doesn't ship SpeechRecognition. */
type RecognitionResultEvent = {
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
};
type RecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: RecognitionResultEvent) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export default function VoiceInput({ value, onChange, disabled }: Props) {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<RecognitionLike | null>(null);
  const prefixRef = useRef("");
  // Latest value without re-binding handlers — snapshotted at mic-start.
  const valueRef = useRef(value);
  valueRef.current = value;

  // Cleanup on unmount — never leak a live recognition session.
  useEffect(() => {
    return () => {
      try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
      recognitionRef.current = null;
    };
  }, []);

  const Ctor = getRecognitionCtor();
  if (!Ctor) return null; // Decision 2 — invisible on unsupported browsers

  function start() {
    const rec = new Ctor!();
    rec.continuous = true;       // Decision 14
    rec.interimResults = true;   // Decision 14
    rec.lang = (typeof navigator !== "undefined" && navigator.language) || "en-US"; // Decision 13

    const base = valueRef.current ?? "";
    prefixRef.current = base && !/\s$/.test(base) ? `${base} ` : base;

    rec.onresult = (e) => {
      // Rebuild the entire session transcript each event — the results
      // list is cumulative under continuous mode.
      let transcript = "";
      for (let i = 0; i < e.results.length; i++) {
        transcript += e.results[i]![0].transcript;
      }
      onChange(prefixRef.current + transcript);
    };
    rec.onerror = () => setListening(false); // incl. not-allowed — silent (Decision 7)
    rec.onend = () => setListening(false);   // engine-initiated end — text preserved

    recognitionRef.current = rec;
    try {
      rec.start();
      setListening(true);
    } catch {
      setListening(false); // e.g. already-started race — stay coherent
    }
  }

  function stop() {
    try { recognitionRef.current?.stop(); } catch { /* already stopped */ }
    setListening(false);
  }

  return (
    <button
      type="button"
      onClick={() => (listening ? stop() : start())}
      disabled={disabled}
      aria-label={listening ? "Stop listening" : "Speak instead of typing — audio stays in your browser"}
      title={listening ? "Stop listening" : "Speak instead of typing — audio stays in your browser"}
      className="text-xs px-2.5 py-1.5 rounded-xl transition-colors"
      style={{
        background: listening ? "rgba(239,68,68,0.12)" : "transparent",
        border: `1px solid ${listening ? "rgba(239,68,68,0.4)" : "#2A2A38"}`,
        color: listening ? "#EF4444" : "#5A5A70",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.4 : 1,
      }}
    >
      {listening ? (
        <span className="flex items-center gap-1.5">
          <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#EF4444" }} />
          Listening…
        </span>
      ) : (
        <span aria-hidden>🎤</span>
      )}
    </button>
  );
}
