/**
 * S3 — script → edit_decisions spec generator (v1, EXPERIMENTAL).
 *
 * Turns a single scripted video (the P1 extractor's output: Hook / Beats /
 * CTA with optional "(0–3s)" timing ranges and On-screen text) into an
 * OpenMontage `edit_decisions` timeline using TYPED Remotion scenes
 * (hero_title / text_card / callout) — a complete, branded, text-driven
 * video with no external assets required. AI clips (muapi) join as cut
 * sources in a later slice via the asset manifest.
 *
 * The montage service re-validates against the canonical JSON schema and
 * returns 422 with detail on any mismatch — callers surface that honestly
 * and fall back to the single-clip path.
 */

/** Camera-facing scripts need the OWNER on camera — no pipeline may invent
 *  an AI presenter for them (live incident: the single-clip fallback
 *  generated a random spokesperson from a talking-head script). */
export function isCameraFacing(script: string): boolean {
  return /\[Camera:|talking head|phone-shot|direct to camera|camera-facing|🎬/i.test(script);
}

export type SpecBeat = { label: string; text: string; onScreen?: string; startS?: number; endS?: number };

// Format tolerance (live incident: "🪝 HOOK (0:00–0:03)" / "RETENTION HOOK #1
// — Twist the knife (0:03–0:12)" / "PATTERN INTERRUPT #2" parsed as nothing
// and the production silently fell back to a single AI clip). Leading
// emoji/bullets/markdown strip first; labels cover the strategist
// vocabulary; timings accept both "(0–3s)" and "(0:00–0:03)" forms.
const LINE_RE = /^(Hook|Retention\s*Hook\s*#?\d*|Pattern\s*Interrupt\s*#?\d*|Beat\s*\d+|CTA|Mid|Close)[^(:\n]*(?:\((\d+(?::\d{2})?)\s*[–\-—]\s*(\d+(?::\d{2})?)s?\))?\s*:?\s*(.*)$/i;
const STRIP_RE = /^[\s*#>•\-]*(?:[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]+\s*)*/u;
const ONSCREEN_RE = /On-screen(?: text)?(?:\s*\([^)]*\))?\s*:\s*([^\n]+)/i;
const SPOKEN_RE = /Spoken\s*:\s*/i;

function toSeconds(t: string | undefined): number | undefined {
  if (!t) return undefined;
  if (t.includes(":")) {
    const [m, sec] = t.split(":");
    return Number.parseInt(m ?? "0", 10) * 60 + Number.parseInt(sec ?? "0", 10);
  }
  return Number.parseInt(t, 10);
}

function absorb(beat: SpecBeat, line: string): void {
  const onScreen = line.match(ONSCREEN_RE)?.[1]?.trim().replace(/^["“]|["”]$/g, "");
  if (onScreen && !beat.onScreen) beat.onScreen = onScreen;
  const rest = line
    .replace(ONSCREEN_RE, "")
    .replace(/[\[\]]/g, "")
    .replace(/["“”]/g, "")
    .trim();
  if (/^Camera\b/i.test(rest)) return; // stage direction, not copy
  const isSpoken = SPOKEN_RE.test(line);
  const cleaned = rest.replace(SPOKEN_RE, "").trim();
  if (!cleaned) return;
  if (isSpoken || !beat.text) beat.text = cleaned; // Spoken copy wins
}

export function parseBeats(script: string): SpecBeat[] {
  const beats: SpecBeat[] = [];
  let cur: SpecBeat | null = null;
  const push = () => {
    if (cur && (cur.text || cur.onScreen)) {
      if (!cur.text) cur.text = cur.onScreen ?? "";
      beats.push(cur);
    }
  };
  for (const rawLine of script.split("\n")) {
    const line = rawLine.replace(STRIP_RE, "").trim();
    if (!line) continue;
    const m = line.match(LINE_RE);
    if (m) {
      push();
      cur = {
        label: m[1]!.replace(/\s+/g, " "),
        text: "",
        startS: toSeconds(m[2]),
        endS: toSeconds(m[3]),
      };
      const inline = (m[4] ?? "").trim();
      if (inline && cur) absorb(cur, inline);
      continue;
    }
    if (cur) absorb(cur, line);
  }
  push();
  return beats;
}

const DEFAULT_BEAT_SECONDS = 4;

/** Build a v1 typed-scene timeline. Every cut is a text-driven Remotion
 *  scene; durations honor the script's timing ranges when present.
 *  Field names match the Explainer composition's Cut contract exactly:
 *  typed scenes read `text` (+ `subtitle`), NOT title/body — the wrong
 *  names render black scenes (verified against the composer source). */
export function buildEditDecisions(
  script: string,
  title: string,
  opts?: {
    outroText?: string;
    /** S4b Finishing Touches — per-beat on-screen copy overrides, keyed by
     *  beat index. The user's edit wins over the parsed script text. */
    textOverrides?: Record<number, string>;
  },
): Record<string, unknown> | null {
  const beats = parseBeats(script);
  if (beats.length === 0) return null;

  let clock = 0;
  const cuts: Array<Record<string, unknown>> = beats.map((b, i) => {
    const dur = b.startS !== undefined && b.endS !== undefined && b.endS > b.startS
      ? b.endS - b.startS
      : DEFAULT_BEAT_SECONDS;
    const start = clock;
    clock += dur;
    const isHook = /hook/i.test(b.label) && i === 0;
    const isCta = /cta|close/i.test(b.label);
    const override = (opts?.textOverrides?.[i] ?? "").trim();
    const primary = override || (b.onScreen ?? b.text);
    return {
      id: `cut-${i + 1}`,
      type: isHook ? "hero_title" : isCta ? "callout" : "text_card",
      in_seconds: start,
      out_seconds: clock,
      layer: "primary",
      transition_in: i === 0 ? "fade" : "cut",
      transition_out: "cut",
      // Explainer Cut contract: `text` carries the on-screen copy.
      text: primary.slice(0, 140),
      subtitle: isHook && b.onScreen && b.text !== b.onScreen ? b.text.slice(0, 90) : undefined,
    };
  });

  // S4 — branded fade-to-black close (the owner's mark on every video).
  const outro = (opts?.outroText ?? "").trim();
  if (outro) {
    cuts.push({
      id: "outro",
      type: "logo_outro",
      in_seconds: clock,
      out_seconds: clock + 3,
      layer: "primary",
      transition_in: "fade",
      transition_out: "fade",
      text: outro.slice(0, 60),
    });
    clock += 3;
  }

  return {
    version: "1.0",
    cuts,
    overlays: [],
    subtitles: { enabled: false },
    renderer_family: "explainer-data",
    render_runtime: "remotion",
    composition_mode: "templated",
    metadata: { title, generator: "staffd-spec-v1", beat_count: beats.length },
  };
}
