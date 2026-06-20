/**
 * Muapi prediction primitives (W95.7.3b) — the llm-free HTTP layer shared by
 * the submit route (POST /api/integrations/muapi) and the async status poll
 * (GET /api/generation/[id]/status).
 *
 * Extracted out of the route so the status poll can import the single-shot
 * `checkPrediction` WITHOUT pulling the route's module-scope `new Anthropic()`
 * (the documented happy-dom browser-guard footgun). No prompt enrichment here —
 * that stays in the route (it needs the Anthropic SDK).
 *
 * PR-Tranche-1.7 contract: `x-api-key` auth, flat JSON body, output URL at
 * outputs[0] → url → output.url.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { MUAPI_BASE_URL } from "../../../../../lib/env";

const MUAPI_URL = MUAPI_BASE_URL;
const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";
const MUAPI_WEBHOOK_SECRET = process.env.MUAPI_WEBHOOK_SECRET ?? "";

export function muapiConfigured(): boolean {
  return !!MUAPI_KEY;
}

/**
 * BILLING POLICY (W95.7.3c, from Muapi's published OpenAPI spec — NOT an
 * invoice): "Costs are debited from the wallet on completion." i.e. Muapi
 * debits STAFFD when a generation COMPLETES, not on submit. Implications for
 * margin: a job that completes server-side after the customer closed the tab is
 * still debited (closed-tab leak → the webhook below closes it by charging the
 * customer on completion). Whether FAILED or CANCELLED jobs are billed is NOT
 * IN SPEC (unverified — operator to confirm against a real invoice). Account
 * balance: GET /api/v1/account/balance (used by W95.7.3c-build-2 reconciliation).
 */

// ── Completion webhook (W95.7.3c-b1) ───────────────────────────────────────
// Muapi supports `?webhook=<url>` push delivery on completion. The spec shows
// no payload-signing, so we authenticate the callback with an HMAC-DERIVED
// capability token in the URL (the raw secret never leaves the server); the
// receiver re-derives + timing-safe compares, then pulls the AUTHORITATIVE
// result via checkPrediction (never trusts the unsigned payload body).

export function muapiWebhookConfigured(): boolean {
  return !!MUAPI_WEBHOOK_SECRET;
}

/** Static HMAC-derived capability token embedded in the callback URL. */
export function muapiWebhookToken(): string {
  return createHmac("sha256", MUAPI_WEBHOOK_SECRET).update("muapi-webhook-v1").digest("hex");
}

/** Timing-safe validation of an inbound webhook token. */
export function verifyWebhookToken(token: string | null | undefined): boolean {
  if (!MUAPI_WEBHOOK_SECRET || !token) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(muapiWebhookToken());
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The callback URL handed to Muapi via `?webhook=`, or null if unconfigured. */
export function buildWebhookUrl(baseUrl: string): string | null {
  if (!MUAPI_WEBHOOK_SECRET || !baseUrl) return null;
  return `${baseUrl.replace(/\/$/, "")}/api/generation/webhook?token=${muapiWebhookToken()}`;
}

export interface PredictionResult {
  id?: string;
  request_id?: string;
  status?: string;
  outputs?: string[];
  output?: string | string[] | { url?: string };
  url?: string;
  result?: { url?: string; urls?: string[] };
  error?: string;
  detail?: string;
}

/** Output URL extraction — outputs[0] → url → output.url, then legacy shapes. */
export function tryExtractOutputUrl(data: PredictionResult): string | null {
  if (Array.isArray(data.outputs) && data.outputs[0]) return data.outputs[0];
  if (typeof data.url === "string" && data.url) return data.url;
  if (data.output && typeof data.output === "object" && !Array.isArray(data.output) && data.output.url) {
    return data.output.url;
  }
  if (typeof data.output === "string") return data.output;
  if (Array.isArray(data.output) && data.output[0]) return data.output[0];
  if (data.result?.url) return data.result.url;
  if (data.result?.urls?.[0]) return data.result.urls[0];
  return null;
}

/** Submit a generation job. Throws on a non-2xx from Muapi. When `webhookUrl`
 *  is given, Muapi POSTs the result to it on completion (push delivery). */
export async function submitPrediction(
  modelEndpoint: string,
  body: Record<string, unknown>,
  webhookUrl?: string | null,
): Promise<PredictionResult> {
  const url = webhookUrl
    ? `${MUAPI_URL}/api/v1/${modelEndpoint}?webhook=${encodeURIComponent(webhookUrl)}`
    : `${MUAPI_URL}/api/v1/${modelEndpoint}`;
  console.log("[muapi] submitting", { model: modelEndpoint, webhook: !!webhookUrl });
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-api-key": MUAPI_KEY, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("[muapi] submit failed", { status: res.status, model: modelEndpoint, detail: detail.slice(0, 500) });
    throw new Error(`Muapi ${res.status} on ${modelEndpoint}: ${detail.slice(0, 300)}`);
  }
  return (await res.json()) as PredictionResult;
}

export type PredictionStatus =
  | { state: "completed"; url: string }
  | { state: "failed"; error: string }
  | { state: "pending" };

/**
 * Single-shot poll of one prediction (W95.7.3b — replaces the route's 30×2s
 * server-side loop). Fast (<1s); the CLIENT drives the cadence by re-polling
 * the status endpoint. Indeterminate / transient upstream → "pending" so the
 * client simply tries again.
 */
export async function checkPrediction(predictionId: string): Promise<PredictionStatus> {
  const res = await fetch(`${MUAPI_URL}/api/v1/predictions/${encodeURIComponent(predictionId)}/result`, {
    headers: { "x-api-key": MUAPI_KEY },
  });
  if (!res.ok) return { state: "pending" }; // transient — re-poll
  const data = (await res.json()) as PredictionResult;
  const status = (data.status ?? "").toLowerCase();
  if (status === "completed" || status === "succeeded" || status === "success") {
    const url = tryExtractOutputUrl(data);
    return url ? { state: "completed", url } : { state: "pending" };
  }
  if (status === "failed" || status === "error") {
    return { state: "failed", error: data.error ?? data.detail ?? "Generation failed" };
  }
  return { state: "pending" };
}
