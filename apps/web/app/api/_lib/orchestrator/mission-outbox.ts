import type { MissionEventType } from "./mission-events";

export type PendingMissionEvent = {
  key: string;
  type: MissionEventType;
  message: string;
  stepId?: string;
  evidence?: Record<string, unknown>;
  costCredits?: number;
  queuedAt: string;
};

export function createPendingMissionEvent(
  input: Omit<PendingMissionEvent, "key" | "queuedAt"> & { key?: string; now?: string },
): PendingMissionEvent {
  const queuedAt = input.now ?? new Date().toISOString();
  return {
    key: input.key ?? globalThis.crypto?.randomUUID?.() ?? `event-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    type: input.type,
    message: input.message,
    stepId: input.stepId,
    evidence: input.evidence,
    costCredits: input.costCredits,
    queuedAt,
  };
}

export function enqueueMissionEvent(
  current: readonly PendingMissionEvent[] | null | undefined,
  next: PendingMissionEvent,
): PendingMissionEvent[] {
  if ((current ?? []).some((event) => event.key === next.key)) return [...(current ?? [])];
  return [...(current ?? []), next];
}

export function removeDeliveredMissionEvents(
  current: readonly PendingMissionEvent[] | null | undefined,
  deliveredKeys: ReadonlySet<string>,
): PendingMissionEvent[] {
  return (current ?? []).filter((event) => !deliveredKeys.has(event.key));
}
