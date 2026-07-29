/**
 * PaddleBillingProvider — the real BillingProvider implementation (SA
 * decision, 2026-07-29: Paddle, overlay checkout).
 *
 * Checkout needs NO server-side Paddle call: the overlay CheckoutIntent
 * carries the price id + customData and the client opens Paddle.js.
 * Portal + cancel go through @paddle/paddle-node-sdk, imported lazily per
 * Standard #26 so the SDK never loads on unconfigured deploys.
 *
 * Env:
 *   PADDLE_API_KEY            server-side API key (sandbox or live)
 *   NEXT_PUBLIC_PADDLE_ENV    "sandbox" (default) | "production"
 */

import type { BillingProvider, CheckoutIntent, CheckoutSessionParams } from "./provider";

type PaddleSdk = InstanceType<typeof import("@paddle/paddle-node-sdk").Paddle>;

let cachedSdk: PaddleSdk | null = null;

async function getPaddleSdk(): Promise<PaddleSdk> {
  if (cachedSdk) return cachedSdk;
  const { Paddle, Environment } = await import("@paddle/paddle-node-sdk");
  const apiKey = process.env.PADDLE_API_KEY;
  if (!apiKey) throw new Error("PADDLE_API_KEY is not set");
  cachedSdk = new Paddle(apiKey, {
    environment:
      process.env.NEXT_PUBLIC_PADDLE_ENV === "production"
        ? Environment.production
        : Environment.sandbox,
  });
  return cachedSdk;
}

/** Test-only: drop the cached SDK so env changes take effect. */
export function __resetPaddleSdkForTests(): void {
  cachedSdk = null;
}

export class PaddleBillingProvider implements BillingProvider {
  async createCheckoutSession(params: CheckoutSessionParams): Promise<CheckoutIntent> {
    return {
      kind: "overlay",
      provider: "paddle",
      priceId: params.priceId,
      customerEmail: params.customerEmail,
      customData: { ...(params.metadata ?? {}) },
      successUrl: params.successUrl,
    };
  }

  async createPortalSession(customerId: string, _returnUrl: string): Promise<{ url: string }> {
    const paddle = await getPaddleSdk();
    const session = await paddle.customerPortalSessions.create(customerId, []);
    return { url: session.urls.general.overview };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    const paddle = await getPaddleSdk();
    await paddle.subscriptions.cancel(subscriptionId, {
      effectiveFrom: "next_billing_period",
    });
  }
}
