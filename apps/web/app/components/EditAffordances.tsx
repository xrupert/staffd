"use client";

import { useState } from "react";
import type { EditOp } from "../api/_lib/generation/edit-ops";

/**
 * On-artifact edit bar (edit-as-intent). Presentational: declares the edit
 * target and emits (op, instruction, sourceUrl) to the parent, which owns the
 * runEdit call + active-artifact state. For a multi-image grid it owns the
 * selected-index (a refine needs an explicit pick — Law of Common Region).
 *
 * `Refine…` is the free-text entry: it asks the parent to focus the composer
 * with this artifact as the active target (op resolved server-side from text),
 * so it emits the sentinel op "refine".
 */

type Chip = { op: EditOp | "refine"; label: string; icon: string; instruction: string };

const IMAGE_CHIPS: Chip[] = [
  { op: "remove_background", label: "Remove background", icon: "🫥", instruction: "remove the background" },
  { op: "variations",       label: "Variations",        icon: "🔀", instruction: "give me variations" },
  { op: "refine",           label: "Refine…",           icon: "✦",  instruction: "" },
];
const VIDEO_CHIPS: Chip[] = [
  { op: "recombine",    label: "Reorder",      icon: "🔀", instruction: "reorder the clips" },
  { op: "trim",         label: "Trim",         icon: "✂️", instruction: "make it shorter" },
  { op: "add_captions", label: "Add captions", icon: "🔤", instruction: "add captions" },
];

export default function EditAffordances({
  kind, urls, onEdit,
}: {
  kind: "image" | "video";
  urls: string[];
  /** op "refine" → focus the composer for free text; otherwise apply directly. */
  onEdit: (op: EditOp | "refine", instruction: string, sourceUrl: string) => void;
}) {
  const isGrid = kind === "image" && urls.length > 1;
  const [picked, setPicked] = useState<number | null>(isGrid ? null : 0);
  const chips = kind === "image" ? IMAGE_CHIPS : VIDEO_CHIPS;
  const sourceUrl = picked != null ? urls[picked] : undefined;

  return (
    <div>
      {isGrid && (
        <div className="grid grid-cols-3 gap-1 p-1">
          {urls.map((u, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Option ${idx + 1}`}
              onClick={() => setPicked(idx)}
              style={{
                padding: 0, border: picked === idx ? "2px solid #A07BFF" : "1px solid #2A2A38",
                borderRadius: 8, overflow: "hidden", background: "#0D0D16", cursor: "pointer",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Option ${idx + 1}`} style={{ display: "block", width: "100%", height: "auto", maxHeight: 220, objectFit: "contain" }} />
            </button>
          ))}
        </div>
      )}

      {sourceUrl && (
        <div className="flex flex-wrap gap-2 px-2 py-2" style={{ borderTop: "1px solid #1E1E2A" }}>
          {isGrid && <span className="text-xs self-center" style={{ color: "#7070A0" }}>Editing option {(picked ?? 0) + 1} —</span>}
          {chips.map((c) => (
            <button
              key={c.op}
              type="button"
              aria-label={c.label}
              onClick={() => onEdit(c.op, c.instruction, sourceUrl)}
              className="inline-flex items-center gap-1 text-xs"
              style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid #2A2A38", color: "#D0D0E8", background: "transparent", cursor: "pointer" }}
            >
              <span aria-hidden="true">{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
