"use client";

import { useEffect, useMemo, useState } from "react";
import pb from "../../lib/pb";
import ExecutiveAttentionCard, {
  type ExecutiveRecommendation,
} from "./ExecutiveAttentionCard";
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

type MissionBrief = {
  id: string;
  goal: string;
  status: string;
  updated?: string;
  progress?: {
    percent?: number;
    latestMessage?: string | null;
  };
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

function statusGroup(status: string): "attention" | "working" | "done" | "other" {
  if (["waiting_for_approval", "repairing", "blocked", "failed"].includes(status)) return "attention";
  if (["planned", "approved", "running"].includes(status)) return "working";
  if (["completed", "cancelled"].includes(status)) return "done";
  return "other";
}

function ExecutiveBriefing({ missions }: { missions: MissionBrief[] }) {
  const attention = missions.filter((mission) => statusGroup(mission.status) === "attention");
  const working = missions.filter((mission) => statusGroup(mission.status) === "working");
  const latest = [...missions]
    .sort((a, b) => (b.updated ?? "").localeCompare(a.updated ?? ""))
    .find((mission) => statusGroup(mission.status) !== "done");

  if (missions.length === 0) return null;

  return (
    <div className="mb-4 rounded-xl px-4 py-3" style={{ background: "rgba(255,255,255,0.025)", border: "1px solid #252534" }}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-semibold" style={{ color: "#F0F0F8" }}>Executive briefing</p>
          <p className="mt-1 text-xs" style={{ color: "#72728A" }}>
            {attention.length > 0
              ? `${attention.length} mission${attention.length === 1 ? " needs" : "s need"} your attention.`
              : working.length > 0
                ? `${working.length} mission${working.length === 1 ? " is" : "s are"} moving forward.`
                : "Your current missions are up to date."}
          </p>
        </div>
        <a href="/dashboard/missions" className="text-xs font-semibold" style={{ color: "#A98CFF" }}>
          Open Mission Board →
        </a>
      </div>

      {latest && (
        <div className="mt-3 flex items-center justify-between gap-4 rounded-lg px-3 py-2.5" style={{ background: "#12121A", border: "1px solid #252534" }}>
          <div className="min-w-0">
            <p className="truncate text-xs font-medium" style={{ color: "#BDBDD0" }}>{latest.goal}</p>
            <p className="mt-1 truncate text-[11px]" style={{ color: "#606078" }}>
              {latest.progress?.latestMessage || (latest.status === "waiting_for_approval" ? "Waiting for your approval" : "Your staff is coordinating the next step")}
            </p>
          </div>
          <span className="shrink-0 text-xs font-semibold" style={{ color: latest.status === "repairing" ? "#D6A85F" : "#8B68F2" }}>
            {Math.max(0, Math.min(100, latest.progress?.percent ?? 0))}%
          </span>
        </div>
      )}
    </div>
  );
}

export default function CommandCenterSuggestions({ onPick }: Props) {
  const [capabilities, setCapabilities] = useState<CapabilityReadiness[] | null>(null);
  const [missions, setMissions] = useState<MissionBrief[]>([]);
  const [recommendations, setRecommendations] = useState<ExecutiveRecommendation[]>([]);
  const [starting, setStarting] = useState<StaffOutcomeId | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const baseOutcomes = useMemo(() => suggestedOutcomes(), []);

  useEffect(() => {
    if (!pb.authStore.token) return;

    const headers = { Authorization: pb.authStore.token };

    void Promise.allSettled([
      fetch("/api/capabilities", { headers }).then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ capabilities?: CapabilityReadiness[] }>;
      }),
      fetch("/api/missions", { headers }).then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ missions?: MissionBrief[] }>;
      }),
      fetch("/api/executive/recommendations", { headers }).then(async (response) => {
        if (!response.ok) return null;
        return response.json() as Promise<{ recommendations?: ExecutiveRecommendation[] }>;
      }),
    ]).then(([capabilityResult, missionResult, recommendationResult]) => {
      if (capabilityResult.status === "fulfilled") {
        setCapabilities(capabilityResult.value?.capabilities ?? null);
      }
      if (missionResult.status === "fulfilled") {
        setMissions(missionResult.value?.missions ?? []);
      }
      if (recommendationResult.status === "fulfilled") {
        setRecommendations(recommendationResult.value?.recommendations ?? []);
      }
    });
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

      const result = (await response.json()) as {
        missionId: string;
        status: string;
        goal: string;
      };
      setMissions((current) => [
        {
          id: result.missionId,
          status: result.status,
          goal: result.goal,
          updated: new Date().toISOString(),
          progress: { percent: 0, latestMessage: result.status === "waiting_for_approval" ? "Waiting for your approval" : "Mission planned" },
        },
        ...current,
      ]);
      onPick(outcome.exampleRequest);
    } catch (error) {
      setStartError(error instanceof Error ? error.message : "The mission could not be started.");
    } finally {
      setStarting(null);
    }
  }

  return (
    <section className="px-5 py-4" style={{ borderBottom: "1px solid #1E1E2A" }}>
      {recommendations[0] && <ExecutiveAttentionCard recommendation={recommendations[0]} />}
      <ExecutiveBriefing missions={missions} />

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
                <a href="/dashboard/settings" className="mt-2 inline-block text-[10px] font-semibold uppercase tracking-wide" style={{ color: "#A07BFF" }}>
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
