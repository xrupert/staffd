/**
 * W95.7.3b — GET /api/generation/[id]/status: owner-scoped poll that drives the
 * async generation to completion (one Muapi check per poll), charges once on
 * completion, idempotent on re-poll, and surfaces failures.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async (req: Request) => (req.headers.get("authorization") ? { id: "u1", email: "a@cust.com" } : null) }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "tok", pbUrl: () => "https://pb.test", adminHeaders: (t: string) => ({ Authorization: t, "Content-Type": "application/json" }) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: async () => null }));

const check = vi.hoisted(() => ({ fn: vi.fn() }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", () => ({ checkPrediction: check.fn }));
const spendMock = vi.hoisted(() => ({ fn: vi.fn(async () => ({ ok: true, remaining: 7 })) }));
vi.mock("../../app/api/_lib/credits", () => ({ spendCredits: spendMock.fn }));
vi.mock("../../app/api/_lib/auth/super-admin-logging", () => ({ logSuperAdminUsage: async () => undefined }));

import { GET } from "../../app/api/generation/[id]/status/route";

// In-memory job store the stubbed PB fetch reads/writes.
let jobRow: Record<string, unknown> | null;
const patchBodies: Record<string, unknown>[] = [];
function stubFetch() {
  patchBodies.length = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (url.includes("/generation_jobs/records/")) {
      if (method === "PATCH") { const b = JSON.parse(init!.body as string); patchBodies.push(b); jobRow = { ...jobRow, ...b }; return { ok: true, json: async () => ({}) }; }
      return jobRow ? { ok: true, json: async () => jobRow } : { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => ({}) };
  }));
}

const req = (auth = true) => new Request("https://t/api/generation/job-1/status", auth ? { headers: { authorization: "tok" } } : undefined);
const ctx = { params: Promise.resolve({ id: "job-1" }) };

beforeEach(() => { spendMock.fn.mockClear(); spendMock.fn.mockResolvedValue({ ok: true, remaining: 7 }); check.fn.mockReset(); stubFetch(); });
afterEach(() => vi.unstubAllGlobals());

describe("GET /api/generation/[id]/status (W95.7.3b)", () => {
  it("401 without auth", async () => {
    jobRow = { id: "job-1", user: "u1", status: "pending" };
    expect((await GET(req(false), ctx)).status).toBe(401);
  });

  it("404 for another user's job (owner-scoped)", async () => {
    jobRow = { id: "job-1", user: "someone-else", status: "pending" };
    expect((await GET(req(), ctx)).status).toBe(404);
  });

  it("pending Muapi → returns pending, no charge", async () => {
    jobRow = { id: "job-1", user: "u1", kind: "video", status: "pending", prediction_id: "p1", charged: false };
    check.fn.mockResolvedValue({ state: "pending" });
    const d = await (await GET(req(), ctx)).json();
    expect(d.status).toBe("pending");
    expect(spendMock.fn).not.toHaveBeenCalled();
  });

  it("completed Muapi → writes url, charges once, returns completed", async () => {
    jobRow = { id: "job-1", user: "u1", kind: "video", status: "pending", prediction_id: "p1", charged: false };
    check.fn.mockResolvedValue({ state: "completed", url: "https://cdn/v.mp4" });
    const d = await (await GET(req(), ctx)).json();
    expect(d).toMatchObject({ status: "completed", url: "https://cdn/v.mp4" });
    expect(spendMock.fn).toHaveBeenCalledTimes(1);
  });

  it("re-poll after completion is idempotent (no second charge)", async () => {
    jobRow = { id: "job-1", user: "u1", kind: "video", status: "completed", output_url: "https://cdn/v.mp4", charged: true };
    const d = await (await GET(req(), ctx)).json();
    expect(d).toMatchObject({ status: "completed", url: "https://cdn/v.mp4" });
    expect(check.fn).not.toHaveBeenCalled(); // terminal → no Muapi call
    expect(spendMock.fn).not.toHaveBeenCalled();
  });

  it("failed Muapi → marks failed, no charge", async () => {
    jobRow = { id: "job-1", user: "u1", kind: "video", status: "pending", prediction_id: "p1", charged: false };
    check.fn.mockResolvedValue({ state: "failed", error: "model error" });
    const d = await (await GET(req(), ctx)).json();
    expect(d).toMatchObject({ status: "failed", error: "model error" });
    expect(spendMock.fn).not.toHaveBeenCalled();
    expect(patchBodies.some((b) => b.status === "failed")).toBe(true);
  });
});
