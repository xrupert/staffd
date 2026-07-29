/**
 * POST /api/billing/checkout-topup
 * Body: { pack } where pack is a CINEMA_PACKS key
 * Returns: { overlay } (Paddle) / { url } (redirect providers), or a 503
 * { error: "billing_not_configured" } until a provider is wired in.
 *
 * SA 2026-07-29 (value-priced model): the legacy image/video credit packs
 * are GONE — the only purchasable top-up is Cinema extension packs
 * (+10/$39, +30/$99 cinematic clips). The webhook credits
 * `cinema_pack_topups` from the Cinema price ids; the clip count also
 * rides customData for observability. Mode is "payment" (one-time).
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError, checkoutResponse } from "../../_lib/billing/provider";
import { getPaddlePrices } from "../../_lib/billing/prices";

export const CINEMA_PACKS: Record<string, { clips: number; priceKey: string }> = {
  "cinema-10": { clips: 10, priceKey: "cinema-10_once" },
  "cinema-30": { clips: 30, priceKey: "cinema-30_once" },
};

export async function POST(req: Request) {
  const { pack } = (await req.json()) as { pack: string };

  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  if (!pack) {
    return Response.json({ error: "pack required" }, { status: 400 });
  }
  const packDef = CINEMA_PACKS[pack];
  if (!packDef) {
    return Response.json({ error: "Unknown pack" }, { status: 400 });
  }

  const prices = getPaddlePrices();
  const priceId = prices[packDef.priceKey];
  if (!priceId) {
    return Response.json({ error: `Top-up price not configured for ${pack}.` }, { status: 503 });
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const subRes = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const subData = (await subRes.json()) as { items?: Array<{ paddle_customer?: string }> };
    const customerId = subData.items?.[0]?.paddle_customer;

    const provider = getBillingProvider();
    const intent = await provider.createCheckoutSession({
      mode: "payment",
      priceId,
      customerId,
      customerEmail: customerId ? undefined : userEmail,
      successUrl: `${origin}/dashboard?topup=success&pack=${pack}`,
      cancelUrl: `${origin}/dashboard?topup=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_pack: pack,
        staffd_pack_clips: String(packDef.clips),
      },
    });

    return Response.json(checkoutResponse(intent));
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Topup checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
