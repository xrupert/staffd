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

// Add-on products (monthly only — no annual to keep the math simple)
const ADDONS = [
  {
    id: "dept-addon",
    name: "Department Add-on",
    description: "Add another full department of specialists to your STAFFD plan",
    monthly: 2900, // $29/mo
  },
  {
    // Phase 4 — CEO add-on for Starter / Growth users
    id: "ceo-addon",
    name: "CEO Add-on",
    description: "Add The CEO — cross-department strategic advisor — to your STAFFD plan",
    monthly: 4900, // $49/mo
  },
];

// Phase 4 — generic credit top-up packs (one-time payments).
// Pricing curve rewards bigger packs; margins stay healthy because credits
// are spent against per-call costs that average $0.005–$0.020.
const TOPUPS = [
  { id: "topup-100",  name: "100 Credits",   credits: 100,  oneOff:   999 }, // $9.99
  { id: "topup-250",  name: "250 Credits",   credits: 250,  oneOff:  1999 }, // $19.99
  { id: "topup-500",  name: "500 Credits",   credits: 500,  oneOff:  3499 }, // $34.99
  { id: "topup-1000", name: "1,000 Credits", credits: 1000, oneOff:  5999 }, // $59.99
  { id: "topup-2500", name: "2,500 Credits", credits: 2500, oneOff: 12999 }, // $129.99
  { id: "topup-5000", name: "5,000 Credits", credits: 5000, oneOff: 22999 }, // $229.99
];

// Phase 8 — industry packs ($19/mo subscriptions, one product per vertical).
// Eight packs surface as eight Stripe products so analytics / cancellations /
// per-pack pricing iteration are native.
const PACKS = [
  { id: "pack-law",          name: "Law Firm Pack",       monthly: 1900 },
  { id: "pack-real-estate",  name: "Real Estate Pack",    monthly: 1900 },
  { id: "pack-restaurants",  name: "Restaurants Pack",    monthly: 1900 },
  { id: "pack-coaches",      name: "Coaches Pack",        monthly: 1900 },
  { id: "pack-trades",       name: "Trades Pack",         monthly: 1900 },
  { id: "pack-salons",       name: "Salons & Spas Pack",  monthly: 1900 },
  { id: "pack-agencies",     name: "Agencies Pack",       monthly: 1900 },
  { id: "pack-consultants",  name: "Consultants Pack",    monthly: 1900 },
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
          description: `STAFFD ${plan.name} plan — staff your business with specialists across every department`,
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

    // ─── Add-ons (idempotent like plans) ───────────────────────────────────────
    for (const addon of ADDONS) {
      const existing = await stripe.products.search({
        query: `metadata['staffd_addon_id']:'${addon.id}'`,
        limit: 1,
      });

      let productId: string;
      if (existing.data.length > 0) {
        productId = existing.data[0]!.id;
      } else {
        const product = await stripe.products.create({
          name: addon.name,
          description: addon.description,
          metadata: { staffd_addon_id: addon.id },
        });
        productId = product.id;
      }

      const existingPrice = await stripe.prices.search({
        query: `product:'${productId}' AND metadata['staffd_interval']:'monthly'`,
        limit: 1,
      });

      if (existingPrice.data.length > 0) {
        prices[`${addon.id}_monthly`] = existingPrice.data[0]!.id;
      } else {
        const p = await stripe.prices.create({
          product: productId,
          unit_amount: addon.monthly,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: `STAFFD ${addon.name} Monthly`,
          metadata: { staffd_addon_id: addon.id, staffd_interval: "monthly" },
        });
        prices[`${addon.id}_monthly`] = p.id;
      }
    }

    // ─── Top-up packs (one-time payments, idempotent) ──────────────────────────
    for (const t of TOPUPS) {
      const existing = await stripe.products.search({
        query: `metadata['staffd_topup_id']:'${t.id}'`,
        limit: 1,
      });

      let productId: string;
      if (existing.data.length > 0) {
        productId = existing.data[0]!.id;
      } else {
        const product = await stripe.products.create({
          name: `STAFFD ${t.name}`,
          description: `${t.credits} generic credits for STAFFD agent calls. Never expire.`,
          metadata: { staffd_topup_id: t.id, staffd_topup_credits: String(t.credits) },
        });
        productId = product.id;
      }

      const existingPrice = await stripe.prices.search({
        query: `product:'${productId}' AND metadata['staffd_interval']:'oneoff'`,
        limit: 1,
      });

      if (existingPrice.data.length > 0) {
        prices[`${t.id}_oneoff`] = existingPrice.data[0]!.id;
      } else {
        const p = await stripe.prices.create({
          product: productId,
          unit_amount: t.oneOff,
          currency: "usd",
          // No `recurring` — one-time payment.
          nickname: `STAFFD ${t.name} One-time`,
          metadata: { staffd_topup_id: t.id, staffd_topup_credits: String(t.credits), staffd_interval: "oneoff" },
        });
        prices[`${t.id}_oneoff`] = p.id;
      }
    }

    // ─── Industry packs (subscriptions, idempotent like add-ons) ──────────────
    for (const pack of PACKS) {
      const existing = await stripe.products.search({
        query: `metadata['staffd_pack_id']:'${pack.id}'`,
        limit: 1,
      });

      let productId: string;
      if (existing.data.length > 0) {
        productId = existing.data[0]!.id;
      } else {
        const product = await stripe.products.create({
          name: `STAFFD ${pack.name}`,
          description: `Vertical specialists for ${pack.name.replace(" Pack", "").toLowerCase()} — added to your STAFFD plan.`,
          metadata: { staffd_pack_id: pack.id },
        });
        productId = product.id;
      }

      const existingPrice = await stripe.prices.search({
        query: `product:'${productId}' AND metadata['staffd_interval']:'monthly'`,
        limit: 1,
      });

      if (existingPrice.data.length > 0) {
        prices[`${pack.id}_monthly`] = existingPrice.data[0]!.id;
      } else {
        const p = await stripe.prices.create({
          product: productId,
          unit_amount: pack.monthly,
          currency: "usd",
          recurring: { interval: "month" },
          nickname: `STAFFD ${pack.name} Monthly`,
          metadata: { staffd_pack_id: pack.id, staffd_interval: "monthly" },
        });
        prices[`${pack.id}_monthly`] = p.id;
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
