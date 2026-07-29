/**
 * Paddle catalog seed — creates the ratified STAFFD catalog (SA 2026-07-29,
 * new value-priced model) in the TARGET Paddle environment and prints the
 * PADDLE_PRICES JSON to paste into Vercel env.
 *
 * Idempotent: matches existing products by name and prices by their
 * custom_data.staffd_key, so re-running never duplicates.
 *
 * Usage (from apps/web, after `pnpm install`):
 *   PADDLE_API_KEY=pdl_sdbx_... node scripts/paddle-seed-catalog.mjs
 *   PADDLE_ENV=production PADDLE_API_KEY=pdl_live_... node scripts/paddle-seed-catalog.mjs
 *
 * Catalog (all amounts USD; annual = monthly x10 per the locked pricing):
 *   Starter $39/mo  $390/yr  · Growth $79/mo $790/yr
 *   Pro     $149/mo $1490/yr · Agency $450/mo $4500/yr
 *   Extra Department $29/mo · The CEO $49/mo
 *   Cinema Pack 10 $39 once · Cinema Pack 30 $99 once
 */

import { Paddle, Environment } from "@paddle/paddle-node-sdk";

const API_KEY = process.env.PADDLE_API_KEY;
if (!API_KEY) {
  console.error("PADDLE_API_KEY is required (sandbox key: pdl_sdbx_...)");
  process.exit(1);
}
const ENV = process.env.PADDLE_ENV === "production" ? Environment.production : Environment.sandbox;

const paddle = new Paddle(API_KEY, { environment: ENV });

/** name → product def; each price carries its PADDLE_PRICES key. */
const CATALOG = [
  {
    name: "STAFFD Starter",
    description: "Starter plan — 6 curated specialists (Marketing/Sales/Legal pack).",
    prices: [
      { key: "starter_monthly", amount: "3900", interval: "month" },
      { key: "starter_annual", amount: "39000", interval: "year" },
    ],
  },
  {
    name: "STAFFD Growth",
    description: "Growth plan — Starter + 1 full department of your choice.",
    prices: [
      { key: "growth_monthly", amount: "7900", interval: "month" },
      { key: "growth_annual", amount: "79000", interval: "year" },
    ],
  },
  {
    name: "STAFFD Pro",
    description: "Pro plan — Starter + 3 full departments + The CEO.",
    prices: [
      { key: "pro_monthly", amount: "14900", interval: "month" },
      { key: "pro_annual", amount: "149000", interval: "year" },
    ],
  },
  {
    name: "STAFFD Agency",
    description: "Agency plan — all 9 departments + The CEO + multi-client dashboard.",
    prices: [
      { key: "agency_monthly", amount: "45000", interval: "month" },
      { key: "agency_annual", amount: "450000", interval: "year" },
    ],
  },
  {
    name: "STAFFD Extra Department",
    description: "Add one more full department to a Growth or Pro plan.",
    prices: [{ key: "dept-addon_monthly", amount: "2900", interval: "month" }],
  },
  {
    name: "STAFFD The CEO",
    description: "The cross-department CEO advisor for Starter and Growth plans.",
    prices: [{ key: "ceo-addon_monthly", amount: "4900", interval: "month" }],
  },
  {
    name: "STAFFD Cinema Pack 10",
    description: "+10 cinematic clips this month.",
    prices: [{ key: "cinema-10_once", amount: "3900" }],
  },
  {
    name: "STAFFD Cinema Pack 30",
    description: "+30 cinematic clips this month.",
    prices: [{ key: "cinema-30_once", amount: "9900" }],
  },
];

async function listAll(collection) {
  const out = [];
  let page = collection;
  for await (const item of page) out.push(item);
  return out;
}

async function main() {
  console.error(`Seeding Paddle catalog (${ENV === Environment.production ? "PRODUCTION" : "sandbox"})…`);

  const existingProducts = await listAll(paddle.products.list({ status: ["active"], perPage: 200 }));
  const existingPrices = await listAll(paddle.prices.list({ status: ["active"], perPage: 200 }));

  const priceMap = {};

  for (const def of CATALOG) {
    let product = existingProducts.find((p) => p.name === def.name);
    if (!product) {
      product = await paddle.products.create({
        name: def.name,
        description: def.description,
        taxCategory: "saas",
      });
      console.error(`  created product ${def.name} (${product.id})`);
    } else {
      console.error(`  exists  product ${def.name} (${product.id})`);
    }

    for (const priceDef of def.prices) {
      let price = existingPrices.find(
        (p) => p.productId === product.id && p.customData?.staffd_key === priceDef.key,
      );
      if (!price) {
        price = await paddle.prices.create({
          productId: product.id,
          description: priceDef.key,
          unitPrice: { amount: priceDef.amount, currencyCode: "USD" },
          ...(priceDef.interval
            ? { billingCycle: { interval: priceDef.interval, frequency: 1 } }
            : {}),
          quantity: { minimum: 1, maximum: 1 },
          customData: { staffd_key: priceDef.key },
        });
        console.error(`    created price ${priceDef.key} (${price.id})`);
      } else {
        console.error(`    exists  price ${priceDef.key} (${price.id})`);
      }
      priceMap[priceDef.key] = price.id;
    }
  }

  console.error("\nPADDLE_PRICES (set this in Vercel env + .env.local):\n");
  console.log(JSON.stringify(priceMap));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
