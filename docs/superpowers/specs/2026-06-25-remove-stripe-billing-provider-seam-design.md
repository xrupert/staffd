# Remove Stripe, Introduce a `BillingProvider` Seam — Design

> SA-ratified 2026-06-25 by conversation (no separate design review needed —
> captured here for the audit trail, matching every other change this
> session). Pricing/plan definitions are UNTOUCHED — already fully decoupled
> from Stripe (verified: `plan-benefits.ts`, `generation/pricing.ts` have zero
> Stripe references). This is a payment-PROCESSOR removal only.

## 1. Problem

Stripe is called directly from 8 route files with no abstraction layer —
each independently constructs `new Stripe(key)`, with near-duplicate helper
code copy-pasted across them. SA is dropping Stripe for Paddle or Nickel.
Ripping Stripe out with no seam would just recreate the identical tangle
with a different vendor's name. There is no existing billing-provider
interface anywhere in the codebase (confirmed by direct search).

## 2. Decisions (SA-ratified, live conversation 2026-06-25)

1. Introduce ONE thin `BillingProvider` interface covering the actions the
   app genuinely needs against some processor: create a checkout session,
   create a portal session, cancel a subscription. Stripe's SDK usage is
   deleted entirely — no Stripe code kept "just in case."
2. In its place: a stub provider that throws/returns a clear, structured
   "no billing provider configured" response — the app builds and runs
   clean; checkout/billing is honestly non-functional until a real provider
   implements the interface. This is the accepted, explicit consequence.
3. **The webhook route and `/api/setup/stripe` are DELETED, not adapted.**
   Signature verification schemes and event payload shapes differ
   meaningfully per provider (Stripe vs Paddle vs Nickel) — inventing a
   generic "webhook event" abstraction for providers not yet chosen risks
   guessing wrong and redoing it later. A fresh webhook route gets built
   when the real provider is picked, writing to the same PB collections.
   Provider catalog/SKU provisioning (`/api/setup/stripe`) is inherently
   per-provider — no generic replacement is needed now.
4. **The MRR/business-pulse connector (`/api/connectors/stripe`) is
   deleted**; its UI widget shows a clean "no billing provider connected"
   state instead of fetching a now-gone route.
5. **Route paths move from `/api/stripe/*` to `/api/billing/*`** — a
   mechanical rename (Next.js route folders, no stored data involved, zero
   migration risk) that finishes the job of "remove Stripe for everything,"
   not just the SDK calls.
6. **PocketBase schema fields are NOT renamed** (`stripe_customer`,
   `stripe_sub_id`, `ceo_addon_sub`, etc. stay as-is). Renaming would require
   a real data migration on live subscriber rows for zero functional gain
   right now — out of scope, noted as an optional future cleanup once a real
   replacement provider is chosen and its own field names are known.
7. **Legal copy** (`/privacy`, `/terms`) gets a pass to stop naming Stripe
   specifically, replaced with generic "our payment processor" language.
8. **Bonus fix, same pass:** `account/delete/route.ts`'s
   `cancelStripeSubscription` reads a field name (`stripe_subscription_id`)
   that doesn't match the real schema field (`stripe_sub_id`) — a real,
   pre-existing bug (subscription cancellation on account deletion silently
   no-ops). Fixed as a one-line correction while already in that function,
   reported as its own commit — not conflated with the provider removal.

## 3. Architecture

### 3.1 `BillingProvider` interface

```ts
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
```

A `NullBillingProvider` implements this, throwing a `BillingNotConfiguredError`
(a distinguishable error type, not a bare string) from all three methods.

### 3.2 Route-by-route disposition

| Old route (Stripe SDK) | New route | Behavior |
| --- | --- | --- |
| `app/api/stripe/checkout` | `app/api/billing/checkout` | Calls `provider.createCheckoutSession(...)`; on `BillingNotConfiguredError`, returns 503 `{ error: "billing_not_configured" }` |
| `app/api/stripe/checkout-addon` | `app/api/billing/checkout-addon` | Same pattern |
| `app/api/stripe/checkout-ceo-addon` | `app/api/billing/checkout-ceo-addon` | Same pattern |
| `app/api/stripe/checkout-topup` | `app/api/billing/checkout-topup` | Same pattern |
| `app/api/stripe/portal` | `app/api/billing/portal` | Calls `provider.createPortalSession(...)`; same 503 pattern |
| `app/api/stripe/webhook` | — (deleted) | No replacement until a real provider is chosen |
| `app/api/stripe/checkout-pack` | — (deleted) | Already a 410-Gone stub before this change; genuinely dead |
| `app/api/setup/stripe` | — (deleted) | Provider-specific catalog provisioning; rebuilt fresh per future provider |
| `app/api/connectors/stripe` | — (deleted) | `BusinessPulseWidget` shows "not connected" instead |

Each surviving route keeps its EXACT request/response contract for the
`ok`/success path shape (so UI call sites don't need logic changes beyond
handling the new 503) — only the URL prefix changes and the internals now
go through `BillingProvider` instead of `new Stripe(...)`.

### 3.3 UI call-site updates

`UpgradeModal.tsx`, `AddDeptModal.tsx`, `TopupModal.tsx`, `dashboard/page.tsx`
(manage-subscription button + pending-plan auto-checkout), `settings/page.tsx`
(billing portal link) — update their fetch URLs from `/api/stripe/*` to
`/api/billing/*`, and handle a 503 `billing_not_configured` response with a
brand-voiced "Billing isn't connected yet — check back soon" message instead
of a raw/unhandled error. `CreditsWidget.tsx`'s comment referencing the old
redirect path gets updated to match. `BusinessPulseWidget.tsx` shows a
"No billing provider connected" empty state instead of fetching the deleted
connector route.

## 4. Error handling

- Every route calling into `BillingProvider` catches `BillingNotConfiguredError`
  specifically and returns 503 with a stable `{ error: "billing_not_configured" }`
  shape — never a raw 500 or an unhandled throw.
- `account/delete/route.ts`'s cancellation call: with no real provider
  configured, `provider.cancelSubscription(...)` will also throw
  `BillingNotConfiguredError` — the account-delete flow catches this and
  proceeds with deletion anyway (a missing/uncancellable subscription must
  never block a user from deleting their account) — same
  fail-open posture used elsewhere tonight for non-critical side effects.

## 5. Testing (TDD, RED → GREEN)

- `BillingProvider`/`NullBillingProvider`: pure unit tests — every method
  throws `BillingNotConfiguredError`.
- Each surviving route (`billing/checkout`, `checkout-addon`,
  `checkout-ceo-addon`, `checkout-topup`, `billing/portal`): update the
  existing Stripe-mocking tests to mock `BillingProvider` instead, asserting
  the 503 `billing_not_configured` path (since no real provider exists yet)
  and that auth/eligibility checks upstream of the provider call are
  unchanged (Standard #39 — session-derived user id, never a body `userId`).
- Delete tests for genuinely-removed routes (`stripe-webhook-topup`,
  `stripe-setup-topups`, `connectors-stripe`, `checkout-pack-guard` — the
  routes they test no longer exist).
- `account/delete.test.ts`: fix the field-name assertion to use the real
  schema field; add a case confirming deletion proceeds even when
  cancellation fails (fail-open).
- Row-rules tests (`verify-row-rules.test.ts`, `repair-row-rules.test.ts`)
  that assert a collection count including `stripe_events`: `stripe_events`
  itself is UNCHANGED (still exists, still admin-only, ready for whatever
  the next provider's idempotency ledger needs) — these tests should not
  need to change. Confirm this at implementation time; do not assume.

## 6. Out of scope

- Actually integrating Paddle or Nickel (a future, separate piece of work
  once SA picks one).
- Renaming PocketBase schema fields (§2.6).
- Touching `plan-benefits.ts` / `generation/pricing.ts` or any dollar
  amount/plan-tier definition anywhere.
- Deduplicating the hand-copied dollar figures across `UpgradeModal.tsx` /
  `TopupModal.tsx` (pre-existing hygiene issue, unrelated to this removal).
