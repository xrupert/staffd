/**
 * W95.7.3b — POST /api/integrations/muapi is now ASYNC: it submits + creates a
 * generation_jobs row and returns immediately (202 + jobId) instead of holding
 * the connection open for a 60s server poll. Fast-path (URL on submit) charges
 * + returns completed. Out-of-credits pre-flight still 402s.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ESM hoists imports above top-level statements, and the route reads MUAPI_KEY
// at module load — so set env in vi.hoisted (runs before any import).
vi.hoisted(() => {
  process.env.MUAPI_API_KEY = "test_key";
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
});

vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: async () => ({ content: [{ type: "text", text: "enriched dense prompt that is long enough to pass" }] }) }; } }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: async () => null }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "tok" }));

const credit = vi.hoisted(() => ({ remaining: 5 }));
vi.mock("../../app/api/_lib/credits", () => ({
  getCreditState: async () => ({ totalRemaining: { image: credit.remaining, video: credit.remaining }, monthlyAllowance: { image: 10, video: 10 }, plan: "growth" }),
}));

const sub = vi.hoisted(() => ({ result: { id: "p1" } as Record<string, unknown> }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", async () => {
  const actual = await vi.importActual<typeof import("../../app/api/_lib/integrations/muapi/predictions")>("../../app/api/_lib/integrations/muapi/predictions");
  return { ...actual, submitPrediction: async () => sub.result }; // keep real tryExtractOutputUrl
});

const jobs = vi.hoisted(() => ({ created: "job-1" as string | null, dupId: null as string | null, createFn: vi.fn(async () => jobs.created), completeFn: vi.fn(async () => ({ status: "completed", url: "https://cdn/i.png", remaining: 4 })) }));
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  createJob: jobs.createFn,
  completeJob: jobs.completeFn,
  fingerprintFor: () => "fp-test",
  findInflightByFingerprint: async () => jobs.dupId,
}));

import { POST } from "../../app/api/integrations/muapi/route";

const post = (body: object) => POST(new Request("https://t/api/integrations/muapi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => { credit.remaining = 5; sub.result = { id: "p1" }; jobs.created = "job-1"; jobs.dupId = null; jobs.createFn.mockClear(); jobs.completeFn.mockClear(); });
afterEach(() => vi.restoreAllMocks());

describe("POST /api/integrations/muapi (W95.7.3b async)", () => {
  it("no immediate URL → 202 pending + jobId, NO charge", async () => {
    const res = await post({ userId: "u1", kind: "video", prompt: "a dog running through a field at dawn" });
    expect(res.status).toBe(202);
    const d = await res.json();
    expect(d).toMatchObject({ success: true, jobId: "job-1", status: "pending" });
    expect(jobs.completeFn).not.toHaveBeenCalled();
  });

  it("fast path — URL on submit → completes + charges immediately", async () => {
    sub.result = { id: "p1", outputs: ["https://cdn/i.png"] };
    const res = await post({ userId: "u1", kind: "image", prompt: "a red apple" });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({ success: true, jobId: "job-1", status: "completed", url: "https://cdn/i.png" });
    expect(jobs.completeFn).toHaveBeenCalledTimes(1);
  });

  it("out of credits → 402 before submitting", async () => {
    credit.remaining = 0;
    const res = await post({ userId: "u1", kind: "video", prompt: "x" });
    expect(res.status).toBe(402);
    expect(jobs.completeFn).not.toHaveBeenCalled();
  });

  it("missing prompt → 400", async () => {
    expect((await post({ userId: "u1", kind: "video" })).status).toBe(400);
  });

  it("dedup — an in-flight duplicate returns the existing jobId without a new submit/job (W95.7.3c-b1)", async () => {
    jobs.dupId = "job-existing";
    const res = await post({ userId: "u1", kind: "video", prompt: "a dog running through a field at dawn" });
    expect(res.status).toBe(202);
    const d = await res.json();
    expect(d).toMatchObject({ jobId: "job-existing", status: "pending", deduped: true });
    expect(jobs.createFn).not.toHaveBeenCalled(); // no duplicate Muapi submit / job row
  });
});
