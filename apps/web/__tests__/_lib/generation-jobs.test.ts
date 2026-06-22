/**
 * W95.7.3b — completeJob: charge exactly once at completion (claim-first),
 * charge-on-success-only, idempotent under re-poll, super-admin bypass.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const spendMock = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, remaining: 41 })) }));
const logMock = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/credits", () => ({ spendCredits: spendMock.fn }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: logMock.fn }));
vi.mock("../../app/api/_lib/pb", () => ({ adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }) }));
const notifyMock = vi.hoisted(() => ({ fn: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/notifications/notify", () => ({ notifyUser: notifyMock.fn }));

import { completeJob, type GenJob } from "../../app/api/_lib/generation/jobs";

let patches: { url: string; body: Record<string, unknown> }[];
beforeEach(() => {
  patches = [];
  spendMock.fn.mockClear(); logMock.fn.mockClear(); notifyMock.fn.mockClear();
  spendMock.fn.mockResolvedValue({ ok: true, remaining: 41 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    patches.push({ url: String(url), body: init?.body ? JSON.parse(init.body as string) : {} });
    return { ok: true, status: 200, json: async () => ({}) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const job = (over: Partial<GenJob> = {}): GenJob => ({ id: "job-1", user: "u1", kind: "video", status: "pending", charged: false, ...over });

describe("completeJob (W95.7.3b)", () => {
  it("charges once (claim-first) then marks completed", async () => {
    const r = await completeJob("https://pb.test", "tok", job(), "https://cdn/v.mp4", null);
    expect(r).toMatchObject({ status: "completed", url: "https://cdn/v.mp4", remaining: 41 });
    expect(spendMock.fn).toHaveBeenCalledTimes(1);
    expect(spendMock.fn).toHaveBeenCalledWith("https://pb.test", "u1", "video", 1);
    // claim (charged:true) is written BEFORE the completed/url patch.
    expect(patches[0]!.body).toMatchObject({ charged: true });
    expect(patches.some((p) => (p.body as { status?: string }).status === "completed" && p.body.output_url === "https://cdn/v.mp4")).toBe(true);
  });

  it("notifies the customer (generation.ready) on the newly-completed transition (W95.8)", async () => {
    await completeJob("https://pb.test", "tok", job(), "https://cdn/v.mp4", null);
    expect(notifyMock.fn).toHaveBeenCalledTimes(1);
    expect(notifyMock.fn).toHaveBeenCalledWith("https://pb.test", "tok", "u1", "generation.ready", { kind: "video", url: "https://cdn/v.mp4" });
  });

  it("does NOT notify on the already-completed short-circuit (no duplicate on re-poll)", async () => {
    await completeJob("https://pb.test", "tok", job({ status: "completed", output_url: "https://cdn/old.mp4", charged: true }), "https://cdn/new.mp4", null);
    expect(notifyMock.fn).not.toHaveBeenCalled();
  });

  it("does NOT re-charge a job already charged (idempotent)", async () => {
    const r = await completeJob("https://pb.test", "tok", job({ charged: true }), "https://cdn/v.mp4", null);
    expect(r.status).toBe("completed");
    expect(spendMock.fn).not.toHaveBeenCalled();
    // still writes the completion (url + status) but never a charge claim.
    expect(patches.every((p) => !("charged" in p.body))).toBe(true);
  });

  it("short-circuits an already-completed job (no charge, no write)", async () => {
    const r = await completeJob("https://pb.test", "tok", job({ status: "completed", output_url: "https://cdn/old.mp4", charged: true }), "https://cdn/new.mp4", null);
    expect(r.url).toBe("https://cdn/old.mp4"); // returns stored url
    expect(spendMock.fn).not.toHaveBeenCalled();
    expect(patches).toHaveLength(0);
  });

  it("super-admin bypasses credits and logs usage instead", async () => {
    const r = await completeJob("https://pb.test", "tok", job(), "https://cdn/v.mp4", { id: "admin", email: "a@staffd.com" });
    expect(r.status).toBe("completed");
    expect(spendMock.fn).not.toHaveBeenCalled();
    expect(logMock.fn).toHaveBeenCalledTimes(1);
  });

  it("delivers the result with a creditWarning when the charge fails (out of credits at completion)", async () => {
    spendMock.fn.mockResolvedValue({ ok: false, remaining: 0 });
    const r = await completeJob("https://pb.test", "tok", job(), "https://cdn/v.mp4", null);
    expect(r).toMatchObject({ status: "completed", url: "https://cdn/v.mp4" });
    expect(r.creditWarning).toMatch(/contact support/i);
  });
});
