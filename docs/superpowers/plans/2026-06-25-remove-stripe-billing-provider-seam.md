# Remove Stripe, Introduce a BillingProvider Seam — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Delete every direct Stripe SDK call from STAFFD, replacing it with one thin `BillingProvider` interface + a `NullBillingProvider` stub, so a future Paddle/Nickel integration has one seam to implement instead of re-tangling 8 route files.

**Architecture:** One new file (`apps/web/app/api/_lib/billing/provider.ts`) defines `BillingProvider`, `BillingNotConfiguredError`, `NullBillingProvider`, and `getBillingProvider()`. The 5 routes that must survive (`checkout`, `checkout-addon`, `checkout-ceo-addon`, `checkout-topup`, `portal`) move from `/api/stripe/*` to `/api/billing/*` and call `getBillingProvider()` instead of `new Stripe(...)`. The webhook, setup/stripe, and connectors/stripe routes are deleted outright (provider-specific, rebuilt fresh once a real provider is picked). `account/delete` gets its pre-existing field-name bug fixed and switches to the provider seam, fail-open. PocketBase schema fields are untouched.

**Tech Stack:** Next.js App Router route handlers, Vitest, PocketBase REST API.

**Spec:** `docs/superpowers/specs/2026-06-25-remove-stripe-billing-provider-seam-design.md`

---

## Task 1: BillingProvider interface + NullBillingProvider

**Files:**
- Create: `apps/web/app/api/_lib/billing/provider.ts`
- Test: `apps/web/__tests__/lib/billing-provider.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import { getBillingProvider, BillingNotConfiguredError } from "../../app/api/_lib/billing/provider";

describe("getBillingProvider (NullBillingProvider until a real processor is wired in)", () => {
  it("createCheckoutSession throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().createCheckoutSession({
        mode: "subscription",
        priceId: "x",
        successUrl: "https://x",
        cancelUrl: "https://x",
      }),
    ).rejects.toThrow(BillingNotConfiguredError);
  });

  it("createPortalSession throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().createPortalSession("cust_1", "https://x"),
    ).rejects.toThrow(BillingNotConfiguredError);
  });

  it("cancelSubscription throws BillingNotConfiguredError", async () => {
    await expect(
      getBillingProvider().cancelSubscription("sub_1"),
    ).rejects.toThrow(BillingNotConfiguredError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter web exec vitest run __tests__/lib/billing-provider.test.ts`
Expected: FAIL — cannot find module `../../app/api/_lib/billing/provider`

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/_lib/billing/provider.ts
/**
 * BillingProvider — the seam between STAFFD and whichever payment processor
 * is wired in. Stripe was removed in full (SA decision, 2026-06-25) — no
 * code outside this file's future replacement should ever import a payment
 * SDK directly. getBillingProvider() is the one place a real Paddle/Nickel
 * implementation gets plugged in later.
 */

export class BillingNotConfiguredError extends Error {
  constructor() {
    super("No billing provider is configured yet.");
    this.name = "BillingNotConfiguredError";
  }
}

export type CheckoutSessionParams = {
  mode: "subscription" | "payment";
  priceId: string;
  customerId?: string;
  customerEmail?: string;
  successUrl: string;
  cancelUrl: string;
  metadata?: Record<string, string>;
};

export interface BillingProvider {
  createCheckoutSession(params: CheckoutSessionParams): Promise<{ url: string }>;
  createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }>;
  cancelSubscription(subscriptionId: string): Promise<void>;
}

export class NullBillingProvider implements BillingProvider {
  async createCheckoutSession(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async createPortalSession(): Promise<{ url: string }> {
    throw new BillingNotConfiguredError();
  }
  async cancelSubscription(): Promise<void> {
    throw new BillingNotConfiguredError();
  }
}

/** The one place a real provider (Paddle, Nickel, ...) gets wired in. */
export function getBillingProvider(): BillingProvider {
  return new NullBillingProvider();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter web exec vitest run __tests__/lib/billing-provider.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/_lib/billing/provider.ts apps/web/__tests__/lib/billing-provider.test.ts
git commit -m "feat(billing): BillingProvider seam + NullBillingProvider stub"
```

---

## Task 2: `/api/billing/checkout` (replaces `/api/stripe/checkout`)

**Files:**
- Create: `apps/web/app/api/billing/checkout/route.ts`
- Delete: `apps/web/app/api/stripe/checkout/route.ts`
- Test: `apps/web/__tests__/api/billing-checkout-auth.test.ts` (replaces `stripe-checkout-auth.test.ts` for this route — the other 3 routes' auth cases move to this same file since Task 3-5 delete their old routes too)

- [ ] **Step 1: Write the new route (auth + provider call unchanged in shape, Stripe SDK removed)**

```ts
// apps/web/app/api/billing/checkout/route.ts
/**
 * POST /api/billing/checkout
 * Body: { planId, interval }
 * Returns: { url } — the billing-provider-hosted checkout page URL, or a
 * 503 { error: "billing_not_configured" } until a real provider is wired in.
 *
 * See docs/superpowers/specs/2026-06-25-remove-stripe-billing-provider-seam-design.md
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const body = (await req.json()) as { planId: string; interval: string };
  const { planId, interval } = body;

  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  // SECURITY (W95.7.3d-h6c) — derive the user from their session token, never a
  // body userId/userEmail.
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  if (!planId || !interval) {
    return Response.json({ error: "planId and interval are required" }, { status: 400 });
  }

  const prices = getPrices();
  const priceKey = `${planId}_${interval}`;
  const priceId = prices[priceKey];
  if (!priceId) {
    return Response.json(
      { error: `No price found for ${priceKey}.` },
      { status: 400 },
    );
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const data = (await res.json()) as { items?: Array<{ stripe_customer?: string }> };
    const customerId = data.items?.[0]?.stripe_customer || undefined;

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId,
      customerEmail: customerId ? undefined : userEmail,
      successUrl: `${origin}/dashboard?checkout=success&plan=${planId}`,
      cancelUrl: `${origin}/dashboard?checkout=cancelled`,
      metadata: { staffd_user_id: userId, staffd_plan: planId },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Checkout session error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Delete the old route**

```bash
git rm apps/web/app/api/stripe/checkout/route.ts
```

- [ ] **Step 3: Write the new auth test (replaces stripe-checkout-auth.test.ts's checkout case)**

```ts
// apps/web/__tests__/api/billing-checkout-auth.test.ts
/**
 * W95.7.3d-h6c — billing routes must authenticate the caller before ever
 * touching the BillingProvider. Pins the 401-without-a-session guard for
 * all four checkout-family routes under /api/billing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const auth = vi.hoisted(() => ({ user: null as { id: string; email: string } | null }));
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: async () => auth.user }));

const providerSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../../app/api/_lib/billing/provider", () => ({
  BillingNotConfiguredError: class BillingNotConfiguredError extends Error {},
  getBillingProvider: () => ({
    createCheckoutSession: async () => { providerSpy.calls += 1; return { url: "https://x" }; },
    createPortalSession: async () => { providerSpy.calls += 1; return { url: "https://x" }; },
    cancelSubscription: async () => { providerSpy.calls += 1; },
  }),
}));

import { POST as checkout } from "../../app/api/billing/checkout/route";
import { POST as addon } from "../../app/api/billing/checkout-addon/route";
import { POST as ceoAddon } from "../../app/api/billing/checkout-ceo-addon/route";
import { POST as topup } from "../../app/api/billing/checkout-topup/route";

const req = (body: object) => new Request("https://t/x", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  auth.user = null; // unauthenticated
  providerSpy.calls = 0;
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "https://pb.test";
});
afterEach(() => { vi.restoreAllMocks(); });

describe("billing checkout routes — auth required, no body-userId trust (h6c)", () => {
  it("checkout → 401 without a session, provider never called", async () => {
    expect((await checkout(req({ planId: "growth", interval: "monthly" }))).status).toBe(401);
    expect(providerSpy.calls).toBe(0);
  });
  it("checkout-addon → 401 without a session", async () => {
    expect((await addon(req({ department: "hr" }))).status).toBe(401);
  });
  it("checkout-ceo-addon → 401 without a session", async () => {
    expect((await ceoAddon(req({}))).status).toBe(401);
  });
  it("checkout-topup → 401 without a session", async () => {
    expect((await topup(req({ pack: "small" }))).status).toBe(401);
  });
});
```

- [ ] **Step 4: Delete the old test it supersedes**

```bash
git rm apps/web/__tests__/api/stripe-checkout-auth.test.ts
```

- [ ] **Step 5: Run tests to verify it fails (routes for Task 3-5 don't exist yet)**

Run: `pnpm --filter web exec vitest run __tests__/api/billing-checkout-auth.test.ts`
Expected: FAIL — cannot find `../../app/api/billing/checkout-addon/route` (and ceo-addon, topup) — this is expected until Tasks 3-5 land. Confirm the `checkout` test case specifically passes in isolation:
Run: `pnpm --filter web exec vitest run __tests__/api/billing-checkout-auth.test.ts -t "checkout →"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/billing/checkout/route.ts apps/web/__tests__/api/billing-checkout-auth.test.ts
git commit -m "feat(billing): /api/billing/checkout replaces /api/stripe/checkout"
```

---

## Task 3: `/api/billing/portal` (replaces `/api/stripe/portal`)

**Files:**
- Create: `apps/web/app/api/billing/portal/route.ts`
- Delete: `apps/web/app/api/stripe/portal/route.ts`

- [ ] **Step 1: Write the new route**

```ts
// apps/web/app/api/billing/portal/route.ts
/**
 * POST /api/billing/portal
 * Returns: { url } — the billing-provider-hosted customer portal URL, or a
 * 503 { error: "billing_not_configured" } until a real provider is wired in.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  // SECURITY (W95.7.3d-h6) — resolve the user from their session token, never
  // a body userId (IDOR fix — see original stripe/portal history).
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const data = (await res.json()) as { items?: Array<{ stripe_customer?: string }> };
    const customerId = data.items?.[0]?.stripe_customer;

    if (!customerId) {
      return Response.json(
        { error: "No active subscription found. Subscribe to a plan first." },
        { status: 404 },
      );
    }

    const provider = getBillingProvider();
    const portalSession = await provider.createPortalSession(customerId, `${origin}/dashboard/settings`);
    return Response.json({ url: portalSession.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Portal session error:", err);
    return Response.json({ error: "Failed to open subscription portal" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Delete the old route**

```bash
git rm apps/web/app/api/stripe/portal/route.ts
```

- [ ] **Step 3: Run tests to verify nothing regresses**

Run: `pnpm --filter web exec vitest run __tests__/api/billing-checkout-auth.test.ts`
Expected: still failing only on the not-yet-created addon/ceo-addon/topup imports (Task 4-5)

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/app/api/billing/portal apps/web/app/api/stripe/portal
git commit -m "feat(billing): /api/billing/portal replaces /api/stripe/portal"
```

---

## Task 4: `/api/billing/checkout-addon` and `/api/billing/checkout-ceo-addon`

**Files:**
- Create: `apps/web/app/api/billing/checkout-addon/route.ts`
- Create: `apps/web/app/api/billing/checkout-ceo-addon/route.ts`
- Delete: `apps/web/app/api/stripe/checkout-addon/route.ts`
- Delete: `apps/web/app/api/stripe/checkout-ceo-addon/route.ts`

- [ ] **Step 1: Write checkout-addon**

```ts
// apps/web/app/api/billing/checkout-addon/route.ts
/**
 * POST /api/billing/checkout-addon
 * Body: { department }
 * Returns: { url } — checkout URL for the $29/mo department add-on, or a
 * 503 { error: "billing_not_configured" } until a real provider is wired in.
 *
 * Eligibility: Growth and Pro plans only (Agency already has all depts;
 * Starter must upgrade first). Server-side validates plan eligibility.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

const ELIGIBLE_PLANS = new Set(["growth", "pro"]);

// Departments that can be purchased as an add-on
// (CEO is intentionally excluded — Pro-exclusive, Agency-included)
const ADDONABLE = new Set(["hr", "finance", "operations", "paid-media", "design", "reputation"]);

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  const { department } = (await req.json()) as { department: string };

  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  if (!department) {
    return Response.json({ error: "department required" }, { status: 400 });
  }
  if (!ADDONABLE.has(department)) {
    return Response.json({ error: "Department not available as add-on" }, { status: 400 });
  }

  const prices = getPrices();
  const priceId = prices["dept-addon_monthly"];
  if (!priceId) {
    return Response.json({ error: "Add-on price not configured." }, { status: 503 });
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const subRes = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const subData = (await subRes.json()) as {
      items?: Array<{
        plan: string;
        stripe_customer?: string;
        unlocked_departments?: string[];
        dept_addon_subs?: Record<string, string>;
      }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }
    if (!ELIGIBLE_PLANS.has(sub.plan)) {
      return Response.json(
        { error: "Department add-ons are only available on Growth or Pro. Agency includes all departments." },
        { status: 400 },
      );
    }

    const alreadyHas = (sub.unlocked_departments ?? []).includes(department) ||
                      Object.keys(sub.dept_addon_subs ?? {}).includes(department);
    if (alreadyHas) {
      return Response.json({ error: "You already have this department unlocked." }, { status: 400 });
    }

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId: sub.stripe_customer,
      customerEmail: sub.stripe_customer ? undefined : userEmail,
      successUrl: `${origin}/dashboard?addon=success&dept=${department}`,
      cancelUrl: `${origin}/dashboard?addon=cancelled`,
      metadata: { staffd_user_id: userId, staffd_addon_type: "department", staffd_addon_dept: department },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("Addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Write checkout-ceo-addon**

```ts
// apps/web/app/api/billing/checkout-ceo-addon/route.ts
/**
 * POST /api/billing/checkout-ceo-addon
 * Returns: { url } — checkout URL for the $49/mo CEO add-on, or a 503
 * { error: "billing_not_configured" } until a real provider is wired in.
 *
 * Eligibility: Starter and Growth users only. Pro and Agency already
 * include the CEO in-plan.
 */

import { resolveAppUrl } from "../../../../lib/env";
import { getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";

const ELIGIBLE_PLANS = new Set(["starter", "growth"]);

function getPrices(): Record<string, string> {
  try {
    return JSON.parse(process.env.STRIPE_PRICES ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

export async function POST(req: Request) {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL) {
    return Response.json({ error: "Payment system not configured" }, { status: 503 });
  }

  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
  const userId = me.id;
  const userEmail = me.email;

  const prices = getPrices();
  const priceId = prices["ceo-addon_monthly"];
  if (!priceId) {
    return Response.json({ error: "CEO add-on price not configured." }, { status: 503 });
  }

  const origin = resolveAppUrl(req.headers.get("origin"));

  try {
    const adminToken = await getAdminToken();
    const subRes = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=(user='${pbEscape(userId)}')&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    const subData = (await subRes.json()) as {
      items?: Array<{ plan: string; stripe_customer?: string; ceo_addon_sub?: string }>;
    };
    const sub = subData.items?.[0];

    if (!sub) {
      return Response.json({ error: "No subscription found. Subscribe to a plan first." }, { status: 404 });
    }
    if (!ELIGIBLE_PLANS.has(sub.plan)) {
      return Response.json({ error: "The CEO is already included in Pro and Agency plans." }, { status: 400 });
    }
    if (sub.ceo_addon_sub) {
      return Response.json({ error: "CEO add-on is already active on this account." }, { status: 400 });
    }

    const provider = getBillingProvider();
    const session = await provider.createCheckoutSession({
      mode: "subscription",
      priceId,
      customerId: sub.stripe_customer,
      customerEmail: sub.stripe_customer ? undefined : userEmail,
      successUrl: `${origin}/dashboard?addon=ceo-success`,
      cancelUrl: `${origin}/dashboard?addon=cancelled`,
      metadata: { staffd_user_id: userId, staffd_addon_type: "ceo" },
    });

    return Response.json({ url: session.url });
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return Response.json({ error: "billing_not_configured" }, { status: 503 });
    }
    console.error("CEO addon checkout error:", err);
    return Response.json({ error: "Failed to create checkout session" }, { status: 500 });
  }
}
```

- [ ] **Step 3: Delete the old routes**

```bash
git rm apps/web/app/api/stripe/checkout-addon/route.ts apps/web/app/api/stripe/checkout-ceo-addon/route.ts
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter web exec vitest run __tests__/api/billing-checkout-auth.test.ts`
Expected: still failing only on the not-yet-created topup import (Task 5)

- [ ] **Step 5: Commit**

```bash
git add -A apps/web/app/api/billing/checkout-addon apps/web/app/api/billing/checkout-ceo-addon apps/web/app/api/stripe/checkout-addon apps/web/app/api/stripe/checkout-ceo-addon
git commit -m "feat(billing): /api/billing/checkout-addon + checkout-ceo-addon replace their /api/stripe counterparts"
```

---

## Task 5: `/api/billing/checkout-topup` + delete `checkout-pack`

**Files:**
- Create: `apps/web/app/api/billing/checkout-topup/route.ts`
- Delete: `apps/web/app/api/stripe/checkout-topup/route.ts`
- Delete: `apps/web/app/api/stripe/checkout-pack/route.ts` (already a 410-Gone stub — genuinely dead, no replacement)
- Delete: `apps/web/__tests__/api/checkout-pack-guard.test.ts`

- [ ] **Step 1: Write checkout-topup**

```ts
// apps/web/app/api/billing/checkout-topup/route.ts
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
```

- [ ] **Step 2: Delete the old routes + their guard test**

```bash
git rm apps/web/app/api/stripe/checkout-topup/route.ts apps/web/app/api/stripe/checkout-pack/route.ts apps/web/__tests__/api/checkout-pack-guard.test.ts
```

- [ ] **Step 3: Run the full billing auth test now that all four routes exist**

Run: `pnpm --filter web exec vitest run __tests__/api/billing-checkout-auth.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/app/api/billing/checkout-topup apps/web/app/api/stripe/checkout-topup apps/web/app/api/stripe/checkout-pack apps/web/__tests__/api/checkout-pack-guard.test.ts
git commit -m "feat(billing): /api/billing/checkout-topup replaces /api/stripe/checkout-topup; remove dead checkout-pack stub"
```

---

## Task 6: Delete the webhook, setup/stripe, and connectors/stripe routes + their tests

**Files:**
- Delete: `apps/web/app/api/stripe/webhook/route.ts`
- Delete: `apps/web/app/api/setup/stripe/route.ts`
- Delete: `apps/web/app/api/connectors/stripe/route.ts`
- Delete: `apps/web/__tests__/api/stripe-webhook-topup.test.ts`
- Delete: `apps/web/__tests__/api/stripe-setup-topups.test.ts`
- Delete: `apps/web/__tests__/api/connectors-stripe.test.ts`
- Modify: `apps/web/app/components/BusinessPulseWidget.tsx`
- Modify: `apps/web/package.json`

Per spec §2.3/§2.4: signature verification and event-payload shapes differ per provider, so the webhook is deleted rather than adapted; SKU provisioning is inherently per-provider; the MRR connector has no generic replacement.

- [ ] **Step 1: Delete the routes and their tests**

```bash
git rm apps/web/app/api/stripe/webhook/route.ts apps/web/app/api/setup/stripe/route.ts apps/web/app/api/connectors/stripe/route.ts apps/web/__tests__/api/stripe-webhook-topup.test.ts apps/web/__tests__/api/stripe-setup-topups.test.ts apps/web/__tests__/api/connectors-stripe.test.ts
```

- [ ] **Step 2: Update BusinessPulseWidget to show a "not connected" empty state instead of fetching the deleted connector**

Replace the whole file:

```tsx
"use client";

/**
 * BusinessPulseWidget — STAFFD's own live revenue pulse for the operator.
 *
 * The Stripe-backed connector this widget read was removed (SA decision,
 * 2026-06-25 — Stripe is gone, a real provider isn't picked yet). Shows a
 * clean "not connected" state until a BillingProvider-backed connector
 * replaces it.
 */

const cardStyle: React.CSSProperties = {
  background: "#111118",
  border: "1px solid #2A2A38",
  borderRadius: "16px",
  padding: "20px",
};

export default function BusinessPulseWidget() {
  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs font-semibold uppercase tracking-widest" style={{ color: "#7070A0" }}>
          STAFFD Pulse
        </h2>
      </div>
      <div style={cardStyle}>
        <p className="text-xs" style={{ color: "#5A5A70" }}>
          No billing provider connected. Revenue metrics will appear here once one is.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 2b: Check for existing tests on BusinessPulseWidget before overwriting**

Run: `grep -rl "BusinessPulseWidget" apps/web/__tests__/`
Expected: if a test file references the old Stripe-fetching behavior, update its assertions to match the new empty state in this same step. If no test file references it, proceed.

- [ ] **Step 3: Remove the stripe npm dependency**

Edit `apps/web/package.json` — remove this line (currently line 31 in the `dependencies` block):

```json
"stripe": "^22.2.0",
```

Then run:

```bash
pnpm install
```

Expected: lockfile updates, no other package affected.

- [ ] **Step 4: Confirm no remaining import of the stripe package anywhere**

Run: `grep -rn "from \"stripe\"" apps/web --include=*.ts --include=*.tsx`
Expected: no output (empty)

- [ ] **Step 5: Run the full web test suite**

Run: `pnpm --filter web exec vitest run`
Expected: PASS — no test references a deleted route or the stripe package. (Tasks 7-8 below still need to land before `account/delete.test.ts` passes; if it fails here on the `stripe_subscription_id` assertion, that's expected and fixed in Task 7.)

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(billing): delete webhook, setup/stripe, connectors/stripe (provider-specific, no generic replacement) and the stripe npm dependency"
```

---

## Task 7: Fix `account/delete`'s field-name bug + switch to BillingProvider (fail-open)

**Files:**
- Modify: `apps/web/app/api/account/delete/route.ts:111-147,201`
- Modify: `apps/web/__tests__/account/delete.test.ts`

The current `cancelStripeSubscription` reads `stripe_subscription_id`, but the real schema field (see `apps/web/app/api/setup/subscriptions/route.ts:13`) is `stripe_sub_id` — this function has been silently no-oping in production. Fix the field name AND replace the raw Stripe HTTP call with `BillingProvider.cancelSubscription`, keeping the existing fail-open behavior (deletion proceeds regardless of the cancellation outcome).

- [ ] **Step 1: Write the failing test — asserts the fixed field name and a fail-open case**

Add to `apps/web/__tests__/account/delete.test.ts` (append inside the existing `describe` block, after the `"cascades delete..."` test):

```ts
  it("proceeds with deletion even when billing cancellation is not configured (fail-open)", async () => {
    fetchMock.mockImplementation(async (input: string | URL) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      if (u.includes("/records?filter=")) return okJson({ items: [], totalPages: 0 });
      return okJson({});
    });
    const res = await POST(makeReq({ confirm_email: USER_EMAIL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user_deleted).toBe(true);
  });
```

Then update the existing `"cascades delete on correct confirm_email + cancels Stripe + deletes user record"` test: rename it to reflect the new provider seam and fix the field name it asserts on. Replace lines 101-158 of `apps/web/__tests__/account/delete.test.ts` with:

```ts
  it("cascades delete on correct confirm_email + cancels the billing subscription + deletes user record", async () => {
    const deletedCollections: string[] = [];
    let userDeleted = false;

    fetchMock.mockImplementation(async (input: string | URL, init?: RequestInit) => {
      const u = typeof input === "string" ? input : input.toString();
      if (u.includes("auth-refresh")) {
        return okJson({ record: { id: USER_ID, email: USER_EMAIL } });
      }
      // Per-collection row list. Subscriptions row carries `stripe_sub_id`
      // (the REAL schema field — see setup/subscriptions/route.ts).
      const listMatch = u.match(/\/api\/collections\/([^/]+)\/records\?filter=/);
      if (listMatch && (!init?.method || init.method === "GET")) {
        const c = listMatch[1]!;
        if (c === "subscriptions") {
          return okJson({
            items: [{ id: `row_${c}`, stripe_sub_id: "sub_123" }],
            totalPages: 1,
          });
        }
        return okJson({ items: [{ id: `row_${c}` }], totalPages: 1 });
      }
      // Per-collection row delete
      const delMatch = u.match(/\/api\/collections\/([^/]+)\/records\/([^?]+)$/);
      if (delMatch && init?.method === "DELETE") {
        const collection = delMatch[1]!;
        if (collection === "users") {
          userDeleted = true;
        } else {
          deletedCollections.push(collection);
        }
        return okJson({});
      }
      return okJson({}, 404);
    });

    const res = await POST(makeReq({ confirm_email: USER_EMAIL }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.user_deleted).toBe(true);
    // No real provider is configured yet — cancellation reports not-cancelled,
    // but deletion must still proceed (fail-open).
    expect(body.stripe.cancelled).toBe(false);

    expect(deletedCollections).toContain("documents");
    expect(deletedCollections).toContain("conversations");
    expect(deletedCollections).toContain("vault_patterns");
    expect(deletedCollections).toContain("subscriptions");
    expect(userDeleted).toBe(true);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter web exec vitest run __tests__/account/delete.test.ts`
Expected: FAIL — `body.stripe.cancelled` is `true` today because the pre-fix code reads a field that doesn't exist and treats "no field" as "nothing to cancel, report cancelled:true"; after the fix it must go through the (unconfigured) BillingProvider and report `false`.

- [ ] **Step 3: Fix the implementation**

In `apps/web/app/api/account/delete/route.ts`, replace the import block (line 19-20):

```ts
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { isSuperAdmin, type SuperAdminUser } from "../../_lib/auth/super-admin";
```

with:

```ts
import { adminHeaders, getAdminToken, pbEscape, pbUrl } from "../../_lib/pb";
import { isSuperAdmin, type SuperAdminUser } from "../../_lib/auth/super-admin";
import { getBillingProvider, BillingNotConfiguredError } from "../../_lib/billing/provider";
```

Replace the `cancelStripeSubscription` function (lines 111-147):

```ts
async function cancelStripeSubscription(adminToken: string, userId: string): Promise<{ cancelled: boolean; detail?: string }> {
  // Fetch the user's subscription to get the billing-provider subscription id
  try {
    const filter = `user='${pbEscape(userId)}'`;
    const res = await fetch(
      `${pbUrl()}/api/collections/subscriptions/records?filter=${encodeURIComponent(filter)}&perPage=1`,
      { headers: { Authorization: adminToken } },
    );
    if (!res.ok) return { cancelled: false, detail: "subscriptions_fetch_failed" };
    const data = (await res.json()) as {
      items?: Array<{ stripe_sub_id?: string; stripe_customer?: string }>;
    };
    const sub = data.items?.[0];
    const subId = sub?.stripe_sub_id;
    if (!subId) return { cancelled: true, detail: "no_active_subscription" };

    await getBillingProvider().cancelSubscription(subId);
    return { cancelled: true };
  } catch (err) {
    if (err instanceof BillingNotConfiguredError) {
      return { cancelled: false, detail: "billing_not_configured" };
    }
    return { cancelled: false, detail: err instanceof Error ? err.message : "unknown" };
  }
}
```

Note: `// 1. Cancel Stripe subscription (best-effort — never blocks the delete)` at line ~200 already calls this fail-open — no change needed to the call site itself, only the comment can stay or be reworded; leave it as-is since "best-effort — never blocks the delete" is still accurate.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter web exec vitest run __tests__/account/delete.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/account/delete/route.ts apps/web/__tests__/account/delete.test.ts
git commit -m "fix(account): correct stripe_sub_id field name bug + route cancellation through BillingProvider (fail-open)"
```

---

## Task 8: Update UI call sites to `/api/billing/*` + handle `billing_not_configured`

**Files:**
- Modify: `apps/web/app/components/UpgradeModal.tsx:122,143`
- Modify: `apps/web/app/components/AddDeptModal.tsx:32`
- Modify: `apps/web/app/components/TopupModal.tsx:51,156`
- Modify: `apps/web/app/components/CreditsWidget.tsx:10-11` (comment only)
- Modify: `apps/web/app/dashboard/page.tsx:124,325`
- Modify: `apps/web/app/dashboard/settings/page.tsx:45,245`

No existing test covers these fetch URLs directly (`stripe-checkout-auth.test.ts` covered the route handlers, not these callers) — this task is UI-only, verified by a full test run showing no regressions plus a manual check.

- [ ] **Step 1: UpgradeModal — checkout + portal URLs, add a friendly message for 503**

In `apps/web/app/components/UpgradeModal.tsx`, replace `handleCheckout` (lines 116-137):

```tsx
  async function handleCheckout(planId: string) {
    if (checkingOut) return;
    setCheckingOut(planId);
    try {
      const userId    = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string) ?? "";
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ planId, interval, userId, userEmail }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Checkout error:", data.error === "billing_not_configured" ? "Billing isn't connected yet — check back soon." : data.error);
        setCheckingOut(null);
      }
    } catch {
      setCheckingOut(null);
    }
  }
```

Replace `handleManageSubscription` (lines 139-153):

```tsx
  async function handleManageSubscription() {
    setPortalLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { url?: string };
      if (data.url) window.location.href = data.url;
    } catch { /* ignore */ } finally {
      setPortalLoading(false);
    }
  }
```

- [ ] **Step 2: AddDeptModal — checkout-addon URL**

In `apps/web/app/components/AddDeptModal.tsx`, replace `handleAdd` (lines 26-47):

```tsx
  async function handleAdd() {
    if (!selected || loading) return;
    setLoading(true);
    try {
      const userId    = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string) ?? "";
      const res = await fetch("/api/billing/checkout-addon", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId, userEmail, department: selected }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error("Addon checkout error:", data.error === "billing_not_configured" ? "Billing isn't connected yet — check back soon." : data.error);
        setLoading(false);
      }
    } catch {
      setLoading(false);
    }
  }
```

- [ ] **Step 3: TopupModal — checkout-topup URL + footer copy**

In `apps/web/app/components/TopupModal.tsx`, replace `buyPack` (lines 45-67):

```tsx
  async function buyPack(pack: string) {
    setLoadingPack(pack);
    setError(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const userEmail = (pb.authStore.record?.email as string | undefined) ?? "";
      const res = await fetch("/api/billing/checkout-topup", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId, userEmail, pack }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error === "billing_not_configured" ? "Billing isn't connected yet — check back soon." : (data.error ?? "checkout_failed"));
        setLoadingPack(null);
      }
    } catch {
      setError("network_error");
      setLoadingPack(null);
    }
  }
```

Replace the footer copy (line 156):

```tsx
          Payment processed securely. You'll be redirected.
```

And the in-flight label (line 136):

```tsx
                          Opening checkout…
```

- [ ] **Step 4: CreditsWidget — update the comment referencing the old redirect path**

In `apps/web/app/components/CreditsWidget.tsx`, replace lines 10-11:

```tsx
 * "Top up" CTA opens the existing TopupModal when a balance runs low.
 * Re-fetches on visibility change so a successful checkout (which
 * redirects back to /dashboard?topup=success) shows the updated balance
 * immediately.
```

- [ ] **Step 5: dashboard/page.tsx — pending-plan auto-checkout + manage-subscription button**

In `apps/web/app/dashboard/page.tsx`, replace the comment + fetch inside `loadPlan` (lines 115-134):

```tsx
        // If user signed up via the pricing page, fire checkout for the
        // plan they picked. This runs once and only when they're still on starter.
        const pendingPlan = localStorage.getItem("staffd_pending_plan");
        const pendingInterval = localStorage.getItem("staffd_pending_interval") ?? "annual";
        if (pendingPlan && pendingPlan !== "starter" && (data.plan ?? "starter") === "starter") {
          localStorage.removeItem("staffd_pending_plan");
          localStorage.removeItem("staffd_pending_interval");
          const userEmail = (pb.authStore.record?.email as string) ?? "";
          try {
            const checkoutRes = await fetch("/api/billing/checkout", {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
              body: JSON.stringify({
                planId: pendingPlan, interval: pendingInterval, userId, userEmail,
              }),
            });
            const co = (await checkoutRes.json()) as { url?: string };
            if (co.url) window.location.href = co.url;
          } catch { /* user can still pick a plan from the dashboard */ }
        }
```

Replace the "manage subscription" plan-badge button's fetch (line 325):

```tsx
                  const res = await fetch("/api/billing/portal", { method: "POST", headers: { "Content-Type": "application/json", Authorization: pb.authStore.token }, body: JSON.stringify({ userId }) });
```

- [ ] **Step 6: settings/page.tsx — billing portal link + copy**

In `apps/web/app/dashboard/settings/page.tsx`, replace `openBilling` (lines 38-58):

```tsx
  // Opens the billing provider's customer portal for self-service billing
  // (update card, change plan, cancel). Redirects to the hosted portal.
  async function openBilling() {
    setOpeningBilling(true);
    setBillingMsg(null);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
        body: JSON.stringify({ userId }),
      });
      const data = (await res.json()) as { url?: string; error?: string };
      if (res.ok && data.url) { window.location.href = data.url; return; }
      setBillingMsg({
        text: data.error === "billing_not_configured" ? "Billing isn't connected yet — check back soon." : (data.error ?? "Couldn't open billing — try again."),
        ok: false,
      });
    } catch {
      setBillingMsg({ text: "Couldn't reach billing right now.", ok: false });
    } finally {
      setOpeningBilling(false);
    }
  }
```

Replace the billing section description (line 245):

```tsx
            Manage your plan, update your payment method, view invoices, or cancel — in our secure billing portal.
```

- [ ] **Step 7: Run the full web test suite**

Run: `pnpm --filter web exec vitest run`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/web/app/components/UpgradeModal.tsx apps/web/app/components/AddDeptModal.tsx apps/web/app/components/TopupModal.tsx apps/web/app/components/CreditsWidget.tsx apps/web/app/dashboard/page.tsx apps/web/app/dashboard/settings/page.tsx
git commit -m "feat(billing): point UI call sites at /api/billing/* and surface billing_not_configured"
```

---

## Task 9: Legal copy — stop naming Stripe

**Files:**
- Modify: `apps/web/app/privacy/page.tsx:56,66,88`
- Modify: `apps/web/app/terms/page.tsx:107,140`

- [ ] **Step 1: privacy/page.tsx**

Replace line 56 (in the "What we collect" list):

```tsx
              <li><strong style={{ color: "#F0F0F8" }}>Subscription data</strong> — your plan, billing status, and payment-processor customer ID (we never store your card details).</li>
```

Replace line 66 (in the "How we use it" list):

```tsx
              <li>To process subscription payments via our payment processor.</li>
```

Replace line 88 (in "Who we share data with"):

```tsx
              <li><strong style={{ color: "#F0F0F8" }}>Our payment processor</strong> — to process subscription payments. It handles all card data directly.</li>
```

- [ ] **Step 2: terms/page.tsx**

Replace line 107 (in "Subscriptions and billing"):

```tsx
              <li>Subscriptions are billed monthly or annually via our payment processor.</li>
```

Replace line 140 (in "Service availability"):

```tsx
              Planned maintenance, third-party outages (Anthropic, our payment processor, Railway, etc.), or other
              circumstances may cause temporary unavailability.
```

- [ ] **Step 3: Confirm no other Stripe mentions remain in legal copy**

Run: `grep -in stripe apps/web/app/privacy/page.tsx apps/web/app/terms/page.tsx`
Expected: no output (empty)

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/privacy/page.tsx apps/web/app/terms/page.tsx
git commit -m "docs(legal): stop naming Stripe specifically in privacy/terms copy"
```

---

## Task 10: Final gate — whole-feature verification

**Files:** none (verification only)

- [ ] **Step 1: Confirm no remaining reference to the deleted `/api/stripe/*` or `/api/setup/stripe` or `/api/connectors/stripe` routes anywhere in the app**

Run: `grep -rn "/api/stripe/\|/api/setup/stripe\|/api/connectors/stripe" apps/web/app apps/web/__tests__ --include=*.ts --include=*.tsx`
Expected: no output (empty)

- [ ] **Step 1b: Confirm the `stripe_events` collection row-rules tests are unaffected**

Per spec §5, `stripe_events` itself is UNCHANGED (still exists, admin-only, ready for a future provider's idempotency ledger) — confirm rather than assume:

Run: `grep -n "stripe_events" apps/web/__tests__/admin/repair-row-rules.test.ts apps/web/__tests__/admin/verify-row-rules.test.ts`
Expected: both files still reference `stripe_events` in their collection baseline/assertions. Run `pnpm --filter web exec vitest run __tests__/admin/repair-row-rules.test.ts __tests__/admin/verify-row-rules.test.ts` and confirm PASS with no edits needed. If either fails, it means something in this plan unexpectedly touched collection counts — investigate before proceeding, do not just edit the test to match.

- [ ] **Step 2: Confirm the `stripe` package is gone from the lockfile**

Run: `grep -c "'stripe@" pnpm-lock.yaml || true`
Expected: `0`

- [ ] **Step 3: Run the full web test suite one more time**

Run: `pnpm --filter web exec vitest run`
Expected: PASS, 0 failures

- [ ] **Step 4: Run the typecheck**

Run: `pnpm --filter web exec tsc --noEmit`
Expected: PASS, 0 errors

- [ ] **Step 5: Confirm `STRIPE_PUBLISHABLE_KEY` (already-dead per inventory) isn't referenced anywhere either**

Run: `grep -rn "STRIPE_PUBLISHABLE_KEY" apps/web --include=*.ts --include=*.tsx`
Expected: no output (empty) — if it IS referenced somewhere the earlier inventory missed, leave it; this is a confirmation step, not a task to act on unless something surfaces.

- [ ] **Step 6: Merge to main and push**

```bash
git checkout main
git merge --ff-only remove-stripe-billing-provider
git push
```

If the merge isn't fast-forward (main moved), rebase the feature branch onto main first, re-run steps 1-4, then merge.
