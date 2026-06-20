/**
 * W95.7.3d-T1 — tier/weight at the single write surface (createJob, C4) and the
 * single read surface (completeJob): charges credit_weight, idempotent at
 * weight>1, legacy rows default to 1.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const spendMock = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, remaining: 100 })) }));
vi.mock("../../app/api/_lib/credits", () => ({ spendCredits: spendMock.fn }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: vi.fn() }));
vi.mock("../../app/api/_lib/pb", () => ({ adminHeaders: (t: string) => ({ Authorization: t }), pbEscape: (s: string) => s }));

import { createJob, completeJob, type GenJob } from "../../app/api/_lib/generation/jobs";

let writes: { url: string; method: string; body: Record<string, unknown> }[];
beforeEach(() => {
  writes = []; spendMock.fn.mockClear(); spendMock.fn.mockResolvedValue({ ok: true, remaining: 100 });
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    writes.push({ url: String(url), method: init?.method ?? "GET", body: init?.body ? JSON.parse(init.body as string) : {} });
    return { ok: true, status: 200, json: async () => ({ id: "job-1" }) };
  }));
});
afterEach(() => vi.unstubAllGlobals());

const job = (over: Partial<GenJob> = {}): GenJob => ({ id: "job-1", user: "u1", kind: "video", status: "pending", charged: false, ...over });

describe("createJob single-point defaults (W95.7.3d-T1 C4)", () => {
  it("persists tier=quick + credit_weight=1 when none supplied (defaults at WRITE)", async () => {
    await createJob("https://pb.test", "tok", { user: "u1", kind: "image", model: "m", prompt: "p", aspect_ratio: "1:1", prediction_id: "pid" });
    const post = writes.find((w) => w.method === "POST")!;
    expect(post.body.tier).toBe("quick");
    expect(post.body.credit_weight).toBe(1);
  });
  it("persists the supplied tier + weight", async () => {
    await createJob("https://pb.test", "tok", { user: "u1", kind: "video", model: "m", prompt: "p", aspect_ratio: "16:9", prediction_id: "pid", tier: "premium", credit_weight: 60, muapi_model: "veo3.1-image-to-video" });
    const post = writes.find((w) => w.method === "POST")!;
    expect(post.body).toMatchObject({ tier: "premium", credit_weight: 60, muapi_model: "veo3.1-image-to-video" });
  });
});

describe("completeJob charges credit_weight (W95.7.3d-T1)", () => {
  it("charges 60 credits for a Premium video job", async () => {
    await completeJob("https://pb.test", "tok", job({ credit_weight: 60, tier: "premium" }), "https://cdn/v.mp4", null);
    expect(spendMock.fn).toHaveBeenCalledWith("https://pb.test", "u1", "video", 60);
  });
  it("idempotent at weight>1: a second completeJob does NOT re-charge", async () => {
    await completeJob("https://pb.test", "tok", job({ credit_weight: 60, charged: true }), "https://cdn/v.mp4", null);
    expect(spendMock.fn).not.toHaveBeenCalled();
  });
  it("legacy row with no credit_weight defaults to 1 on read (backfill)", async () => {
    await completeJob("https://pb.test", "tok", job({ kind: "image", credit_weight: undefined }), "https://cdn/i.png", null);
    expect(spendMock.fn).toHaveBeenCalledWith("https://pb.test", "u1", "image", 1);
  });
});
