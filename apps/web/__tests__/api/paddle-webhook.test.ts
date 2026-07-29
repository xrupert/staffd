/**
 * PR-Paddle-A — /api/webhooks/paddle contract:
 *   fail-closed 503 without the secret · 401 on bad signature ·
 *   event-id dedup via billing_events · plan/add-on sync semantics
 *   mirroring the deleted Stripe webhook · Cinema-pack clip top-ups.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => ({
  event: null as null | { eventId: string; eventType: string; data: unknown },
  unmarshalThrows: false,
  duplicateInsert: false,
  subRow: null as null | Record<string, unknown>,
  calls: [] as Array<{ method: string; url: string; body?: unknown }>,
}));

vi.mock("@paddle/paddle-node-sdk", () => ({
  Environment: { production: "production", sandbox: "sandbox" },
  Paddle: class {
    webhooks = {
      unmarshal: async () => {
        if (state.unmarshalThrows) throw new Error("bad signature");
        return state.event;
      },
    };
  },
}));

vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-tok",
  pbUrl: () => "https://pb.test",
  pbEscape: (s: string) => s.replace(/'/g, "\\'"),
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));

import { POST } from "../../app/api/webhooks/paddle/route";

function mockFetch() {
  vi.stubGlobal("fetch", vi.fn(async (url: string | URL, init?: RequestInit) => {
    const u = String(url);
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    state.calls.push({ method, url: u, body });

    if (u.includes("/billing_events/records") && method === "POST") {
      return state.duplicateInsert
        ? new Response(JSON.stringify({ code: 400 }), { status: 400 })
        : new Response(JSON.stringify({ id: "evt-row" }), { status: 200 });
    }
    if (u.includes("/subscriptions/records?") && method === "GET") {
      return new Response(JSON.stringify({ items: state.subRow ? [state.subRow] : [] }), { status: 200 });
    }
    if (u.includes("/subscriptions/records/") && method === "PATCH") {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    if (u.includes("/subscriptions/records") && method === "POST") {
      return new Response(JSON.stringify({ id: "new-row" }), { status: 200 });
    }
    return new Response(JSON.stringify({}), { status: 200 });
  }));
}

const req = () =>
  new Request("https://t/api/webhooks/paddle", {
    method: "POST",
    headers: { "paddle-signature": "ts=1;h1=abc" },
    body: "{}",
  });

const patches = () => state.calls.filter((c) => c.method === "PATCH");

beforeEach(() => {
  state.event = null;
  state.unmarshalThrows = false;
  state.duplicateInsert = false;
  state.subRow = null;
  state.calls = [];
  vi.stubEnv("PADDLE_NOTIFICATION_WEBHOOK_SECRET", "pdl_ntfset_test");
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_test");
  vi.stubEnv(
    "PADDLE_PRICES",
    JSON.stringify({ pro_monthly: "pri_pro_m", "cinema-10_once": "pri_c10", "cinema-30_once": "pri_c30" }),
  );
  mockFetch();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("paddle webhook — transport contract", () => {
  it("503 fail-closed when the secret is unset", async () => {
    vi.stubEnv("PADDLE_NOTIFICATION_WEBHOOK_SECRET", "");
    expect((await POST(req())).status).toBe(503);
  });

  it("401 when signature verification fails, nothing processed", async () => {
    state.unmarshalThrows = true;
    expect((await POST(req())).status).toBe(401);
    expect(state.calls.length).toBe(0);
  });

  it("unhandled event types are 200-acked without a dedup row", async () => {
    state.event = { eventId: "evt_1", eventType: "address.updated", data: {} };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(state.calls.length).toBe(0);
  });

  it("duplicate event id → 200 {duplicate}, handler skipped", async () => {
    state.duplicateInsert = true;
    state.event = {
      eventId: "evt_dup",
      eventType: "subscription.created",
      data: { id: "sub_1", status: "active", customData: { staffd_user_id: "u1", staffd_plan: "pro" } },
    };
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, duplicate: true });
    expect(patches().length).toBe(0);
  });
});

describe("paddle webhook — subscription sync", () => {
  it("subscription.created (plan) patches plan + paddle ids + active_until", async () => {
    state.subRow = { id: "row1", plan: "starter" };
    state.event = {
      eventId: "evt_2",
      eventType: "subscription.created",
      data: {
        id: "sub_new",
        status: "active",
        customerId: "ctm_1",
        customData: { staffd_user_id: "u1", staffd_plan: "pro" },
        currentBillingPeriod: { endsAt: "2026-08-29T00:00:00Z" },
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({
      plan: "pro",
      paddle_customer: "ctm_1",
      paddle_sub_id: "sub_new",
      active_until: "2026-08-29T00:00:00Z",
    });
  });

  it("plan falls back to the price-id map when customData is missing", async () => {
    state.subRow = { id: "row1" };
    state.event = {
      eventId: "evt_3",
      eventType: "subscription.updated",
      data: {
        id: "sub_x",
        status: "active",
        customerId: "ctm_1",
        items: [{ price: { id: "pri_pro_m" } }],
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toMatchObject({ plan: "pro" });
  });

  it("subscription.canceled (plan) reverts to starter and clears ids", async () => {
    state.subRow = { id: "row1", plan: "pro", paddle_sub_id: "sub_old" };
    state.event = {
      eventId: "evt_4",
      eventType: "subscription.canceled",
      data: { id: "sub_old", status: "canceled", customData: { staffd_user_id: "u1", staffd_plan: "pro" } },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({ plan: "starter", paddle_sub_id: "", active_until: "" });
  });

  it("canceled event for a superseded sub id is ignored", async () => {
    state.subRow = { id: "row1", plan: "pro", paddle_sub_id: "sub_current" };
    state.event = {
      eventId: "evt_5",
      eventType: "subscription.canceled",
      data: { id: "sub_old", status: "canceled", customData: { staffd_user_id: "u1", staffd_plan: "pro" } },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches().length).toBe(0);
  });

  it("department add-on activates into dept_addon_subs without touching plan", async () => {
    state.subRow = { id: "row1", plan: "growth", dept_addon_subs: {} };
    state.event = {
      eventId: "evt_6",
      eventType: "subscription.activated",
      data: {
        id: "sub_addon",
        status: "active",
        customData: { staffd_user_id: "u1", staffd_addon_type: "department", staffd_addon_dept: "design" },
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({ dept_addon_subs: { design: "sub_addon" } });
  });

  it("department add-on cancellation removes only that dept", async () => {
    state.subRow = { id: "row1", dept_addon_subs: { design: "sub_addon", hr: "sub_hr" } };
    state.event = {
      eventId: "evt_7",
      eventType: "subscription.canceled",
      data: {
        id: "sub_addon",
        status: "canceled",
        customData: { staffd_user_id: "u1", staffd_addon_type: "department", staffd_addon_dept: "design" },
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({ dept_addon_subs: { hr: "sub_hr" } });
  });

  it("CEO add-on sets and clears ceo_addon_sub without touching plan", async () => {
    state.subRow = { id: "row1", plan: "starter" };
    state.event = {
      eventId: "evt_8",
      eventType: "subscription.created",
      data: { id: "sub_ceo", status: "active", customData: { staffd_user_id: "u1", staffd_addon_type: "ceo" } },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({ ceo_addon_sub: "sub_ceo" });
  });
});

describe("paddle webhook — Cinema-pack top-ups", () => {
  it("transaction.completed credits clips × quantity", async () => {
    state.subRow = { id: "row1", cinema_pack_topups: 5 };
    state.event = {
      eventId: "evt_9",
      eventType: "transaction.completed",
      data: {
        id: "txn_1",
        customData: { staffd_user_id: "u1" },
        items: [{ price: { id: "pri_c10" }, quantity: 2 }],
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches()[0]?.body).toEqual({ cinema_pack_topups: 25 });
  });

  it("subscription-invoice transactions are ignored (plan sync owns them)", async () => {
    state.subRow = { id: "row1" };
    state.event = {
      eventId: "evt_10",
      eventType: "transaction.completed",
      data: { id: "txn_2", subscriptionId: "sub_x", customData: { staffd_user_id: "u1" } },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches().length).toBe(0);
  });

  it("transactions with no Cinema line items are ignored", async () => {
    state.subRow = { id: "row1" };
    state.event = {
      eventId: "evt_11",
      eventType: "transaction.completed",
      data: {
        id: "txn_3",
        customData: { staffd_user_id: "u1" },
        items: [{ price: { id: "pri_pro_m" }, quantity: 1 }],
      },
    };
    expect((await POST(req())).status).toBe(200);
    expect(patches().length).toBe(0);
  });
});
