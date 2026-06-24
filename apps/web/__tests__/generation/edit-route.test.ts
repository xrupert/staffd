import { describe, it, expect, vi, beforeEach } from "vitest";

const whoAmI = vi.fn();
const submitPrediction = vi.fn();
const tryExtractOutputUrl = vi.fn();
const createJob = vi.fn();
const completeJob = vi.fn();
const getCreditState = vi.fn();
const trySuperAdminByUserId = vi.fn();

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...a: unknown[]) => whoAmI(...a) }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", () => ({
  submitPrediction: (...a: unknown[]) => submitPrediction(...a),
  tryExtractOutputUrl: (...a: unknown[]) => tryExtractOutputUrl(...a),
  buildWebhookUrl: () => null,
}));
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  createJob: (...a: unknown[]) => createJob(...a),
  completeJob: (...a: unknown[]) => completeJob(...a),
  fingerprintFor: () => "fp",
  findInflightByFingerprint: async () => null,
}));
vi.mock("../../app/api/_lib/credits", () => ({ getCreditState: (...a: unknown[]) => getCreditState(...a) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: (...a: unknown[]) => trySuperAdminByUserId(...a) }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "admin-token" }));
vi.mock("../../app/api/_lib/generation/edit-ops-llm", () => ({ classifyEditLLM: async () => null }));

let routeForEditImpl: ((op: string) => string[]) | null = null;
vi.mock("../../app/api/_lib/generation/routing", async (orig) => {
  const actual = await orig<typeof import("../../app/api/_lib/generation/routing")>();
  return { ...actual, routeForEdit: (op: string) => (routeForEditImpl ?? actual.routeForEdit)(op as never) };
});

import { POST } from "../../app/api/generation/edit/route";

function req(body: unknown) {
  return new Request("http://localhost/api/generation/edit", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "tok" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  routeForEditImpl = null;
  process.env.MUAPI_API_KEY = "k";
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "http://pb";
  whoAmI.mockResolvedValue({ id: "u1", email: "u@x.com" });
  trySuperAdminByUserId.mockResolvedValue(null);
  getCreditState.mockResolvedValue({ totalRemaining: { image: 100, video: 100 }, monthlyAllowance: { image: 100, video: 100 }, plan: "pro" });
  createJob.mockResolvedValue("job1");
  submitPrediction.mockResolvedValue({ id: "pred1" });
  tryExtractOutputUrl.mockReturnValue(null);
});

describe("POST /api/generation/edit", () => {
  it("401 without a session (Standard #39 — identity from token, not body)", async () => {
    whoAmI.mockResolvedValue(null);
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    expect(res.status).toBe(401);
  });

  it("400 when sourceUrl is missing", async () => {
    const res = await POST(req({ kind: "image", instruction: "make it blue" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_required");
  });

  it("image edit: routes instruct_edit slug, image_url+prompt body, weight 0, creates a job", async () => {
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "no background + black outline" }));
    expect(res.status).toBe(202);
    const [slug, body] = submitPrediction.mock.calls[0]!;
    expect(slug).toBe("nano-banana-pro-edit");
    expect(body).toMatchObject({ image_url: "https://x/a.png", prompt: "no background + black outline" });
    expect(createJob).toHaveBeenCalledWith("http://pb", "admin-token", expect.objectContaining({ kind: "image", credit_weight: 0 }));
  });

  it("pure 'no background' → remove_background slug + image_url-only body", async () => {
    await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "remove the background" }));
    const [slug, body] = submitPrediction.mock.calls[0]!;
    expect(slug).toBe("remove-background");
    expect(body).toEqual(expect.objectContaining({ image_url: "https://x/a.png" }));
    expect(body).not.toHaveProperty("prompt");
  });

  it("video edit charges the tier weight (metered) and gates out-of-credits", async () => {
    getCreditState.mockResolvedValue({ totalRemaining: { image: 100, video: 0 }, monthlyAllowance: { image: 100, video: 50 }, plan: "pro" });
    const res = await POST(req({ kind: "video", sourceUrl: "https://x/v.mp4", instruction: "add captions", tier: "pro" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("out_of_credits");
    expect(submitPrediction).not.toHaveBeenCalled();
  });

  it("non-edit text with no resolvable op → 422 not_an_edit (caller falls back to normal routing)", async () => {
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "what is my MRR" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("not_an_edit");
  });

  it("fast path: muapi returns a URL on submit → completed + charged once", async () => {
    tryExtractOutputUrl.mockReturnValue("https://out/edited.png");
    completeJob.mockResolvedValue({ status: "completed", url: "https://out/edited.png", remaining: "unlimited" });
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    const data = await res.json();
    expect(data).toMatchObject({ success: true, status: "completed", url: "https://out/edited.png" });
    expect(completeJob).toHaveBeenCalledTimes(1);
  });

  it("502 when createJob returns null", async () => {
    createJob.mockResolvedValue(null);
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    expect(res.status).toBe(502);
  });

  it("routing_unresolved 500 when no slug resolves for the op", async () => {
    routeForEditImpl = () => [];
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("routing_unresolved");
  });
});
