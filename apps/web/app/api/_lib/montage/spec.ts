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

export type SpecBeat = { label: string; text: string; onScreen?: string; startS?: number; endS?: number };

const LINE_RE = /^\s*(Hook|Beat\s*\d+|CTA|Mid|Close)\s*(?:\((\d+)[–\-—](\d+)s\))?\s*:?\s*(.*)$/i;
const ONSCREEN_RE = /On-screen(?: text)?(?:\s*\([^)]*\))?\s*:\s*([^\n]+)/i;
const SPOKEN_RE = /Spoken\s*:\s*/i;

export function parseBeats(script: string): SpecBeat[] {
  const beats: SpecBeat[] = [];
  for (const rawLine of script.split("\n")) {
    const m = rawLine.match(LINE_RE);
    if (!m || !m[4]?.trim()) continue;
    const body = m[4].trim();
    const onScreen = body.match(ONSCREEN_RE)?.[1]?.trim().replace(/^["“]|["”]$/g, "");
    const spoken = body
      .replace(ONSCREEN_RE, "")
      .replace(SPOKEN_RE, "")
      .replace(/[\[\]]/g, "")
      .replace(/["“”]/g, "")
      .trim();
    beats.push({
      label: m[1]!.replace(/\s+/g, " "),
      text: spoken || onScreen || body,
      onScreen,
      startS: m[2] ? Number.parseInt(m[2], 10) : undefined,
      endS: m[3] ? Number.parseInt(m[3], 10) : undefined,
    });
  }
  return beats;
}

const DEFAULT_BEAT_SECONDS = 4;

/** Build a v1 typed-scene timeline. Every cut is a text-driven Remotion
 *  scene; durations honor the script's timing ranges when present. */
export function buildEditDecisions(script: string, title: string): Record<string, unknown> | null {
  const beats = parseBeats(script);
  if (beats.length === 0) return null;

  let clock = 0;
  const cuts = beats.map((b, i) => {
    const dur = b.startS !== undefined && b.endS !== undefined && b.endS > b.startS
      ? b.endS - b.startS
      : DEFAULT_BEAT_SECONDS;
    const start = clock;
    clock += dur;
    const isHook = /hook/i.test(b.label);
    const isCta = /cta|close/i.test(b.label);
    return {
      id: `cut-${i + 1}`,
      type: isHook ? "hero_title" : isCta ? "callout" : "text_card",
      in_seconds: start,
      out_seconds: clock,
      layer: "primary",
      transition_in: i === 0 ? "fade" : "cut",
      transition_out: i === beats.length - 1 ? "fade" : "cut",
      // Typed-scene props (Remotion Explainer family)
      title: b.onScreen ?? b.text.slice(0, 60),
      body: b.onScreen ? b.text : undefined,
    };
  });

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
