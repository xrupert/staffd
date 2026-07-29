# Paddle Billing — Operator Setup Runbook

> PR-Paddle-A wires Paddle behind the BillingProvider seam (overlay
> checkout + webhook entitlement sync). Until every step below is done,
> billing surfaces keep failing closed with `503 billing_not_configured`
> — that is by design.

## 1. Accounts

- **Sandbox** (development): sign up at https://sandbox-vendors.paddle.com/
- **Live**: https://vendors.paddle.com/ (requires business verification —
  start it early, approval takes days)

Sandbox and live are completely separate — products, prices, keys, and
webhook secrets from one do not exist in the other.

## 2. Keys & env vars

From **Paddle → Developer tools → Authentication**:

| Env var | Where | What |
|---|---|---|
| `PADDLE_API_KEY` | Vercel (Sensitive) + local `.env.local` | Server-side API key (`pdl_sdbx_...` / `pdl_live_...`). Its presence is what switches `getBillingProvider()` from Null to Paddle. |
| `NEXT_PUBLIC_PADDLE_CLIENT_TOKEN` | Vercel + `.env.local` | Client-side token (`test_...` / `live_...`) — safe to expose; Paddle.js needs it. |
| `NEXT_PUBLIC_PADDLE_ENV` | Vercel + `.env.local` | `sandbox` or `production`. |
| `PADDLE_PRICES` | Vercel + `.env.local` | JSON map printed by the seed script (step 3). |
| `PADDLE_NOTIFICATION_WEBHOOK_SECRET` | Vercel (Sensitive) | From the notification destination (step 4). Webhook returns 503 until set (fail-closed). |
| `PADDLE_SANDBOX_API_KEY` | local shell env | Same value as sandbox `PADDLE_API_KEY` — activates the `paddle-sandbox` MCP server in Claude Code sessions. |

Also under **Paddle → Checkout → Checkout settings**, set the **default
payment link** (sandbox: `https://localhost/` is fine). Domains are
auto-approved in sandbox; live requires website approval.

## 3. Seed the catalog

```bash
cd apps/web
PADDLE_API_KEY=pdl_sdbx_... node scripts/paddle-seed-catalog.mjs
```

Idempotent (matches products by name, prices by `custom_data.staffd_key`).
It prints the `PADDLE_PRICES` JSON — set it in Vercel env and redeploy.

Price keys: `starter|growth|pro|agency` × `_monthly|_annual`,
`dept-addon_monthly`, `ceo-addon_monthly`, `cinema-10_once`, `cinema-30_once`.

## 4. Webhook destination

In **Paddle → Developer tools → Notifications**, create a destination:

- URL: `https://urstaffd.com/api/webhooks/paddle`
- Events: `subscription.created`, `subscription.activated`,
  `subscription.updated`, `subscription.canceled`, `transaction.completed`
- Copy the destination's secret → `PADDLE_NOTIFICATION_WEBHOOK_SECRET` in
  Vercel → redeploy.

Delivery contract: only 2xx counts; Paddle retries everything else
(sandbox ~3 attempts / live ~60 over 3 days) with the same event id.
Dedup lives in the `billing_events` PB collection (unique `event_id`).

## 5. PB migration

Run the **Billing events (Paddle dedup)** migration from
`/dashboard/admin/migrations` (or
`curl -X POST -H "x-setup-secret: ..." https://urstaffd.com/api/setup/billing-events`).
The `subscriptions` setup route auto-adds `paddle_customer`,
`paddle_sub_id`, `cinema_pack_topups` on next dashboard load (or run it
from the same page).

## 6. Sandbox end-to-end test

1. Open `/pricing` logged in, pick a plan → the Paddle overlay opens.
2. Pay with the sandbox test card `4242 4242 4242 4242`, any future
   expiry, any CVC.
3. Confirm the webhook fired (Paddle → Notifications → logs) and the PB
   `subscriptions` row now has `plan`, `paddle_customer`, `paddle_sub_id`.
4. Settings → "Manage subscription" opens the Paddle customer portal.
5. Cancel in the portal → `subscription.canceled` reverts plan to
   starter at period end.
6. Buy a Cinema pack via the top-up modal → `transaction.completed`
   increments `cinema_pack_topups`.

## 7. Go-live checklist

- Live account verified + website approved
- Re-run the seed script with the live key (`PADDLE_ENV=production`)
- Live webhook destination + secret
- Swap all env vars to live values, `NEXT_PUBLIC_PADDLE_ENV=production`
- One real transaction end-to-end, then refund it from the Paddle dashboard
