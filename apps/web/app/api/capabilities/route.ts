import { whoAmI } from "../_lib/integrations/identity";
import {
  INTEGRATION_TYPES,
  resolveCredentials,
  type IntegrationType,
} from "../_lib/integrations/resolve";
import { testConnection } from "../_lib/integrations/test-connection";
import {
  capabilityHealthFromProbes,
  readyCapabilities,
  type IntegrationProbe,
} from "../_lib/orchestrator/capability-health";

const PROBE_TIMEOUT_MS = 3_500;

async function probeIntegration(
  user: { id: string; email?: string },
  type: IntegrationType,
): Promise<IntegrationProbe> {
  const credentials = await resolveCredentials(user, type);
  if (!credentials) return { type, configured: false, healthy: false };

  const result = await Promise.race([
    testConnection(type, credentials),
    new Promise<{ ok: false; error: string }>((resolve) =>
      setTimeout(() => resolve({ ok: false, error: "probe timed out" }), PROBE_TIMEOUT_MS),
    ),
  ]);

  return { type, configured: true, healthy: result.ok };
}

export async function GET(request: Request) {
  const user = await whoAmI(request);
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });

  const probes = await Promise.all(
    INTEGRATION_TYPES.map((type) => probeIntegration(user, type)),
  );
  const health = capabilityHealthFromProbes(probes, {
    mediaProductionReady: Boolean(
      (process.env.MONTAGE_URL && process.env.MONTAGE_API_KEY) || process.env.MUAPI_API_KEY,
    ),
    socialPublishingEnabled: process.env.PUBLISH_ENABLED === "true",
  });

  return Response.json({
    capabilities: health,
    readyCapabilities: readyCapabilities(health),
    checkedAt: new Date().toISOString(),
  });
}
