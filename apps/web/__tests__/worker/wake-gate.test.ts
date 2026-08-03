/**
 * Wake-gates — cron overlap guard + stale reclaim.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildDueFilter, claimScheduledItem, STALE_HOURS } from "../../app/api/_lib/worker/wake-gate";

const NOW = new Date("2026-08-03T12:00:00Z").getTime();

describe("buildDueFilter", () => {
  it("matches due planned rows and stale working rows only", () => {
    const f = buildDueFilter("2026-08-03", NOW);
    expect(f).toContain("status='planned'&&scheduled_date<='2026-08-03'");
    expect(f).toContain("status='working'&&updated<'2026-08-03 10:00:00");
  });
});

describe("claimScheduledItem", () => {
  afterEach(() => vi.unstubAllGlobals());

  const stub = (row: object, patchOk = true) => {
    const calls: Array<{ url: string; method: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET" });
      if (init?.method === "PATCH") return new Response("{}", { status: patchOk ? 200 : 400 });
      return new Response(JSON.stringify(row), { status: 200 });
    }));
    return calls;
  };

  it("claims a planned row (verify → PATCH working)", async () => {
    const calls = stub({ status: "planned", updated: new Date(NOW).toISOString() });
    expect(await claimScheduledItem("https://pb", { Authorization: "t" }, "r1", NOW)).toBe(true);
    expect(calls.some((c) => c.method === "PATCH")).toBe(true);
  });

  it("refuses a row already claimed by another runner", async () => {
    const calls = stub({ status: "working", updated: new Date(NOW - 60_000).toISOString() });
    expect(await claimScheduledItem("https://pb", { Authorization: "t" }, "r1", NOW)).toBe(false);
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
  });

  it("reclaims a stale working row (crashed runner)", async () => {
    const staleMs = NOW - (STALE_HOURS + 1) * 3600_000;
    stub({ status: "working", updated: new Date(staleMs).toISOString() });
    expect(await claimScheduledItem("https://pb", { Authorization: "t" }, "r1", NOW)).toBe(true);
  });

  it("refuses completed/failed rows and fails closed on fetch errors", async () => {
    stub({ status: "completed", updated: new Date(NOW).toISOString() });
    expect(await claimScheduledItem("https://pb", { Authorization: "t" }, "r1", NOW)).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("net"); }));
    expect(await claimScheduledItem("https://pb", { Authorization: "t" }, "r1", NOW)).toBe(false);
  });
});
