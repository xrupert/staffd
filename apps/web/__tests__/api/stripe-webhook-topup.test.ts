/**
 * W47 — Stripe webhook top-up routing + idempotency tests (Tests 3–7).
 *
 * Covers:
 *   - New-shape events route by metadata.topup_type to addTopupCredits
 *     with the right kind and count (image + video).
 *   - Legacy-shape events (staffd_topup_pack, no topup_type) mint image
 *     credits via the [W47-legacy] shim.
 *   - Unknown metadata shapes mint nothing, log an error, return 200.
 *   - Duplicate event ids (Stripe re-delivery) are ignored via the
 *     stripe_events ledger — credits mint exactly once.
 *
 * Stripe SDK signature verification and the credits lib are stubbed;
 * PocketBase is a stateful in-memory fetch mock.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("stripe", () => ({
  default: class StripeMock {
    webhooks = {
      // Signature verification stub — tests pass crafted events as JSON body.
      constructEvent: (body: string) => JSON.parse(body),
    };
  },
}));

const creditsMocks = vi.hoisted(() => ({
  addTopupCredits: vi.fn(async () => true),
}));
vi.mock("../../app/api/_lib/credits", () => ({
  addTopupCredits: creditsMocks.addTopupCredits,
}));

const PB_URL = "https://pb.example.test";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
process.env.STRIPE_SECRET_KEY = "sk_test_stub";
process.env.NEXT_PUBLIC_POCKETBASE_URL = PB_URL;
process.env.PB_ADMIN_EMAIL = "admin@test";
process.env.PB_ADMIN_PASSWORD = "pw";

import { POST } from "../../app/api/stripe/webhook/route";

// Stateful PB mock — tracks the stripe_events ledger and every PATCH body.
let processedEventIds: Set<string>;
let patchBodies: string[];

function installPbFetchMock() {
  processedEventIds = new Set();
  patchBodies = [];
  vi.stubGlobal("fetch", vi.fn(async (input: unknown, init?: { method?: string; body?: string }) => {
    const url = String(input);
    const method = init?.method ?? "GET";

    if (url.includes("/auth-with-password")) {
      return { ok: true, json: async () => ({ token: "admin_tok" }) };
    }
    if (url.includes("/collections/stripe_events/records") && method === "GET") {
      const idMatch = /event_id='([^']+)'/.exec(decodeURIComponent(url));
      const eventId = idMatch?.[1] ?? "";
      return {
        ok: true,
        json: async () => ({ items: processedEventIds.has(eventId) ? [{ id: "rec_1" }] : [] }),
      };
    }
    if (url.includes("/collections/stripe_events/records") && method === "POST") {
      const body = JSON.parse(init?.body ?? "{}") as { event_id?: string };
      if (body.event_id) processedEventIds.add(body.event_id);
      return { ok: true, json: async () => ({ id: "rec_new" }) };
    }
    if (method === "PATCH") {
      patchBodies.push(init?.body ?? "");
      return { ok: true, json: async () => ({}) };
    }
    // Any other PB read — empty list.
    return { ok: true, json: async () => ({ items: [] }) };
  }));
}

function webhookRequest(event: Record<string, unknown>): Request {
  return new Request("https://test.local/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": "sig_test" },
    body: JSON.stringify(event),
  });
}

function topupEvent(eventId: string, metadata: Record<string, string>) {
  return {
    id: eventId,
    type: "checkout.session.completed",
    data: { object: { id: "cs_test_1", mode: "payment", customer: "cus_1", metadata } },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  installPbFetchMock();
});

describe("stripe webhook — W47 top-up routing", () => {
  it("routes new-shape image top-up to addTopupCredits('image', 150) (Test 3)", async () => {
    const res = await POST(webhookRequest(topupEvent("evt_img_1", {
      staffd_user_id: "uid",
      staffd_topup_pack: "topup-img-150",
      topup_type: "image",
      credit_count: "150",
    })));

    expect(res.status).toBe(200);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledTimes(1);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledWith(PB_URL, "uid", "image", 150);
    // agent_credits_topup is never written by the webhook path.
    expect(patchBodies.join("\n")).not.toContain("agent_credits_topup");
  });

  it("routes new-shape video top-up to addTopupCredits('video', 25) (Test 4)", async () => {
    const res = await POST(webhookRequest(topupEvent("evt_vid_1", {
      staffd_user_id: "uid",
      staffd_topup_pack: "topup-vid-25",
      topup_type: "video",
      credit_count: "25",
    })));

    expect(res.status).toBe(200);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledTimes(1);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledWith(PB_URL, "uid", "video", 25);
    expect(patchBodies.join("\n")).not.toContain("agent_credits_topup");
  });

  it("legacy shape (pack + credits, no type) mints image credits with [W47-legacy] log (Test 5)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await POST(webhookRequest(topupEvent("evt_legacy_1", {
      staffd_user_id: "uid",
      staffd_topup_pack: "topup-1000",
      staffd_topup_credits: "1000",
    })));

    expect(res.status).toBe(200);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledTimes(1);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledWith(PB_URL, "uid", "image", 1000);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("[W47-legacy]");
    logSpy.mockRestore();
  });

  it("unknown metadata shape mints nothing, logs error, still returns 200 (Test 6)", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await POST(webhookRequest(topupEvent("evt_unknown_1", {
      staffd_user_id: "uid",
    })));

    expect(res.status).toBe(200);
    expect(creditsMocks.addTopupCredits).not.toHaveBeenCalled();
    expect(errSpy.mock.calls.flat().join("\n")).toContain("unknown topup metadata shape");
    errSpy.mockRestore();
  });

  it("duplicate event id is ignored — credits mint exactly once (Test 7)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const event = topupEvent("evt_test_123", {
      staffd_user_id: "uid",
      staffd_topup_pack: "topup-img-50",
      topup_type: "image",
      credit_count: "50",
    });

    const first = await POST(webhookRequest(event));
    expect(first.status).toBe(200);
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledTimes(1);
    expect(processedEventIds.has("evt_test_123")).toBe(true);

    const second = await POST(webhookRequest(event));
    expect(second.status).toBe(200);
    // No second mint.
    expect(creditsMocks.addTopupCredits).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("duplicate event ignored event_id=evt_test_123");
    logSpy.mockRestore();
  });
});
