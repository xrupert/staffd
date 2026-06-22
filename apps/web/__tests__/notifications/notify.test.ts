/**
 * W95.8 — notifyUser persists a customer notification row. It is BEST-EFFORT:
 * a failure (or a non-customer event) must never break the producing flow
 * (e.g. completing a generation), so it swallows everything and returns void.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/pb", () => ({ adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }) }));

import { notifyUser } from "../../app/api/_lib/notifications/notify";

let calls: { url: string; body: Record<string, unknown> }[];
function stub(ok = true, throws = false) {
  calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    if (throws) throw new Error("network down");
    calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : {} });
    return { ok, status: ok ? 200 : 500, json: async () => ({ id: "n1" }) };
  }));
}
afterEach(() => vi.unstubAllGlobals());

describe("notifyUser", () => {
  beforeEach(() => stub());

  it("writes a notifications row with the rendered + typed fields", async () => {
    await notifyUser("https://pb.test", "tok", "u1", "generation.ready", { kind: "video", url: "https://cdn/v.mp4" });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/api/collections/notifications/records");
    expect(calls[0]!.body).toMatchObject({
      user: "u1", type: "generation.ready", title: "Your video is ready",
      href: "https://cdn/v.mp4", severity: "success", read: false,
    });
  });

  it("no userId → no write (leak-guard)", async () => {
    await notifyUser("https://pb.test", "tok", "", "generation.ready", { kind: "image" });
    expect(calls).toHaveLength(0);
  });

  it("never throws when PB is unreachable (best-effort, protects the caller)", async () => {
    stub(true, true);
    await expect(notifyUser("https://pb.test", "tok", "u1", "generation.ready", { kind: "image", url: "u" })).resolves.toBeUndefined();
  });
});
