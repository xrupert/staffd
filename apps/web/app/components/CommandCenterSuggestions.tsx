"use client";

import { useEffect, useMemo, useState } from "react";
import pb from "../../lib/pb";
import {
  rankOutcomesByReadiness,
  type CapabilityReadiness,
} from "../api/_lib/orchestrator/capability-readiness";
import {
  STAFF_OUTCOMES,
  type StaffOutcome,
  type StaffOutcomeId,
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
  const [capabilities, setCapabilities] = useState<CapabilityReadiness[] | null>(null);
  const [starting, setStarting] = useState<StaffOutcomeId | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const baseOutcomes = useMemo(() => suggestedOutcomes(), []);

  useEffect(() => {
    if (!pb.authStore.token) return;

    void fetch("/api/capabilities", {
      headers: { Authorization: pb.authStore.token },
    })
      .then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ capabilities?: CapabilityReadiness[] }>;
      })
      .then((result) => setCapabilities(result?.capabilities ?? null))
      .catch(() => setCapabilities(null));
  }, []);

  const ranked = useMemo(
    () =>
      capabilities
        ? rankOutcomesByReadiness(baseOutcomes, capabilities)
        : baseOutcomes.map((outcome) => ({
            outcome,
            state: "ready" as const,
            missingCapabilities: [],
            degradedCapabilities: [],
            canStart: true,
          })),
    [baseOutcomes, capabilities],
  );

  async function startMission(outcome: StaffOutcome) {
    if (!pb.authStore.token || starting) return;
    setStarting(outcome.id);
    setStartError(null);

    try {
      const response = await fetch("/api/missions", {
        method: "POST",
        headers: {
          Authorization: pb.authStore.token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ outcomeId: outcome.id, goal: outcome.exampleRequest }),
      });
      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(result?.detail || "The mission could not be started.");
      }

      onPick(outcome.exampleRequest);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "The mission could not be started.");
    } finally {
      setStarting(null);
    }
  }

  return (
    <section className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
      <div className="mb-3">
        <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>
          What should your staff accomplish?
        </p>
        <p className="mt-1 text-xs" style={{ color: "#7A7A95" }}>
          Ready missions appear first. STAFFD handles the tools behind the scenes.
        </p>
        {startError && (
          <p className="mt-2 text-xs" role="alert" style={{ color: "#E78A8A" }}>
            {startError} Your request was not sent.
          </p>
        )}
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {ranked.map(({ outcome, state, canStart }) => {
          const isStarting = starting === outcome.id;
          return (
            <div
              key={outcome.id}
              className="rounded-xl px-3.5 py-3 text-left"
              style={{
                background: canStart ? "rgba(91,33,232,0.08)" : "rgba(255,255,255,0.025)",
                border: canStart
                  ? "1px solid rgba(91,33,232,0.24)"
                  : "1px solid rgba(122,122,149,0.18)",
                opacity: canStart ? 1 : 0.72,
              }}
            >
              <button
                onClick={() => void startMission(outcome)}
                disabled={!canStart || starting !== null}
                className="block w-full text-left disabled:cursor-not-allowed"
                title={outcome.exampleRequest}
              >
                <span className="block text-xs font-semibold" style={{ color: "#C4B5FD" }}>
                  {isStarting ? "Starting mission…" : outcome.title}
                </span>
                <span className="mt-1 block text-xs leading-relaxed" style={{ color: "#7A7A95" }}>
                  {outcome.userPromise}
                </span>
              </button>

              {state === "missing" ? (
                <a
                  href="/dashboard/settings"
                  className="mt-2 inline-block text-[10px] font-semibold uppercase tracking-wide"
                  style={{ color: "#A07BFF" }}
                >
                  Connect what this mission needs
                </a>
              ) : state === "degraded" ? (
                <span className="mt-2 block text-[10px] font-medium uppercase tracking-wide" style={{ color: "#D6A85F" }}>
                  Available, but a connection needs attention
                </span>
              ) : outcome.requiresApproval ? (
                <span className="mt-2 block text-[10px] font-medium uppercase tracking-wide" style={{ color: "#6D5FA0" }}>
                  You approve before anything is sent
                </span>
              ) : (
                <span className="mt-2 block text-[10px] font-medium uppercase tracking-wide" style={{ color: "#4A7A4A" }}>
                  Ready to start
                </span>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
