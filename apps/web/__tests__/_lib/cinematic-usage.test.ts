/**
 * W95.9.2 — counts this month's cinematic clips from generation_jobs and
 * combines with the pure gate into the state the route + UI consume. Cinematic
 * jobs are kind=video + tier=premium (the premium tier routes to veo3/sora);
 * failed jobs don't count (no charge, no usage).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "admin_tok",
  pbEscape: (s: string) => s,
}));

import { countCinematicThisMonth, getCinematicState } from "../../app/api/_lib/billing/cinematic-usage";

let lastUrl = "";
beforeEach(() => {
  lastUrl = "";
  vi.stubGlobal("fetch", vi.fn(async (input: unknown) => {
    lastUrl = String(input);
    return { ok: true, json: async () => ({ totalItems: 3 }) };
  }));
});
afterEach(() => vi.restoreAllMocks());

describe("countCinematicThisMonth (W95.9.2)", () => {
  it("returns totalItems and filters to this user's premium video since month start", async () => {
    const n = await countCinematicThisMonth("user1", new Date("2026-06-24T00:00:00Z"));
    expect(n).toBe(3);
    const f = decodeURIComponent(lastUrl);
    expect(f).toContain('user = "user1"');
    expect(f).toContain('kind = "video"');
    expect(f).toContain('tier = "premium"');
    expect(f).toContain('created >= "2026-06-01T00:00:00.000Z"');
    expect(f).toContain('status != "failed"');
  });
});

describe("getCinematicState", () => {
  it("combines usage + plan allowance + reset into one consumable", async () => {
    const s = await getCinematicState("user1", "pro", 0, new Date("2026-06-24T00:00:00Z"));
    expect(s.used).toBe(3);
    expect(s.allowance).toBe(24);
    expect(s.remaining).toBe(21);
    expect(s.allowed).toBe(true);
    expect(s.resetsInDays).toBe(7);
  });
});
