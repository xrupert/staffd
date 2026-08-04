import { describe, expect, it } from "vitest";
import {
  STAFF_OUTCOMES,
  outcomeById,
  outcomesForCapabilities,
  type StaffCapability,
} from "./outcome-catalog";

describe("STAFF_OUTCOMES", () => {
  it("keeps every outcome pack-aware without exposing vendors", () => {
    expect(STAFF_OUTCOMES.every((outcome) => outcome.packAware)).toBe(true);

    const customerFacingCopy = STAFF_OUTCOMES.flatMap((outcome) => [
      outcome.title,
      outcome.userPromise,
      outcome.exampleRequest,
    ]).join(" ");

    expect(customerFacingCopy).not.toMatch(
      /twenty|chatwoot|listmonk|plausible|docuseal|postiz|muapi/i,
    );
  });

  it("requires approval for every outbound or destructive outcome", () => {
    const outboundCapabilities = new Set<StaffCapability>([
      "crm.write",
      "support.reply",
      "email.send",
      "signature.send",
      "social.publish",
      "media.produce",
    ]);

    for (const outcome of STAFF_OUTCOMES) {
      const isOutbound = outcome.capabilities.some((capability) =>
        outboundCapabilities.has(capability),
      );

      if (isOutbound) {
        expect(outcome.requiresApproval, outcome.id).toBe(true);
      }
    }
  });
});

describe("outcomeById", () => {
  it("returns the requested outcome", () => {
    expect(outcomeById("produce-viral-video").title).toBe("Produce a viral-ready video");
  });
});

describe("outcomesForCapabilities", () => {
  it("only exposes outcomes that the available harnesses can complete", () => {
    const outcomes = outcomesForCapabilities(
      new Set<StaffCapability>(["support.read", "support.reply"]),
    );

    expect(outcomes.map((outcome) => outcome.id)).toEqual(["clear-support-inbox"]);
  });
});
