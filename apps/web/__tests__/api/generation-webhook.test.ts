/**
 * W95.7.3c-b1 — POST /api/generation/webhook: token-gated Muapi completion
 * callback. 401 on bad token; on valid token it pulls the authoritative result
 * and runs the claim-first charge (completeJob), idempotent for terminal jobs.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.hoisted(() => { process.env.MUAPI_WEBHOOK_SECRET = "whsec_test_abc"; process.env.MUAPI_API_KEY = "k"; });

vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "tok", pbUrl: () => "https://pb.test", adminHeaders: (t: string) => ({ Authorization: t }) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: async () => null }));

const check = vi.hoisted(() => ({ fn: vi.fn() }));
const jobs = vi.hoisted(() => ({ byPred: null as Record<string, unknown> | null, complete: vi.fn(async () => ({ status: "completed", url: "u", remaining: 3 })), fail: vi.fn(async () => undefined) }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", async () => {
  const actual = await vi.importActual<typeof import("../../app/api/_lib/integrations/muapi/predictions")>("../../app/api/_lib/integrations/muapi/predictions");
  return { ...actual, checkPrediction: check.fn }; // keep real verifyWebhookToken / muapiWebhookToken
});
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  getJobByPrediction: async () => jobs.byPred,
  completeJob: jobs.complete,
  failJob: jobs.fail,
}));

import { POST } from "../../app/api/generation/webhook/route";
import { muapiWebhookToken } from "../../app/api/_lib/integrations/muapi/predictions";

const TOKEN = muapiWebhookToken();
const hook = (token: string, body: object) =>
  POST(new Request(`https://t/api/generation/webhook?token=${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => { check.fn.mockReset(); jobs.complete.mockClear(); jobs.fail.mockClear(); jobs.byPred = { id: "job-1", user: "u1", status: "pending", prediction_id: "p1" }; });
afterEach(() => vi.restoreAllMocks());

describe("POST /api/generation/webhook (W95.7.3c-b1)", () => {
  it("401 on an invalid token (no charge)", async () => {
    const res = await hook("badtoken", { request_id: "p1" });
    expect(res.status).toBe(401);
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it("valid token + completed prediction → completeJob (claim-first charge)", async () => {
    check.fn.mockResolvedValue({ state: "completed", url: "https://cdn/v.mp4" });
    const res = await hook(TOKEN, { request_id: "p1" });
    expect(res.status).toBe(200);
    expect(jobs.complete).toHaveBeenCalledTimes(1);
  });

  it("valid token + failed prediction → failJob, no charge", async () => {
    check.fn.mockResolvedValue({ state: "failed", error: "boom" });
    const res = await hook(TOKEN, { request_id: "p1" });
    expect(res.status).toBe(200);
    expect(jobs.fail).toHaveBeenCalledTimes(1);
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it("idempotent — a terminal job is acked without re-charging or re-checking", async () => {
    jobs.byPred = { id: "job-1", user: "u1", status: "completed", prediction_id: "p1", output_url: "u" };
    const res = await hook(TOKEN, { request_id: "p1" });
    expect(res.status).toBe(200);
    expect(check.fn).not.toHaveBeenCalled();
    expect(jobs.complete).not.toHaveBeenCalled();
  });

  it("unknown job → 200 ack (so Muapi stops retrying)", async () => {
    jobs.byPred = null;
    const res = await hook(TOKEN, { request_id: "p1" });
    expect(res.status).toBe(200);
    expect(check.fn).not.toHaveBeenCalled();
  });

  it("no prediction id in payload → 200 ack", async () => {
    const res = await hook(TOKEN, {});
    expect(res.status).toBe(200);
  });
});
