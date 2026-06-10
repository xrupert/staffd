/**
 * W47 — Stripe setup route SKU contract tests (Tests 1–2).
 *
 * Covers:
 *   - The 6 §3-aligned top-up products are created with
 *     metadata.topup_type ∈ {"image","video"} and metadata.credit_count
 *     matching the ARCH §3 pack table, at the §3 unit amounts.
 *   - The 6 retired generic-credit products (topup-100 … topup-5000) are
 *     archived via products.update(active=false), never deleted.
 *
 * Stripe SDK is fully stubbed — no network.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";

const stripeMocks = vi.hoisted(() => ({
  productsSearch: vi.fn(),
  productsCreate: vi.fn(),
  productsUpdate: vi.fn(),
  pricesSearch: vi.fn(),
  pricesCreate: vi.fn(),
}));

vi.mock("stripe", () => ({
  default: class StripeMock {
    products = {
      search: stripeMocks.productsSearch,
      create: stripeMocks.productsCreate,
      update: stripeMocks.productsUpdate,
    };
    prices = {
      search: stripeMocks.pricesSearch,
      create: stripeMocks.pricesCreate,
    };
  },
}));

process.env.STRIPE_SECRET_KEY = "sk_test_stub";

import { POST } from "../../app/api/setup/stripe/route";

// ARCH §3 locked pack table.
const EXPECTED_PACKS: Record<string, { type: string; count: string; amount: number }> = {
  "topup-img-50":  { type: "image", count: "50",  amount:   999 },
  "topup-img-150": { type: "image", count: "150", amount:  2499 },
  "topup-img-350": { type: "image", count: "350", amount:  5499 },
  "topup-vid-10":  { type: "video", count: "10",  amount:  2299 },
  "topup-vid-25":  { type: "video", count: "25",  amount:  5499 },
  "topup-vid-50":  { type: "video", count: "50",  amount: 10999 },
};

const LEGACY_IDS = ["topup-100", "topup-250", "topup-500", "topup-1000", "topup-2500", "topup-5000"];

let productSeq = 0;
let priceSeq = 0;

beforeEach(() => {
  vi.clearAllMocks();
  productSeq = 0;
  priceSeq = 0;
  stripeMocks.productsCreate.mockImplementation(async (args: { metadata?: Record<string, string> }) => ({
    id: `prod_new_${++productSeq}`,
    active: true,
    metadata: args.metadata,
  }));
  stripeMocks.productsUpdate.mockImplementation(async (id: string) => ({ id, active: false }));
  stripeMocks.pricesSearch.mockResolvedValue({ data: [] });
  stripeMocks.pricesCreate.mockImplementation(async () => ({ id: `price_new_${++priceSeq}` }));
});

describe("setup/stripe — W47 §3 top-up SKUs", () => {
  it("creates the 6 §3 packs with topup_type + credit_count metadata at §3 prices (Test 1)", async () => {
    // Fresh Stripe account — nothing exists yet.
    stripeMocks.productsSearch.mockResolvedValue({ data: [] });

    const res = await POST();
    expect(res.status).toBe(200);

    const topupCreates = stripeMocks.productsCreate.mock.calls
      .map((c) => c[0] as { description?: string; metadata?: Record<string, string> })
      .filter((args) => /^topup-(img|vid)-/.test(args.metadata?.staffd_topup_id ?? ""));

    expect(topupCreates).toHaveLength(6);

    for (const args of topupCreates) {
      const id = args.metadata!.staffd_topup_id!;
      const expected = EXPECTED_PACKS[id];
      expect(expected, `unexpected SKU id ${id}`).toBeTruthy();
      expect(args.metadata!.topup_type).toBe(expected!.type);
      expect(args.metadata!.credit_count).toBe(expected!.count);
      // Locked copy — no "generic", no "agent calls".
      expect(args.description).toBe(
        `${expected!.count} ${expected!.type} credits — top up your monthly allowance. Never expire.`
      );
      expect(args.description).not.toMatch(/generic|agent/i);
    }

    // Price amounts per §3.
    const topupPriceCreates = stripeMocks.pricesCreate.mock.calls
      .map((c) => c[0] as { unit_amount: number; metadata?: Record<string, string> })
      .filter((args) => /^topup-(img|vid)-/.test(args.metadata?.staffd_topup_id ?? ""));
    expect(topupPriceCreates).toHaveLength(6);
    for (const args of topupPriceCreates) {
      expect(args.unit_amount).toBe(EXPECTED_PACKS[args.metadata!.staffd_topup_id!]!.amount);
    }
  });

  it("archives the 6 legacy generic products with active=false, never deletes (Test 2)", async () => {
    stripeMocks.productsSearch.mockImplementation(async ({ query }: { query: string }) => {
      const legacy = LEGACY_IDS.find((id) => query.includes(`'${id}'`));
      if (legacy) return { data: [{ id: `prod_legacy_${legacy}`, active: true }] };
      return { data: [] };
    });

    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { archivedLegacyTopups: string[] };

    expect(stripeMocks.productsUpdate).toHaveBeenCalledTimes(6);
    for (const legacy of LEGACY_IDS) {
      expect(stripeMocks.productsUpdate).toHaveBeenCalledWith(
        `prod_legacy_${legacy}`,
        { active: false }
      );
    }
    expect(body.archivedLegacyTopups).toHaveLength(6);
  });
});
