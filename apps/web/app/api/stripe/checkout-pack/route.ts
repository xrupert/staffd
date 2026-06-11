/**
 * POST /api/stripe/checkout-pack — RETIRED (W58.3).
 *
 * Industry packs activate automatically from the business industry (D-19
 * bridging, W58.0.1). No Stripe session is ever created for a pack SKU —
 * this guard returns 410 Gone for any caller, including stale cached
 * clients still rendering an old buy button. Stripe-side SKU archival is
 * W47.5's job; this server-side guard is the interim protection.
 */

export async function POST() {
  return Response.json(
    {
      error: "packs_now_automatic",
      message:
        "Industry packs are now included automatically based on your business industry. Update your industry in Settings if you need different industry support.",
    },
    { status: 410 }
  );
}
