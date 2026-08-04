export type ExecutiveRecommendationPriority = "critical" | "high" | "normal";

export type MissionSignal = {
  id: string;
  goal: string;
  status: string;
  updated?: string;
  progress?: {
    percent?: number;
    latestMessage?: string | null;
  };
};

export type ExecutiveRecommendation = {
  id: string;
  missionId: string;
  priority: ExecutiveRecommendationPriority;
  title: string;
  reason: string;
  actionLabel: string;
  actionHref: string;
  evidence: string[];
};

function ageInHours(updated: string | undefined, now: Date): number | null {
  if (!updated) return null;
  const timestamp = Date.parse(updated);
  if (!Number.isFinite(timestamp)) return null;
  return Math.max(0, (now.getTime() - timestamp) / 3_600_000);
}

function evidenceFor(mission: MissionSignal, extra: string): string[] {
  const evidence = [extra];
  if (typeof mission.progress?.percent === "number") {
    evidence.push(`${mission.progress.percent}% complete`);
  }
  if (mission.progress?.latestMessage) evidence.push(mission.progress.latestMessage);
  return evidence;
}

export function recommendExecutiveActions(
  missions: readonly MissionSignal[],
  now = new Date(),
): ExecutiveRecommendation[] {
  const recommendations: ExecutiveRecommendation[] = [];

  for (const mission of missions) {
    const ageHours = ageInHours(mission.updated, now);
    const boardHref = `/dashboard/missions#mission-${mission.id}`;

    if (mission.status === "waiting_for_approval") {
      recommendations.push({
        id: `approve-${mission.id}`,
        missionId: mission.id,
        priority: "critical",
        title: `Your approval is holding up: ${mission.goal}`,
        reason: "STAFFD will not send, publish, sign, or commit external work without your approval.",
        actionLabel: "Review and decide",
        actionHref: boardHref,
        evidence: evidenceFor(mission, "Mission is waiting for owner approval"),
      });
      continue;
    }

    if (mission.status === "repairing" || mission.status === "failed") {
      recommendations.push({
        id: `repair-${mission.id}`,
        missionId: mission.id,
        priority: "critical",
        title: `STAFFD needs help recovering: ${mission.goal}`,
        reason: "The execution loop could not safely complete this mission without intervention.",
        actionLabel: "Review the repair",
        actionHref: boardHref,
        evidence: evidenceFor(mission, "Mission entered repair or failure state"),
      });
      continue;
    }

    if (mission.status === "running" && ageHours !== null && ageHours >= 24) {
      recommendations.push({
        id: `stalled-${mission.id}`,
        missionId: mission.id,
        priority: "high",
        title: `Check on stalled work: ${mission.goal}`,
        reason: "This mission has been running for more than 24 hours without a recent state change.",
        actionLabel: "Inspect progress",
        actionHref: boardHref,
        evidence: evidenceFor(mission, `${Math.floor(ageHours)} hours since the mission changed`),
      });
      continue;
    }

    if (mission.status === "planned") {
      recommendations.push({
        id: `start-${mission.id}`,
        missionId: mission.id,
        priority: "normal",
        title: `Your staff is ready to begin: ${mission.goal}`,
        reason: "The Chief Orchestrator has prepared the execution graph and the mission can start.",
        actionLabel: "Start my staff",
        actionHref: boardHref,
        evidence: evidenceFor(mission, "Mission plan is ready"),
      });
      continue;
    }

    if (mission.status === "completed" && ageHours !== null && ageHours <= 48) {
      recommendations.push({
        id: `review-${mission.id}`,
        missionId: mission.id,
        priority: "normal",
        title: `Review completed work: ${mission.goal}`,
        reason: "A recently completed mission is ready for your review, reuse, or follow-up.",
        actionLabel: "Review the result",
        actionHref: boardHref,
        evidence: evidenceFor(mission, "Mission completed within the last 48 hours"),
      });
    }
  }

  const weight: Record<ExecutiveRecommendationPriority, number> = {
    critical: 0,
    high: 1,
    normal: 2,
  };

  return recommendations.sort((left, right) =>
    weight[left.priority] - weight[right.priority] || left.title.localeCompare(right.title),
  );
}
