import { testConnection } from "../integrations/test-connection";
import {
  INTEGRATION_TYPES,
  resolveCredentials,
  type IntegrationType,
  type ResolveUser,
} from "../integrations/resolve";
import { externalInboxItem } from "./inbox-source-adapters";
import type { BusinessInboxItem } from "./business-inbox";

const PROBE_TIMEOUT_MS = 3_500;

const CAPABILITY_NAMES: Record<IntegrationType, string> = {
  twenty: "Sales workspace",
  chatwoot: "Customer support",
  listmonk: "Email marketing",
  plausible: "Website analytics",
  docuseal: "E-signatures",
  postiz: "Social publishing",
};

export function customerFacingProbeError(error: string | undefined): string {
  const value = error?.toLowerCase() ?? "";
  if (value.includes("timed out") || value.includes("timeout")) return "The connection check timed out";
  if (/\b(401|403)\b/.test(value)) return "The saved credentials were rejected";
  if (value.includes("fetch") || value.includes("network") || value.includes("connect")) {
    return "The connected service could not be reached";
  }
  return "The connection check failed";
}

export function integrationIncidentInboxItem(
  type: IntegrationType,
  error: string | undefined,
  occurredAt = new Date(),
): BusinessInboxItem {
  const capability = CAPABILITY_NAMES[type];
  const item = externalInboxItem({
    provider: type,
    sourceId: type,
    kind: "integration_incident",
    title: `${capability} needs attention`,
    summary: `STAFFD cannot currently use the connected ${capability.toLowerCase()} service.`,
    occurredAt: occurredAt.toISOString(),
    urgency: "urgent",
    evidence: [customerFacingProbeError(error)],
    actionLabel: "Repair the connection",
    actionHref: "/dashboard/settings",
  });

  if (!item) throw new Error(`Failed to normalize ${type} integration incident`);
  return item;
}

async function probeConfiguredIntegration(
  user: ResolveUser,
  type: IntegrationType,
): Promise<BusinessInboxItem | null> {
  const credentials = await resolveCredentials(user, type);
  if (!credentials) return null;

  const result = await Promise.race([
    testConnection(type, credentials),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "Connection check timed out" }), PROBE_TIMEOUT_MS),
    ),
  ]);

  return result.ok ? null : integrationIncidentInboxItem(type, result.error);
}

export async function integrationHealthInboxItems(
  user: ResolveUser,
): Promise<BusinessInboxItem[]> {
  const results = await Promise.all(
    INTEGRATION_TYPES.map((type) => probeConfiguredIntegration(user, type).catch(() => null)),
  );

  return results.filter((item): item is BusinessInboxItem => item !== null);
}
