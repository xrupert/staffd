"use client";

import { useCallback, useEffect, useState } from "react";
import pb from "../../../lib/pb";
import type { MissionDeliveryPackage as DeliveryPackage } from "../../api/_lib/orchestrator/mission-delivery";
import type { MissionRecord } from "../../api/_lib/orchestrator/mission-repository";
import MissionDeliveryPackage from "./MissionDeliveryPackage";
import MissionParticipationPanel from "./MissionParticipationCard";

type MissionWithProgress = MissionRecord & {
  progress: {
    percent: number;
    completedSteps: number;
    totalSteps: number;
    spentCredits: number;
    latestMessage: string | null;
    latestAt: string | null;
  };
  delivery: DeliveryPackage | null;
};

type MissionAction = "approve" | "resume" | "start" | "cancel";

const LABELS: Record<MissionRecord["status"], string> = {
  draft: "Draft",
  planned: "Ready to start",
  running: "Working",
  waiting_for_approval: "Waiting on you",
  repairing: "Needs attention",
  completed: "Done",
  failed: "Needs attention",
};

export default function MissionsPage() {
  const [missions, setMissions] = useState<MissionWithProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [actingOn, setActingOn] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!pb.authStore.token) return;
    setLoading(true);
    try {
      const response = await fetch("/api/missions", { headers: { Authorization: pb.authStore.token } });
      if (!response.ok) throw new Error("Your missions could not be loaded.");
      const payload = (await response.json()) as { missions?: MissionWithProgress[] };
      setMissions(payload.missions ?? []);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Your missions could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function act(mission: MissionRecord, action: MissionAction) {
    if (actingOn) return;
    setActingOn(mission.id);
    setError(null);
    try {
      const response = await fetch(`/api/missions/${mission.id}`, {
        method: "PATCH",
        headers: { Authorization: pb.authStore.token, "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error === "mission_start_failed"
          ? "STAFFD could not safely assemble this mission. It has been moved to repair."
          : "STAFFD could not update that mission. Nothing unsafe was started.");
      }
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "STAFFD could not update that mission.");
    } finally {
      setActingOn(null);
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-5 py-8">
      <div className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>Mission Board</p>
        <h1 className="mt-2 text-2xl font-semibold" style={{ color: "#F0F0F8" }}>What your staff is working on</h1>
        <p className="mt-2 text-sm" style={{ color: "#7A7A95" }}>Review progress, make focused decisions, and recover missions that need attention.</p>
      </div>

      {error && <div className="mb-4 rounded-xl p-3 text-sm" style={{ background: "rgba(180,60,60,.12)", color: "#F0A0A0" }}>{error}</div>}
      {loading ? <p style={{ color: "#7A7A95" }}>Loading missions…</p> : missions.length === 0 ? (
        <div className="rounded-2xl p-6" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
          <p style={{ color: "#F0F0F8" }}>No missions yet.</p>
          <p className="mt-1 text-sm" style={{ color: "#7A7A95" }}>Start with an outcome in the Command Center.</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {missions.map((mission) => (
            <article key={mission.id} className="rounded-2xl p-5" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "#A07BFF" }}>{LABELS[mission.status]}</span>
                  <h2 className="mt-2 text-base font-semibold" style={{ color: "#F0F0F8" }}>{mission.goal}</h2>
                </div>
                <span className="rounded-full px-2 py-1 text-xs" style={{ background: "rgba(91,33,232,.12)", color: "#C4B5FD" }}>
                  {mission.progress.spentCredits}/{mission.budget_credits} credits
                </span>
              </div>

              <div className="mt-4">
                <div className="flex items-center justify-between text-xs" style={{ color: "#7A7A95" }}>
                  <span>{mission.progress.completedSteps} of {mission.progress.totalSteps} steps complete</span>
                  <span>{mission.progress.percent}%</span>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full" style={{ background: "#20202C" }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${mission.progress.percent}%`, background: "#5B21E8" }} />
                </div>
                {mission.progress.latestMessage && (
                  <p className="mt-2 text-xs" style={{ color: "#9A9AAF" }}>{mission.progress.latestMessage}</p>
                )}
              </div>

              <div className="mt-4">
                <p className="text-xs font-semibold" style={{ color: "#D0D0E8" }}>What success looks like</p>
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "#7A7A95" }}>
                  {mission.evidence.slice(0, 4).map((item) => <li key={item}>• {item}</li>)}
                </ul>
              </div>

              <MissionDeliveryPackage delivery={mission.delivery} />

              <MissionParticipationPanel
                mission={mission}
                disabled={actingOn === mission.id}
                onAction={(action) => void act(mission, action)}
              />

              {!(["completed", "failed"] as string[]).includes(mission.status) && (
                <div className="mt-4">
                  <button disabled={actingOn === mission.id} onClick={() => void act(mission, "cancel")} className="rounded-lg px-3 py-2 text-xs disabled:opacity-50" style={{ border: "1px solid #3A3A50", color: "#9A9AAF" }}>Cancel mission</button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
