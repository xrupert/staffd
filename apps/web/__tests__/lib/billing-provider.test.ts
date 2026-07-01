import { describe, it, expect } from "vitest";
import { getBillingProvider, BillingNotConfiguredError } from "../../app/api/_lib/billing/provider";

describe("getBillingProvider (NullBillingProvider until a real processor is wired in)", () => {
  it("createCheckoutSession throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().createCheckoutSession({
        mode: "subscription",
        priceId: "x",
        successUrl: "https://x",
        cancelUrl: "https://x",
      }),
    ).rejects.toThrow(BillingNotConfiguredError);
  });

  it("createPortalSession throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().createPortalSession("cust_1", "https://x"),
    ).rejects.toThrow(BillingNotConfiguredError);
  });

  it("cancelSubscription throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().cancelSubscription("sub_1"),
    ).rejects.toThrow(BillingNotConfiguredError);
  });
});
