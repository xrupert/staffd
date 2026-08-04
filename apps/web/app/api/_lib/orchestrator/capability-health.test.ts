import { describe, expect, it } from "vitest";
import { capabilityHealthFromProbes, readyCapabilities } from "./capability-health";

describe("capabilityHealthFromProbes", () => {
  it("maps healthy integrations to customer-facing capabilities", () => {
    const health = capabilityHealthFromProbes(
      [
        { type: "twenty", configured: true, healthy: true },
        { type: "chatwoot", configured: true, healthy: false },
        { type: "listmonk", configured: false, healthy: false },
        { type: "plausible", configured: true, healthy: true },
        { type: "docuseal", configured: true, healthy: true },
        { type: "postiz", configured: true, healthy: true },
      ],
      { mediaProductionReady: true, socialPublishingEnabled: false },
    );

    expect(readyCapabilities(health)).toEqual([
      "analytics.read",
      "crm.read",
      "crm.write",
      "media.produce",
      "signature.send",
    ]);
    expect(health.find((item) => item.capability === "support.read")?.state).toBe("degraded");
    expect(health.find((item) => item.capability === "email.send")?.state).toBe("missing");
    expect(health.find((item) => item.capability === "social.publish")?.state).toBe("missing");
  });

  it("does not expose provider names in customer-facing messages", () => {
    const health = capabilityHealthFromProbes(
      [
        { type: "twenty", configured: false, healthy: false },
        { type: "chatwoot", configured: false, healthy: false },
        { type: "listmonk", configured: false, healthy: false },
        { type: "plausible", configured: false, healthy: false },
        { type: "docuseal", configured: false, healthy: false },
        { type: "postiz", configured: false, healthy: false },
      ],
      { mediaProductionReady: false, socialPublishingEnabled: false },
    );

    expect(health.map((item) => `${item.label} ${item.message}`).join(" ")).not.toMatch(
      /twenty|chatwoot|listmonk|plausible|docuseal|postiz/i,
    );
  });
});
