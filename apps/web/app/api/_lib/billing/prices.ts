/**
 * Paddle price-id map — single source of truth for SKU → price id lookup
 * (replaces the deleted STRIPE_PRICES convention, same JSON-env shape).
 *
 * PADDLE_PRICES is a JSON object of price keys → Paddle `pri_...` ids,
 * produced by `scripts/paddle/seed-catalog.mjs`. Ratified catalog
 * (SA 2026-07-29 — new value-priced model, no legacy credit top-ups):
 *
 *   starter_monthly / starter_annual
 *   growth_monthly  / growth_annual
 *   pro_monthly     / pro_annual
 *   agency_monthly  / agency_annual
 *   dept-addon_monthly            $29/mo extra department (Growth/Pro)
 *   ceo-addon_monthly             $49/mo CEO add-on (Starter/Growth)
 *   cinema-10_once                +10 cinematic clips, $39 one-time
 *   cinema-30_once                +30 cinematic clips, $99 one-time
 */

export function getPaddlePrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.PADDLE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/** Reverse lookup: Paddle price id → price key (e.g. "pro_monthly"). */
export function priceKeyForId(priceId: string): string | undefined {
  const prices = getPaddlePrices();
  return Object.keys(prices).find((k) => prices[k] === priceId);
}

/** Plan id ("starter"|"growth"|"pro"|"agency") for a Paddle price id, if it is a plan price. */
export function planForPriceId(priceId: string): string | undefined {
  const key = priceKeyForId(priceId);
  const plan = key?.split("_")[0] ?? "";
  return ["starter", "growth", "pro", "agency"].includes(plan) ? plan : undefined;
}

/** Cinematic clip count for a Paddle price id, if it is a Cinema pack. */
export function cinemaClipsForPriceId(priceId: string): number | undefined {
  const key = priceKeyForId(priceId);
  if (key === "cinema-10_once") return 10;
  if (key === "cinema-30_once") return 30;
  return undefined;
}
