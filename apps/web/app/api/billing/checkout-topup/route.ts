/**
 * POST /api/billing/checkout-topup
 * Body: { pack } where pack is a TOPUP_PACKS key
 * Returns: { url } — checkout URL for a one-time credit pack, or a 503
 * { error: "billing_not_configured" } until a real provider is wired in.
 *
 * Maps the requested pack to its price id via STRIPE_PRICES and carries the
 * credit quantity in checkout metadata so the (future) webhook can credit
 * the user without a second lookup. Mode is "payment" (one-time).
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

const TOPUP_PACKS: Record<string, { type: "image" | "video"; count: number }> = {
  "topup-img-50":  { type: "image", count: 50  },
  "topup-img-150": { type: "image", count: 150 },
  "topup-img-350": { type: "image", count: 350 },
  "topup-vid-10":  { type: "video", count: 10  },
  "topup-vid-25":  { type: "video", count: 25  },
  "topup-vid-50":  { type: "video", count: 50  },
};

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

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
  const packDef = TOPUP_PACKS[pack];
  if (!packDef) {
    return Response.json({ error: "Unknown top-up pack" }, { status: 400 });
  }

  const prices = getPrices();
  const priceId = prices[`${pack}_oneoff`];
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
    const subData = (await subRes.json()) as { items?: Array<{ stripe_customer?: string }> };
    const customerId = subData.items?.[0]?.stripe_customer;

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "payment",
      priceId,
      customerId,
      customerEmail: customerId ? undefined : userEmail,
      successUrl: `${origin}/dashboard?topup=success&pack=${pack}`,
      cancelUrl: `${origin}/dashboard?topup=cancelled`,
      metadata: {
        staffd_user_id: userId,
        staffd_topup_pack: pack,
        topup_type: packDef.type,
        credit_count: String(packDef.count),
      },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Topup checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
