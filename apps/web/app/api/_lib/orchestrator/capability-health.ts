import type { IntegrationType } from "../integrations/resolve";
import type { StaffCapability } from "./outcome-catalog";

export type CapabilityState = "ready" | "degraded" | "missing";

export type CapabilityHealth = {
  capability: StaffCapability;
  label: string;
  state: CapabilityState;
  message: string;
};

export type IntegrationProbe = {
  type: IntegrationType;
  configured: boolean;
  healthy: boolean;
};

const CAPABILITIES_BY_INTEGRATION: Record<IntegrationType, readonly StaffCapability[]> = {
  twenty: ["crm.read", "crm.write"],
  chatwoot: ["support.read", "support.reply"],
  listmonk: ["email.read", "email.send"],
  plausible: ["analytics.read"],
  docuseal: ["signature.send"],
  postiz: ["social.publish"],
};

const CAPABILITY_LABELS: Record<StaffCapability, string> = {
  "crm.read": "Customer relationships",
  "crm.write": "Customer relationships",
  "support.read": "Support inbox",
  "support.reply": "Support inbox",
  "email.read": "Email campaigns",
  "email.send": "Email campaigns",
  "analytics.read": "Business analytics",
  "signature.send": "Electronic signatures",
  "social.publish": "Social publishing",
  "media.produce": "Video production",
};

export function capabilityHealthFromProbes(
  probes: readonly IntegrationProbe[],
  platform: { mediaProductionReady: boolean; socialPublishingEnabled: boolean },
): CapabilityHealth[] {
  const byCapability = new Map<StaffCapability, CapabilityHealth>();

  for (const probe of probes) {
    for (const capability of CAPABILITIES_BY_INTEGRATION[probe.type]) {
      const enabled = capability !== "social.publish" || platform.socialPublishingEnabled;
      const state: CapabilityState = !enabled || !probe.configured
        ? "missing"
        : probe.healthy
          ? "ready"
          : "degraded";

      byCapability.set(capability, {
        capability,
        label: CAPABILITY_LABELS[capability],
        state,
        message:
          state === "ready"
            ? "Ready for your staff to use."
            : state === "degraded"
              ? "Connected, but it needs attention before dependable use."
              : "Connect this capability in Settings to unlock the mission.",
      });
    }
  }

  byCapability.set("media.produce", {
    capability: "media.produce",
    label: CAPABILITY_LABELS["media.produce"],
    state: platform.mediaProductionReady ? "ready" : "missing",
    message: platform.mediaProductionReady
      ? "Ready for your staff to produce complete media."
      : "Video production is not available yet.",
  });

  return [...byCapability.values()].sort((left, right) =>
    left.capability.localeCompare(right.capability),
  );
}

export function readyCapabilities(health: readonly CapabilityHealth[]): StaffCapability[] {
  return health
    .filter((item) => item.state === "ready")
    .map((item) => item.capability);
}
