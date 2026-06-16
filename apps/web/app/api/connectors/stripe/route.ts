/**
 * GET /api/connectors/stripe  — live business pulse (MS-A).
 *
 * Reads the operator's own Stripe to surface a live revenue snapshot:
 * active subscription count + MRR (monthly recurring revenue), with annual
 * prices normalized to a monthly figure. The "read your real numbers"
 * capability — a building block for the autonomy loop and a dashboard pulse.
 *
 * Uses the existing STRIPE_SECRET_KEY (read in-handler so config changes /
 * tests take effect without a reload). 503 if unset, 502 on a Stripe error.
 */

import Stripe from "stripe";

type SubItem = {
  quantity?: number;
  price?: {
    unit_amount?: number | null;
    currency?: string;
    recurring?: { interval?: string } | null;
  } | null;
};
type Sub = { items?: { data?: SubItem[] } };

/** Normalize one subscription item's price to a monthly cents figure. */
function monthlyCents(item: SubItem): number {
  const amount = (item.price?.unit_amount ?? 0) * (item.quantity ?? 1);
  const interval = item.price?.recurring?.interval;
  if (interval === "year") return amount / 12;
  if (interval === "week") return (amount * 52) / 12;
  if (interval === "day") return (amount * 365) / 12;
  return amount; // month (or unknown → treat as monthly)
}

export async function GET(_req: Request) {
  const key = process.env.STRIPE_SECRET_KEY ?? "";
  if (!key) {
    return Response.json(
      {
        error: "not_configured",
        message: "Billing isn't connected yet. Add STRIPE_SECRET_KEY to your environment variables.",
      },
      { status: 503 }
    );
  }

  try {
    const stripe = new Stripe(key);
    const subs = await stripe.subscriptions.list({ status: "active", limit: 100 });
    const data: Sub[] = subs.data ?? [];

    let mrrCents = 0;
    let currency = "usd";
    for (const sub of data) {
      for (const item of sub.items?.data ?? []) {
        mrrCents += monthlyCents(item);
        if (item.price?.currency) currency = item.price.currency;
      }
    }

    return Response.json({
      activeSubscriptions: data.length,
      mrrCents: Math.round(mrrCents),
      mrr: Math.round(mrrCents) / 100,
      currency,
    });
  } catch (err) {
    console.error("[connectors/stripe] read error:", err);
    return Response.json({ error: "Failed to read Stripe" }, { status: 502 });
  }
}
