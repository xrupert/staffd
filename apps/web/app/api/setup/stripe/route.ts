/**
 * One-time Stripe setup: creates 4 products × 2 prices (monthly + annual) = 8 prices.
 *
 * After running, copy the STRIPE_PRICES value from the response and add it as a
 * Vercel environment variable.  Safe to call multiple times — checks for
 * existing products tagged with our metadata before creating new ones.
 *
 * Pricing:
 *   Starter  $39/mo  · $390/yr  (2 months free)
 *   Growth   $79/mo  · $790/yr
 *   Pro     $149/mo  · $1,490/yr
 *   Agency  $450/mo  · $4,500/yr
 */

import Stripe from "stripe";

const PLANS = [
  { id: "starter", name: "Starter", monthly: 3900,  annual: 39000  },
  { id: "growth",  name: "Growth",  monthly: 7900,  annual: 79000  },
  { id: "pro",     name: "Pro",     monthly: 14900, annual: 149000 },
  { id: "agency",  name: "Agency",  monthly: 45000, annual: 450000 },
];

// Allow GET so you can trigger this by navigating to the URL in a browser
export async function GET() { return POST(); }

export async function POST() {
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    return Response.json(
      { error: "STRIPE_SECRET_KEY not set. Add it to your Vercel environment variables first." },
      { status: 503 }
    );
  }

  const stripe = new Stripe(secretKey);
  const prices: Record<string, string> = {};

  try {
    for (const plan of PLANS) {
      // Check if a product already exists for this plan (idempotent)
      const existing = await stripe.products.search({
        query: `metadata['staffd_plan_id']:'${plan.id}'`,
        limit: 1,
      });

      let productId: string;
      if (existing.data.length > 0) {
        productId = existing.data[0]!.id;
      } else {
        const product = await stripe.products.create({
          name: `STAFFD ${plan.name}`,
          description: `STAFFD ${plan.name} plan — access to your AI business team`,
          metadata: { staffd_plan_id: plan.id },
        });
        productId = product.id;
      }

      // Check / create monthly price
      const existingMonthly = await stripe.prices.search({
        query: `product:'${productId}' AND metadata['staffd_interval']:'monthly'`,
        limit: 1,
      });
      if (existingMonthly.data.length > 0) {
        prices[`${plan.id}_monthly`] = existingMonthly.data[0]!.id;
      } else {
        const mp = await stripe.prices.create({
          product: productId,
          unit_amount: plan.monthly,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: `STAFFD ${plan.name} Monthly`,
          metadata: { staffd_plan_id: plan.id, staffd_interval: "monthly" },
        });
        prices[`${plan.id}_monthly`] = mp.id;
      }

      // Check / create annual price
      const existingAnnual = await stripe.prices.search({
        query: `product:'${productId}' AND metadata['staffd_interval']:'annual'`,
        limit: 1,
      });
      if (existingAnnual.data.length > 0) {
        prices[`${plan.id}_annual`] = existingAnnual.data[0]!.id;
      } else {
        const ap = await stripe.prices.create({
          product: productId,
          unit_amount: plan.annual,
          currency: "usd",
          recurring: { interval: "year" },
          nickname: `STAFFD ${plan.name} Annual`,
          metadata: { staffd_plan_id: plan.id, staffd_interval: "annual" },
        });
        prices[`${plan.id}_annual`] = ap.id;
      }
    }

    const STRIPE_PRICES = JSON.stringify(prices);

    return Response.json({
      ok: true,
      prices,
      // ─── Paste this entire value into Vercel as STRIPE_PRICES ───────────────
      STRIPE_PRICES,
      instructions: [
        "1. Copy the STRIPE_PRICES value above",
        "2. Add it to Vercel → Settings → Environment Variables as: STRIPE_PRICES",
        "3. Add STRIPE_SECRET_KEY (sk_live_...) and STRIPE_PUBLISHABLE_KEY (pk_live_...)",
        "4. Create a webhook in Stripe Dashboard → Developers → Webhooks",
        "   Endpoint URL: https://urstaffd.com/api/stripe/webhook",
        "   Events: checkout.session.completed, customer.subscription.updated, customer.subscription.deleted",
        "5. Copy the webhook signing secret and add as STRIPE_WEBHOOK_SECRET",
        "6. Redeploy on Vercel",
      ],
    });
  } catch (err) {
    console.error("Stripe setup error:", err);
    return Response.json({ error: "Setup failed", detail: String(err) }, { status: 500 });
  }
}
