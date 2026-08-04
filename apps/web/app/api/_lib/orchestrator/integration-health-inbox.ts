import { testConnection } from "../integrations/test-connection";
import {
  INTEGRATION_TYPES,
  resolveCredentials,
  type IntegrationType,
  type ResolveUser,
} from "../integrations/resolve";
import { externalInboxItem } from "./inbox-source-adapters";
import type { BusinessInboxItem } from "./business-inbox";

const DISPLAY_NAME: Record<IntegrationType, string> = {
  twenty: "Sales workspace",
  chatwoot: "Customer support",
  listmonk: "Email marketing",
  plausible: "Website analytics",
  docuseal: "E-signatures",
  postiz: "Social publishing",
};

export type IntegrationHealthResult = {
  type: IntegrationType;
  configured: boolean;
  healthy: boolean;
  error?: string;
};

export function integrationHealthInboxItem(
  result: IntegrationHealthResult,
  occurredAt = new Date(),
): BusinessInboxItem | null {
  if (!result.configured || result.healthy) return null;
  const label = DISPLAY_NAME[result.type];
  return externalInboxItem({
    provider: result.type,
    sourceId: `health:${result.type}`,
    kind: "integration_incident",
    title: `${label} needs reconnection`,
    summary: `STAFFD cannot currently use the connected ${label.toLowerCase()} service.`,
    occurredAt: occurredAt.toISOString(),
    urgency: "important",
    evidence: result.error ? [result.error.slice(0, 160)] : ["The connection health check failed"],
    actionLabel: "Repair the connection",
    actionHref: "/dashboard/settings?tab=integrations",
  });
}

async function probeIntegration(user: ResolveUser, type: IntegrationType): Promise<IntegrationHealthResult> {
  const credentials = await resolveCredentials(user, type);
  if (!credentials) return { type, configured: false, healthy: false };
  const result = await testConnection(type, credentials);
  return { type, configured: true, healthy: result.ok, error: result.error };
}

export async function integrationHealthInboxItems(user: ResolveUser): Promise<BusinessInboxItem[]> {
  const results = await Promise.all(
    INTEGRATION_TYPES.map((type) => probeIntegration(user, type).catch(() => ({
      type,
      configured: true,
      healthy: false,
      error: "Connection health check failed",
    }))),
  );

  return results
    .map((result) => integrationHealthInboxItem(result))
    .filter((item): item is BusinessInboxItem => item !== null);
}
