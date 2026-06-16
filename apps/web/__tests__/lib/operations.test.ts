/**
 * W80.1 — Operations Home pure helpers (runtime tests).
 */

import { describe, it, expect } from "vitest";
import {
  summarizeEmail,
  summarizePipeline,
  summarizeInbox,
  summarizeAnalytics,
  buildSpecialistPrompt,
} from "../../lib/operations";

describe("Operations summaries", () => {
  it("email — none / some", () => {
    expect(summarizeEmail(null)).toBe("No campaigns yet.");
    expect(summarizeEmail({ campaigns: [{ name: "June blast", sent: 1000 }] })).toContain("June blast");
    expect(summarizeEmail({ campaigns: [{ name: "A", sent: 1 }, { name: "B", sent: 2 }] })).toContain("2 campaigns");
  });

  it("pipeline — none / singular / plural", () => {
    expect(summarizePipeline({ results: [] })).toBe("No open opportunities.");
    expect(summarizePipeline({ results: [{ name: "Acme" }] })).toBe("1 open opportunity.");
    expect(summarizePipeline({ results: [{ name: "A" }, { name: "B" }] })).toBe("2 open opportunities.");
  });

  it("inbox — clear / some", () => {
    expect(summarizeInbox({ conversations: [] })).toContain("clear");
    expect(summarizeInbox({ conversations: [{}, {}, {}] })).toBe("3 open tickets.");
  });

  it("analytics — null / values", () => {
    expect(summarizeAnalytics(null)).toBe("No analytics yet.");
    expect(summarizeAnalytics({ visitors: 312, pageviews: 1045 })).toContain("312 visitors");
  });
});

describe("buildSpecialistPrompt", () => {
  it("produces a card-appropriate, summary-embedding prompt for each card", () => {
    expect(buildSpecialistPrompt("email", "2 campaigns")).toMatch(/email campaign/i);
    expect(buildSpecialistPrompt("pipeline", "3 open")).toMatch(/pipeline/i);
    expect(buildSpecialistPrompt("inbox", "1 open ticket")).toMatch(/support inbox/i);
    expect(buildSpecialistPrompt("analytics", "10 visitors")).toMatch(/traffic/i);
    // Embeds the live summary so the specialist gets real context.
    expect(buildSpecialistPrompt("pipeline", "3 open opportunities.")).toContain("3 open opportunities.");
  });

  it("handles an empty summary gracefully", () => {
    expect(buildSpecialistPrompt("email", "")).toContain("(no data yet)");
  });
});
