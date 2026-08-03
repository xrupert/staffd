/**
 * P3 — campaign runner: cadence dating + route guards.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => ({ id: "u1", email: "x@y.z" }) }));
vi.mock("../../app/api/_lib/pb", () => ({
  pbUrl: () => "https://pb.test",
  getAdminToken: async () => "tok",
  adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }),
  pbEscape: (s: string) => s,
}));

import { POST, nextCadenceDates } from "../../app/api/campaign/schedule/route";

describe("nextCadenceDates", () => {
  it("lands only on Mon/Wed/Fri, starting after the from-date", () => {
    // 2026-08-03 is a Monday.
    const dates = nextCadenceDates(4, [1, 3, 5], new Date("2026-08-03T12:00:00Z"));
    expect(dates).toEqual(["2026-08-05", "2026-08-07", "2026-08-10", "2026-08-12"]);
  });
});

describe("POST /api/campaign/schedule", () => {
  const req = (body: object) =>
    new Request("https://t/api/campaign/schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "tok" },
      body: JSON.stringify(body),
    });

  it("422 when the plan has fewer than 2 scripted videos", async () => {
    const res = await POST(req({ plan: "A long strategy document with plenty of prose but no video scripts at all in it." }));
    expect(res.status).toBe(422);
  });

  it("schedules one item per producible video and reports camera-facing skips", async () => {
    const writes: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init?: RequestInit) => {
      writes.push(JSON.parse(String(init?.body ?? "{}")));
      return new Response(JSON.stringify({ id: "sc1" }), { status: 200 });
    }));
    const plan = `Video 1 — Anchor 🎬 | 30 seconds\n\nHook (0–3s): "Filmed by you."\n\nVideo 2 — Screen demo 📱 | 30 seconds\n\nHook (0–3s): On-screen: Watch this.\n\nVideo 3 — Text motion 📱 | 20 seconds\n\nHook (0–3s): On-screen: Big claim.`;
    const res = await POST(req({ plan, startDate: "2026-08-03" }));
    const d = await res.json();
    vi.unstubAllGlobals();
    expect(res.status).toBe(200);
    expect(d.scheduled.length).toBe(2); // two producible
    expect(d.camera_facing_skipped).toBe(1);
    expect(writes.every((w) => w.kind === "video_production" && w.status === "planned")).toBe(true);
    expect(writes[0]?.scheduled_date).toBe("2026-08-05");
  });
});
