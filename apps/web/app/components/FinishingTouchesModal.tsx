"use client";

/**
 * FinishingTouchesModal (S4b) — the participation moment.
 *
 * After the Studio delivers a cut, the owner gets a director's pass: a
 * scene-strip preview of the timeline (pure STAFFD React/CSS — NEVER
 * OpenMontage composer components; AGPL covered-work boundary), editable
 * on-screen copy per scene, and the branded fade-to-black outro. One click
 * re-renders through the same produce → webhook → grader path.
 *
 * The point isn't efficiency — it's ownership. Three minutes of tweaks the
 * user chose to make turn "the machine made a video" into "I finished MY
 * video."
 */

import { useEffect, useState } from "react";
import pb from "../../lib/pb";
import { useEscapeClose } from "../../lib/hooks/useEscapeClose";
import { runFinishingTouches } from "../../lib/generation-client";

type Scene = {
  index: number;
  label: string;
  text: string;
  startS?: number;
  endS?: number;
  type: "hero_title" | "callout" | "text_card";
};

const TYPE_STYLE: Record<Scene["type"], { color: string; label: string }> = {
  hero_title: { color: "#7C4FF0", label: "Hook" },
  text_card:  { color: "#38BDF8", label: "Scene" },
  callout:    { color: "#F59E0B", label: "CTA" },
};

const OUTRO_COLOR = "#22C55E";

type Props = {
  open: boolean;
  jobId: string;
  onClose: () => void;
  /** Called with the fresh render when the director's cut completes. */
  onRendered: (url: string, newJobId: string) => void;
};

export default function FinishingTouchesModal({ open, jobId, onClose, onRendered }: Props) {
  useEscapeClose(onClose, open);
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [outro, setOutro] = useState("");
  const [outroDefault, setOutroDefault] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !jobId) return;
    setScenes(null);
    setEdits({});
    setLoadError(null);
    setRenderError(null);
    void (async () => {
      try {
        const res = await fetch(`/api/montage/touches?jobId=${encodeURIComponent(jobId)}`, {
          headers: { Authorization: pb.authStore.token },
        });
        const data = (await res.json().catch(() => ({}))) as { scenes?: Scene[]; outroDefault?: string; error?: string };
        if (!res.ok || !data.scenes) {
          setLoadError("Couldn't load the scene breakdown for this video.");
          return;
        }
        setScenes(data.scenes);
        setOutroDefault(data.outroDefault ?? "");
        setOutro(data.outroDefault ?? "");
      } catch {
        setLoadError("Couldn't load the scene breakdown — check your connection.");
      }
    })();
  }, [open, jobId]);

  if (!open) return null;

  const totalS = (scenes ?? []).reduce((sum, s) => {
    const dur = s.startS !== undefined && s.endS !== undefined && s.endS > s.startS ? s.endS - s.startS : 4;
    return sum + dur;
  }, 0) + (outro.trim() ? 3 : 0);

  const dirty = Object.keys(edits).length > 0 || outro.trim() !== outroDefault.trim();

  async function rerender() {
    if (rendering || !scenes) return;
    setRendering(true);
    setRenderError(null);
    const { url, error, jobId: newJobId } = await runFinishingTouches({
      jobId,
      outroText: outro,
      textOverrides: edits,
    });
    setRendering(false);
    if (url && newJobId) {
      onRendered(url, newJobId);
      onClose();
    } else {
      setRenderError(error === "studio_unavailable"
        ? "The Studio couldn't take the re-render right now — try again in a moment."
        : error ?? "The re-render didn't complete — try again.");
    }
  }

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6"
      style={{ background: "rgba(0,0,0,0.72)" }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-2xl rounded-2xl overflow-hidden anim-modal flex flex-col"
        style={{ background: "#111118", border: "1px solid #2A2A38", maxHeight: "88vh" }}
      >
        {/* Header */}
        <div className="px-6 py-4 flex items-center justify-between flex-shrink-0" style={{ borderBottom: "1px solid #1E1E2A" }}>
          <div>
            <h2 className="text-base font-semibold" style={{ color: "#F0F0F8" }}>Finishing touches</h2>
            <p className="text-xs mt-0.5" style={{ color: "#7A7A95" }}>
              Your director&apos;s pass — tweak any scene&apos;s on-screen text, set your outro, and re-render.
            </p>
          </div>
          <button onClick={onClose} className="text-xs transition-colors hover:text-white" style={{ color: "#7A7A95" }}>
            Close
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          {loadError && <p className="text-xs py-6" style={{ color: "#EF4444" }}>{loadError}</p>}
          {!scenes && !loadError && (
            <div className="py-10 flex items-center gap-2" style={{ color: "#7A7A95" }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
              <span className="text-xs">Reading your timeline…</span>
            </div>
          )}

          {scenes && (
            <>
              {/* Scene strip — proportional timeline preview (STAFFD-built) */}
              <div className="mb-1 flex w-full rounded-lg overflow-hidden" style={{ height: 44, border: "1px solid #232330" }}>
                {scenes.map((s) => {
                  const dur = s.startS !== undefined && s.endS !== undefined && s.endS > s.startS ? s.endS - s.startS : 4;
                  const st = TYPE_STYLE[s.type];
                  return (
                    <div
                      key={s.index}
                      className="flex items-center justify-center overflow-hidden"
                      style={{
                        width: `${(dur / Math.max(totalS, 1)) * 100}%`,
                        background: `${st.color}26`,
                        borderRight: "1px solid #111118",
                      }}
                      title={`${s.label} — ${dur}s`}
                    >
                      <span className="text-[9px] font-bold uppercase tracking-wide px-1 truncate" style={{ color: st.color }}>
                        {st.label}
                      </span>
                    </div>
                  );
                })}
                {outro.trim() && (
                  <div
                    className="flex items-center justify-center"
                    style={{ width: `${(3 / Math.max(totalS, 1)) * 100}%`, background: `${OUTRO_COLOR}26` }}
                    title="Branded outro — 3s fade to black"
                  >
                    <span className="text-[9px] font-bold uppercase tracking-wide truncate px-1" style={{ color: OUTRO_COLOR }}>Outro</span>
                  </div>
                )}
              </div>
              <p className="text-[10px] mb-5" style={{ color: "#5A5A75" }}>
                {scenes.length} scene{scenes.length === 1 ? "" : "s"} · about {totalS} seconds{outro.trim() ? " · branded outro" : ""}
              </p>

              {/* Per-scene copy edits */}
              <div className="flex flex-col gap-3 mb-6">
                {scenes.map((s) => {
                  const st = TYPE_STYLE[s.type];
                  const timing = s.startS !== undefined && s.endS !== undefined ? ` · ${s.startS}–${s.endS}s` : "";
                  return (
                    <div key={s.index}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: st.color }}>{s.label}</span>
                        <span className="text-[10px]" style={{ color: "#5A5A75" }}>{timing}</span>
                      </div>
                      <input
                        value={edits[s.index] ?? s.text}
                        maxLength={140}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEdits((prev) => {
                            if (v === s.text) {
                              const next = { ...prev };
                              delete next[s.index];
                              return next;
                            }
                            return { ...prev, [s.index]: v };
                          });
                        }}
                        className="w-full text-xs px-3 py-2.5 rounded-xl outline-none"
                        style={{
                          background: "#0D0D16",
                          border: `1px solid ${edits[s.index] !== undefined ? st.color : "#2A2A38"}`,
                          color: "#D0D0E8",
                        }}
                      />
                    </div>
                  );
                })}

                {/* Outro — the owner's mark */}
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold uppercase tracking-wide" style={{ color: OUTRO_COLOR }}>Fade-to-black outro</span>
                    <span className="text-[10px]" style={{ color: "#5A5A75" }}>3s · leave empty to skip</span>
                  </div>
                  <input
                    value={outro}
                    maxLength={60}
                    placeholder="Your business name"
                    onChange={(e) => setOutro(e.target.value)}
                    className="w-full text-xs px-3 py-2.5 rounded-xl outline-none"
                    style={{
                      background: "#0D0D16",
                      border: `1px solid ${outro.trim() !== outroDefault.trim() ? OUTRO_COLOR : "#2A2A38"}`,
                      color: "#D0D0E8",
                    }}
                  />
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 flex items-center gap-4 flex-shrink-0" style={{ borderTop: "1px solid #1E1E2A" }}>
          <button
            onClick={() => void rerender()}
            disabled={!scenes || rendering}
            className="px-4 py-2 rounded-xl text-xs font-semibold text-white btn-primary"
            style={{ opacity: !scenes || rendering ? 0.6 : 1 }}
          >
            {rendering ? "Rendering your cut…" : dirty ? "Re-render with my touches" : "Re-render as-is"}
          </button>
          {!rendering && (
            <button onClick={onClose} className="text-xs transition-colors hover:text-white" style={{ color: "#7A7A95", background: "none", border: "none", cursor: "pointer" }}>
              Keep the current cut
            </button>
          )}
          {rendering && (
            <span className="text-xs" style={{ color: "#7A7A95" }}>Usually under a minute — the finished cut lands right in this thread.</span>
          )}
          {renderError && <span className="text-xs" style={{ color: "#EF4444" }}>{renderError}</span>}
        </div>
      </div>
    </div>
  );
}
