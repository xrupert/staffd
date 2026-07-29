/**
 * PR-Paddle-A — provider selection, overlay CheckoutIntent, price-map
 * helpers. The Paddle SDK itself is never hit here (checkout needs no SDK;
 * portal/cancel are covered by the webhook suite's SDK mock pattern).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import {
  getBillingProvider,
  NullBillingProvider,
  checkoutResponse,
  type CheckoutIntent,
} from "../../app/api/_lib/billing/provider";
import { PaddleBillingProvider } from "../../app/api/_lib/billing/paddle";
import {
  getPaddlePrices,
  priceKeyForId,
  planForPriceId,
  cinemaClipsForPriceId,
} from "../../app/api/_lib/billing/prices";

const PRICES = {
  starter_monthly: "pri_starter_m",
  pro_annual: "pri_pro_a",
  "dept-addon_monthly": "pri_dept",
  "cinema-10_once": "pri_c10",
  "cinema-30_once": "pri_c30",
};

beforeEach(() => {
  vi.stubEnv("PADDLE_PRICES", JSON.stringify(PRICES));
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getBillingProvider — env-switched (PADDLE_API_KEY)", () => {
  it("returns NullBillingProvider when PADDLE_API_KEY is unset", () => {
    vi.stubEnv("PADDLE_API_KEY", "");
    expect(getBillingProvider()).toBeInstanceOf(NullBillingProvider);
  });

  it("returns PaddleBillingProvider when PADDLE_API_KEY is set", () => {
    vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_test");
    expect(getBillingProvider()).toBeInstanceOf(PaddleBillingProvider);
  });
});

describe("PaddleBillingProvider.createCheckoutSession — overlay intent", () => {
  it("carries priceId, customData, email, successUrl; no SDK call needed", async () => {
    const intent = await new PaddleBillingProvider().createCheckoutSession({
      mode: "subscription",
      priceId: "pri_pro_a",
      customerEmail: "owner@biz.com",
      successUrl: "https://urstaffd.com/dashboard?checkout=success",
      cancelUrl: "https://urstaffd.com/dashboard?checkout=cancelled",
      metadata: { staffd_user_id: "u1", staffd_plan: "pro" },
    });
    expect(intent).toEqual({
      kind: "overlay",
      provider: "paddle",
      priceId: "pri_pro_a",
      customerEmail: "owner@biz.com",
      customData: { staffd_user_id: "u1", staffd_plan: "pro" },
      successUrl: "https://urstaffd.com/dashboard?checkout=success",
    });
  });
});

describe("checkoutResponse serialization", () => {
  it("redirect → { url }", () => {
    const intent: CheckoutIntent = { kind: "redirect", url: "https://pay.example/x" };
    expect(checkoutResponse(intent)).toEqual({ url: "https://pay.example/x" });
  });
  it("overlay → { overlay }", () => {
    const intent: CheckoutIntent = {
      kind: "overlay",
      provider: "paddle",
      priceId: "pri_1",
      customData: {},
      successUrl: "https://x",
    };
    expect(checkoutResponse(intent)).toEqual({ overlay: intent });
  });
});

describe("PADDLE_PRICES helpers", () => {
  it("parses the map and reverse-looks-up keys", () => {
    expect(getPaddlePrices()["starter_monthly"]).toBe("pri_starter_m");
    expect(priceKeyForId("pri_pro_a")).toBe("pro_annual");
    expect(priceKeyForId("pri_unknown")).toBeUndefined();
  });

  it("planForPriceId only matches plan prices", () => {
    expect(planForPriceId("pri_pro_a")).toBe("pro");
    expect(planForPriceId("pri_starter_m")).toBe("starter");
    expect(planForPriceId("pri_dept")).toBeUndefined();
    expect(planForPriceId("pri_c10")).toBeUndefined();
  });

  it("cinemaClipsForPriceId maps the two Cinema packs", () => {
    expect(cinemaClipsForPriceId("pri_c10")).toBe(10);
    expect(cinemaClipsForPriceId("pri_c30")).toBe(30);
    expect(cinemaClipsForPriceId("pri_starter_m")).toBeUndefined();
  });

  it("malformed PADDLE_PRICES degrades to an empty map", () => {
    vi.stubEnv("PADDLE_PRICES", "{not json");
    expect(getPaddlePrices()).toEqual({});
  });
});
