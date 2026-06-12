"use client";

/**
 * ActionAffordances (W63) — renders W62 action candidates as user-facing
 * chips. The visible half of D-21's handoff intelligence.
 *
 * One shared component, two mount points (W63 Decision 1/3): inside
 * HandoffPanel for DepartmentRoom, and inside CommandCenter's Next-steps
 * block. Inherits the followUps chip styling (Decision 2); reason surfaces
 * via native `title` tooltip (Decision 6); confidence is never shown
 * (Decision 7); hidden actions (publish_social) never render (Decision 8).
 *
 * Clicks are STUBS in W63 (Decision 5): they emit the locked
 * `staffd:action-select` CustomEvent — the permanent attachment seam W64
 * wires real handlers onto — plus a console.info for V1 debugging
 * (removed when analytics attaches).
 */

import {
  ACTION_UI,
  type ActionCandidate,
} from "../api/_lib/orchestrator/action-vocabulary";

export type ActionContext = {
  department: string;
  documentId?: string;
};

/** W63 Decision 5 — the locked selection stub. Exported for tests. */
export function handleActionSelect(candidate: ActionCandidate, context: ActionContext): void {
  console.info("[W63] action selected", { id: candidate.id, context });
  window.dispatchEvent(
    new CustomEvent("staffd:action-select", {
      detail: { candidate, context },
    })
  );
}

type Props = {
  candidates: ActionCandidate[] | undefined | null;
  context: ActionContext;
};

export default function ActionAffordances({ candidates, context }: Props) {
  const visible = (candidates ?? []).filter((c) => !ACTION_UI[c.id]?.hidden);
  if (visible.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 mt-2">
      <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
        Your staff can take it from here
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((c) => {
          const ui = ACTION_UI[c.id];
          return (
            <button
              key={c.id}
              onClick={() => handleActionSelect(c, context)}
              title={c.reason}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors hover:text-white"
              style={{
                background: "rgba(91,33,232,0.12)",
                border: "1px solid rgba(91,33,232,0.30)",
                color: "#A07BFF",
                cursor: "pointer",
              }}
            >
              <span style={{ marginRight: "6px" }}>{ui.icon}</span>
              {ui.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
