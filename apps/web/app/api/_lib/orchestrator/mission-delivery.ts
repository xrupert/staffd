import type { MissionEventRecord } from "./mission-events";
import type { MissionRecord } from "./mission-repository";

export type MissionArtifact = {
  label: string;
  href: string;
  sourceEvent: string;
};

export type MissionDeliveryPackage = {
  outcome: string;
  completedAt: string | null;
  evidence: string[];
  artifacts: MissionArtifact[];
  actionsTaken: string[];
  approvals: string[];
  spentCredits: number;
  budgetCredits: number;
  nextAction: string;
};

const URL_PATTERN = /^https?:\/\/[^\s]+$/i;

function textValues(value: unknown, key = ""): Array<{ key: string; value: string }> {
  if (typeof value === "string") return [{ key, value }];
  if (Array.isArray(value)) return value.flatMap((item) => textValues(item, key));
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([childKey, child]) => textValues(child, childKey));
}

function artifactLabel(key: string, href: string): string {
  const normalized = key.replaceAll("_", " ").trim();
  if (normalized && !/^(url|href|link)$/i.test(normalized)) return normalized;
  try {
    const path = new URL(href).pathname.split("/").filter(Boolean).at(-1);
    return path ? decodeURIComponent(path) : "Delivered artifact";
  } catch {
    return "Delivered artifact";
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

export function buildMissionDeliveryPackage(
  mission: MissionRecord,
  events: readonly MissionEventRecord[],
): MissionDeliveryPackage | null {
  if (mission.status !== "completed") return null;

  const completion = [...events].reverse().find((event) => event.type === "mission_completed");
  const evidenceEvents = events.filter((event) => event.type === "evidence_recorded");
  const artifacts = evidenceEvents.flatMap((event) =>
    textValues(event.evidence).filter(({ value }) => URL_PATTERN.test(value)).map(({ key, value }) => ({
      label: artifactLabel(key, value),
      href: value,
      sourceEvent: event.id,
    })),
  );
  const artifactByHref = new Map(artifacts.map((artifact) => [artifact.href, artifact]));
  const completedSteps = events.filter((event) => event.type === "step_completed");
  const approvals = events.filter((event) => event.type === "mission_approved");
  const spentCredits = events.reduce((sum, event) => sum + Math.max(0, event.cost_credits ?? 0), 0);
  const recordedEvidence = evidenceEvents.flatMap((event) =>
    textValues(event.evidence)
      .filter(({ value }) => !URL_PATTERN.test(value))
      .map(({ value }) => value),
  );

  return {
    outcome: completion?.message?.trim() || mission.goal,
    completedAt: completion?.created ?? mission.updated ?? null,
    evidence: unique([...mission.evidence, ...recordedEvidence]),
    artifacts: [...artifactByHref.values()],
    actionsTaken: unique(completedSteps.map((event) => event.message)),
    approvals: unique(approvals.map((event) => event.message)),
    spentCredits,
    budgetCredits: mission.budget_credits,
    nextAction: "Review the delivered outcome, then ask STAFFD to measure performance or build the next mission.",
  };
}
