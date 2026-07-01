/**
 * BillingProvider — the seam between STAFFD and whichever payment processor
 * is wired in. Stripe was removed in full (SA decision, 2026-06-25) — no
 * code outside this file's future replacement should ever import a payment
 * SDK directly. getBillingProvider() is the one place a real Paddle/Nickel
 * implementation gets plugged in later.
 */

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("No billing provider is configured yet.");
    this.name = "BillingNotConfiguredError";
  }
}

export type CheckoutSessionParams = {
  mode: "subscription" | "payment";
  priceId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
};

export interface BillingProvider {
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export class NullBillingProvider implements BillingProvider {
  async createCheckoutSession(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async createPortalSession(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async cancelSubscription(): Promise<void> {
    throw new BillingNotConfiguredError();
  }
}

/** The one place a real provider (Paddle, Nickel, ...) gets wired in. */
export function getBillingProvider(): BillingProvider {
  return new NullBillingProvider();
}
