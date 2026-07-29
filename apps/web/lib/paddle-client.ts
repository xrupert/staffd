"use client";

/**
 * Paddle.js client wiring (PR-Paddle-A — overlay checkout).
 *
 * The billing routes return either { url } (redirect providers) or
 * { overlay } — a CheckoutIntent descriptor from the BillingProvider seam.
 * `followCheckout()` is the single client-side consumer: redirect on url,
 * open the Paddle overlay on overlay, and report "not_configured" /
 * errors so callers keep their existing error UX.
 *
 * Env (client-safe): NEXT_PUBLIC_PADDLE_CLIENT_TOKEN, NEXT_PUBLIC_PADDLE_ENV.
 */

import { initializePaddle, type Paddle } from "@paddle/paddle-js";

export type OverlayIntent = {
  kind: "overlay";
  provider: "paddle";
  priceId: string;
  customerEmail?: string;
  customData: Record<string, string>;
  successUrl: string;
};

export type CheckoutRouteResponse = {
  url?: string;
  overlay?: OverlayIntent;
  error?: string;
};

let paddlePromise: Promise<Paddle | undefined> | null = null;

function getPaddle(): Promise<Paddle | undefined> {
  if (!paddlePromise) {
    const token = process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN;
    if (!token) return Promise.resolve(undefined);
    paddlePromise = initializePaddle({
      token,
      environment: process.env.NEXT_PUBLIC_PADDLE_ENV === "production" ? "production" : "sandbox",
    });
  }
  return paddlePromise;
}

/**
 * Act on a checkout route response. Returns:
 *   "opened"         — Paddle overlay is up (page stays put)
 *   "redirected"     — navigating to a hosted checkout URL
 *   "not_configured" — billing_not_configured from the seam
 *   "error"          — anything else (caller shows its own message)
 */
export async function followCheckout(data: CheckoutRouteResponse): Promise<
  "opened" | "redirected" | "not_configured" | "error"
> {
  if (data.url) {
    window.location.href = data.url;
    return "redirected";
  }
  if (data.overlay) {
    const paddle = await getPaddle();
    if (!paddle) return "not_configured"; // no client token in env yet
    paddle.Checkout.open({
      items: [{ priceId: data.overlay.priceId, quantity: 1 }],
      customData: data.overlay.customData,
      ...(data.overlay.customerEmail ? { customer: { email: data.overlay.customerEmail } } : {}),
      settings: { displayMode: "overlay", successUrl: data.overlay.successUrl },
    });
    return "opened";
  }
  return data.error === "billing_not_configured" ? "not_configured" : "error";
}

export const BILLING_NOT_CONFIGURED_MSG = "Billing isn't connected yet — check back soon.";
