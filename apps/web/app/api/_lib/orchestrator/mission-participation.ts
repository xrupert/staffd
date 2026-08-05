import type { MissionRecord } from "./mission-repository";

export type MissionParticipationAction = "approve" | "start" | "resume";

export type MissionParticipationCard = {
  kind: "approval" | "start" | "repair";
  eyebrow: string;
  title: string;
  question: string;
  scope: string[];
  consequence: string;
  primaryLabel: string;
  primaryAction: MissionParticipationAction;
  secondaryLabel: string;
};

function approvalScope(mission: MissionRecord): string[] {
  const steps = mission.plan.steps
    .filter((step) => step.approvalRequired)
    .map((step) => step.title.trim())
    .filter(Boolean);

  return steps.length ? steps : ["Proceed with the mission as planned"];
}

export function missionParticipationCard(
  mission: MissionRecord,
): MissionParticipationCard | null {
  if (mission.status === "waiting_for_approval") {
    return {
      kind: "approval",
      eyebrow: "Your decision",
      title: "Approve the controlled work",
      question: "Should STAFFD proceed with these approval-gated steps?",
      scope: approvalScope(mission),
      consequence:
        "Approval resumes only the work described above. Existing budgets, evidence requirements, retries, and safety limits remain in force.",
      primaryLabel: "Approve these steps",
      primaryAction: "approve",
      secondaryLabel: "Keep paused",
    };
  }

  if (mission.status === "planned") {
    return {
      kind: "start",
      eyebrow: "Ready for you",
      title: "Start this mission",
      question: "Should STAFFD assemble the required staff and begin the approved plan?",
      scope: mission.plan.steps.map((step) => step.title).slice(0, 5),
      consequence:
        "STAFFD will begin eligible work now and pause again before any step that still requires your approval.",
      primaryLabel: "Start my staff",
      primaryAction: "start",
      secondaryLabel: "Leave ready",
    };
  }

  if (mission.status === "repairing" || mission.status === "failed") {
    return {
      kind: "repair",
      eyebrow: "Recovery decision",
      title: "Resume with safety limits",
      question: "Should STAFFD retry the mission from its last durable checkpoint?",
      scope: [
        mission.goal,
        mission.progress?.latestMessage ?? "Recover from the latest recorded mission state",
      ].filter(Boolean),
      consequence:
        "STAFFD will reuse the existing plan, budget, evidence contract, retry limits, and audit history rather than starting over.",
      primaryLabel: "Resume safely",
      primaryAction: "resume",
      secondaryLabel: "Keep stopped",
    };
  }

  return null;
}
