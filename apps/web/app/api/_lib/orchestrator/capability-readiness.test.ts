import { describe, expect, it } from "vitest";
import { outcomeById } from "./outcome-catalog";
import { assessOutcomeReadiness, rankOutcomesByReadiness } from "./capability-readiness";

describe("assessOutcomeReadiness", () => {
  it("blocks an outcome when a required capability is missing", () => {
    const result = assessOutcomeReadiness(outcomeById("clear-support-inbox"), [
      { capability: "support.read", state: "ready" },
    ]);

    expect(result.state).toBe("missing");
    expect(result.canStart).toBe(false);
    expect(result.missingCapabilities).toEqual(["support.reply"]);
  });

  it("allows degraded capabilities while exposing the risk", () => {
    const result = assessOutcomeReadiness(outcomeById("clear-support-inbox"), [
      { capability: "support.read", state: "ready" },
      { capability: "support.reply", state: "degraded", reason: "Retrying connection" },
    ]);

    expect(result.state).toBe("degraded");
    expect(result.canStart).toBe(true);
    expect(result.degradedCapabilities).toEqual(["support.reply"]);
  });
});

describe("rankOutcomesByReadiness", () => {
  it("places ready missions before degraded and missing missions", () => {
    const ranked = rankOutcomesByReadiness(
      [outcomeById("clear-support-inbox"), outcomeById("send-document-for-signature")],
      [
        { capability: "support.read", state: "ready" },
        { capability: "support.reply", state: "ready" },
        { capability: "crm.read", state: "degraded" },
      ],
    );

    expect(ranked.map((entry) => entry.outcome.id)).toEqual([
      "clear-support-inbox",
      "send-document-for-signature",
    ]);
  });
});
