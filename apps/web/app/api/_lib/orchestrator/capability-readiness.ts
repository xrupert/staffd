import type { StaffCapability, StaffOutcome } from "./outcome-catalog";

export type CapabilityState = "ready" | "degraded" | "missing";

export type CapabilityReadiness = {
  capability: StaffCapability;
  state: CapabilityState;
  lastSuccessfulAt?: string;
  reason?: string;
};

export type OutcomeReadiness = {
  outcome: StaffOutcome;
  state: CapabilityState;
  missingCapabilities: StaffCapability[];
  degradedCapabilities: StaffCapability[];
  canStart: boolean;
};

export function assessOutcomeReadiness(
  outcome: StaffOutcome,
  readiness: readonly CapabilityReadiness[],
): OutcomeReadiness {
  const states = new Map(readiness.map((entry) => [entry.capability, entry.state]));
  const missingCapabilities = outcome.capabilities.filter(
    (capability) => states.get(capability) !== "ready" && states.get(capability) !== "degraded",
  );
  const degradedCapabilities = outcome.capabilities.filter(
    (capability) => states.get(capability) === "degraded",
  );

  return {
    outcome,
    state:
      missingCapabilities.length > 0
        ? "missing"
        : degradedCapabilities.length > 0
          ? "degraded"
          : "ready",
    missingCapabilities,
    degradedCapabilities,
    canStart: missingCapabilities.length === 0,
  };
}

export function rankOutcomesByReadiness(
  outcomes: readonly StaffOutcome[],
  readiness: readonly CapabilityReadiness[],
): OutcomeReadiness[] {
  const rank: Record<CapabilityState, number> = { ready: 0, degraded: 1, missing: 2 };

  return outcomes
    .map((outcome) => assessOutcomeReadiness(outcome, readiness))
    .sort((left, right) => rank[left.state] - rank[right.state]);
}
