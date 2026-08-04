"use client";

import { useMemo } from "react";
import {
  STAFF_OUTCOMES,
  type StaffOutcome,
} from "../api/_lib/orchestrator/outcome-catalog";

type Props = {
  onPick: (prompt: string) => void;
};

function timeAwareOutcome(outcomes: readonly StaffOutcome[]): StaffOutcome {
  const hour = new Date().getHours();
  const preferredId =
    hour < 11
      ? "review-business-performance"
      : hour < 16
        ? "follow-up-warm-leads"
        : "clear-support-inbox";

  return outcomes.find((outcome) => outcome.id === preferredId) ?? outcomes[0]!;
}

function suggestedOutcomes(): StaffOutcome[] {
  const first = timeAwareOutcome(STAFF_OUTCOMES);
  const preferredIds = [
    "produce-viral-video",
    "launch-email-campaign",
    "review-business-performance",
  ] as const;
  const selected = [first];

  for (const id of preferredIds) {
    const outcome = STAFF_OUTCOMES.find((candidate) => candidate.id === id);
    if (outcome && !selected.some((candidate) => candidate.id === outcome.id)) {
      selected.push(outcome);
    }
    if (selected.length === 4) break;
  }

  return selected;
}

export default function CommandCenterSuggestions({ onPick }: Props) {
  const outcomes = useMemo(() => suggestedOutcomes(), []);

  return (
    <section className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
      <div className="mb-3">
        <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>
          What should your staff accomplish?
        </p>
        <p className="mt-1 text-xs" style={{ color: "#7A7A95" }}>
          Pick a common mission or describe the result you need below.
        </p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {outcomes.map((outcome) => (
          <button
            key={outcome.id}
            onClick={() => onPick(outcome.exampleRequest)}
            className="rounded-xl px-3.5 py-3 text-left transition-all hover:-translate-y-0.5"
            style={{
              background: "rgba(91,33,232,0.08)",
              border: "1px solid rgba(91,33,232,0.24)",
              cursor: "pointer",
            }}
            title={outcome.exampleRequest}
          >
            <span className="block text-xs font-semibold" style={{ color: "#C4B5FD" }}>
              {outcome.title}
            </span>
            <span className="mt-1 block text-xs leading-relaxed" style={{ color: "#7A7A95" }}>
              {outcome.userPromise}
            </span>
            {outcome.requiresApproval && (
              <span className="mt-2 block text-[10px] font-medium uppercase tracking-wide" style={{ color: "#6D5FA0" }}>
                You approve before anything is sent
              </span>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
