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
  campaignStatusLabel,
  buildCampaignSmartPrompt,
  analyticsRangeLabel,
  formatVisitDuration,
  buildAnalyticsSmartPrompt,
  type AnalyticsView,
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

describe("campaign helpers (W80.2)", () => {
  it("campaignStatusLabel maps to user-facing terms (no vendor jargon)", () => {
    expect(campaignStatusLabel("finished")).toBe("Sent");
    expect(campaignStatusLabel("running")).toBe("Sending");
    expect(campaignStatusLabel("scheduled")).toBe("Scheduled");
    expect(campaignStatusLabel(null)).toBe("Draft");
    expect(campaignStatusLabel("weird")).toBe("Draft");
  });

  it("buildCampaignSmartPrompt embeds subject + body for the specialist", () => {
    const p = buildCampaignSmartPrompt("Big sale", "Body copy here");
    expect(p).toContain("Big sale");
    expect(p).toContain("Body copy here");
    expect(p).toMatch(/subject line/i);
  });

  it("buildCampaignSmartPrompt handles an empty draft", () => {
    expect(buildCampaignSmartPrompt("", "")).toContain("(no subject yet)");
  });
});

describe("analytics helpers (W80.3)", () => {
  it("analyticsRangeLabel maps the three ranges to operator-friendly labels", () => {
    expect(analyticsRangeLabel("day")).toBe("Today");
    expect(analyticsRangeLabel("7d")).toBe("Last 7 days");
    expect(analyticsRangeLabel("30d")).toBe("Last 30 days");
  });

  it("formatVisitDuration renders seconds as Xm Ys (or just seconds under a minute)", () => {
    expect(formatVisitDuration(0)).toBe("0s");
    expect(formatVisitDuration(45)).toBe("45s");
    expect(formatVisitDuration(125)).toBe("2m 5s");
    expect(formatVisitDuration(120)).toBe("2m 0s");
  });

  const view: AnalyticsView = {
    range: "7d",
    headline: { visitors: 312, pageviews: 1045, bounceRate: 48, visitDuration: 125 },
    sources: [{ name: "Google", visitors: 180 }, { name: "Direct", visitors: 90 }],
    pages: [{ name: "/", pageviews: 600 }, { name: "/pricing", pageviews: 200 }],
    countries: [{ name: "United States", visitors: 210 }],
    timeseries: [{ date: "2026-06-10", visitors: 40 }, { date: "2026-06-11", visitors: 52 }],
  };

  it("buildAnalyticsSmartPrompt embeds the range, headline metrics, and top breakdown for the specialist", () => {
    const p = buildAnalyticsSmartPrompt(view);
    expect(p).toContain("Last 7 days");
    expect(p).toContain("312");        // visitors
    expect(p).toContain("Google");     // top source
    expect(p).toMatch(/anomal/i);      // asks for anomaly detection
    expect(p).toMatch(/next/i);        // asks for next moves
  });

  it("buildAnalyticsSmartPrompt handles an empty view gracefully", () => {
    const empty: AnalyticsView = {
      range: "day",
      headline: { visitors: 0, pageviews: 0, bounceRate: 0, visitDuration: 0 },
      sources: [], pages: [], countries: [], timeseries: [],
    };
    expect(buildAnalyticsSmartPrompt(empty)).toContain("Today");
  });
});
