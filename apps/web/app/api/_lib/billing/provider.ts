/**
 * BillingProvider — the seam between STAFFD and whichever payment processor
 * is wired in. Stripe was removed in full (SA decision, 2026-06-25) — no
 * code outside a provider implementation should ever import a payment SDK
 * directly. getBillingProvider() is the one place a real implementation
 * gets plugged in.
 *
 * Paddle (SA decision, 2026-07-29): checkout is a client-side overlay
 * (Paddle.js), not a hosted redirect — so createCheckoutSession returns a
 * CheckoutIntent union. `redirect` preserves the hosted-URL shape for any
 * future provider that works that way; `overlay` carries what the client
 * needs to open Paddle.Checkout.open(). The webhook remains the single
 * source of truth for entitlement changes either way.
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

export type CheckoutIntent =
  | { kind: "redirect"; url: string }
  | {
      kind: "overlay";
      provider: "paddle";
      priceId: string;
      customerEmail?: string;
      /** Threaded through checkout → subscription/transaction webhooks. */
      customData: Record<string, string>;
      successUrl: string;
    };

/** Serialize a CheckoutIntent into the checkout routes' JSON response shape. */
export function checkoutResponse(intent: CheckoutIntent): Record<string, unknown> {
  return intent.kind === "redirect" ? { url: intent.url } : { overlay: intent };
}

export interface BillingProvider {
  createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutIntent>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export class NullBillingProvider implements BillingProvider {
  async createCheckoutSession(): Promise<CheckoutIntent> {
    throw new BillingNotConfiguredError();
  }
  async createPortalSession(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async cancelSubscription(): Promise<void> {
    throw new BillingNotConfiguredError();
  }
}

import { PaddleBillingProvider } from "./paddle";

/**
 * The one place a real provider gets wired in. Paddle activates when
 * PADDLE_API_KEY is present; otherwise the Null provider keeps every
 * billing surface failing closed with 503 billing_not_configured.
 * (paddle.ts lazy-imports the vendor SDK internally per Standard #26, so
 * this static import never loads @paddle/paddle-node-sdk by itself.)
 */
export function getBillingProvider(): BillingProvider {
  if (process.env.PADDLE_API_KEY) {
    return new PaddleBillingProvider();
  }
  return new NullBillingProvider();
}
