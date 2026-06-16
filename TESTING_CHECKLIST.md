# STAFFD — Pre-Demo Testing Superchecklist
> **The master manual-test pass before any demo.** Living document — grows as features ship.
> Goal: prove the entire system does what it's supposed to, with special focus on everything
> that can only be verified by a human in a real, logged-in production session.

## Legend
- ✅ **VERIFIED (Claude)** — unit-tested + typecheck + production build. Logic is correct; end-to-end still needs a human click.
- 🔲 **NEEDS HUMAN TEST** — auth-gated UI, live LLM behavior, integration round-trip, payment, delivery, or cron. **Claude cannot test these.** Steps + expected result given.
- ⚙️ **OPERATOR SETUP** — an env var / external config that must be in place first.

> How to use: work top to bottom in production (`urstaffd.com`), logged in as the demo account.
> Check each box. If a 🔲 fails, paste the result back and we fix it before demo.

---

## 0. Pre-flight (operator setup)
- ⚙️ `ADMIN_SECRET` set in Vercel (setup routes are fail-closed without it) — ✅ done
- ⚙️ `NEXT_PUBLIC_ADMIN_EMAIL=chris.rupert@cybridagency.com` in Vercel — ✅ done
- ⚙️ Google OAuth2 provider enabled in PB admin — ✅ done
- ⚙️ Integrations env vars (Twenty/Chatwoot/Listmonk/Docuseal) in Vercel — ✅ done, all 🟢
- 🔲 **Demo account industry is set** in the Vault (currently blank on the comp account). Set it so routing picks the most on-target specialist. Steps: Dashboard → Vault → set Industry → Save.

---

## 1. Public / unauthenticated
- 🔲 **Landing page** (`/`) renders, new design, CTAs work. Expected: hero + "Get STAFFD", pricing/links in footer.
- 🔲 **Pricing page** (`/pricing`) — 4 plans, monthly/annual toggle, per-department counts correct (Marketing 16 … CEO 8 = 83). CTAs link to signup with plan param.
- 🔲 **Signup with email** (`/auth/signup`) — create account → lands in `/onboarding`.
- 🔲 **Google sign-in** (`/auth/signup` + `/auth/login`) — "Continue with Google" → consent → **new user lands in `/onboarding`, returning user in `/dashboard`**. (Claude built the flow ✅; the live OAuth round-trip is human-only.)
- 🔲 **Login with email** (`/auth/login`) → `/dashboard`.

## 2. Onboarding (✅ already built — verify it still flows)
- 🔲 6 steps: website auto-fill → industry picker (required) → focus → bottlenecks → situation → superpower → magic wand → results screen → dashboard.
- 🔲 Website auto-fill: enter a real URL → "Pull info" populates business name/description/audience.
- 🔲 Re-running onboarding updates the existing business record (no duplicate).

## 3. Command Center — routing + generation (live LLM 🔲)
- 🔲 **Routing accuracy**: type 5 varied tasks; each routes to a sensible dept + specialist. Examples:
  - "write a cold outreach email for property managers" → **Sales → Outreach** ✅ (confirmed)
  - "draft an NDA for a contractor" → **Legal**
  - "write 5 Instagram captions for a sale" → **Marketing**
  - "build a 90-day growth plan" → **CEO** (Pro/Agency) or upsell
  - "create an invoice for a $2,500 job" → **Finance**
- 🔲 **No vertical pollution** (routing fix `routablePacksFor`, ✅ shipped): on the comp account with no industry, an unrelated vertical specialist (e.g. real-estate Listing Promoter) must NOT win an off-vertical task.
- 🔲 **Multi-turn continuity** (W70.2 fix `condenseForOrchestrator`, ✅ shipped): turn 2/3 routes to the *new* request's dept, not the prior one. Test: ask Marketing thing, then "now draft an NDA" → should go Legal, not Marketing.
- 🔲 **Streaming output** renders progressively; Copy works; document saves to Library.

## 4. Action affordances / integration buttons (FC-2a — live LLM analyzer 🔲)
> ✅ Claude verified: vocabulary, UI labels, dispatcher wiring, gate logic (`shouldFetchAffordances`). 🔲 The analyzer producing candidates is a live Claude call — human-only.
- 🔲 **Buttons appear** under a finished deliverable (scroll below the output to "Your staff can take it from here"). KNOWN RISK: if the W62 analyzer returns zero candidates (see W70.1), no buttons show even on good output — **this is the #1 thing to verify live.**
- 🔲 **"📇 Add to CRM →"** → creates a Twenty opportunity → posts "View in CRM" link → opportunity actually exists in Twenty.
- 🔲 **"📧 Send as campaign →"** → creates a Listmonk **draft** → posts "Review the draft" link → draft actually exists in Listmonk.
- 🔲 **"🎫 Open support ticket →"** (FC-2b) → recipient modal (name + email) → creates a Chatwoot conversation with this reply → posts "Open the conversation" link → ticket exists in Chatwoot.
- 🔲 **"✍️ Send for signature →"** (FC-2b) → recipient modal (signer name + email) → creates a Docuseal submission → signer gets an email → posts "Signing link".
- 🔲 **"📄 Export as document →"** / **"✉️ Draft the email →"** / **"🗓️ Schedule a follow-up →"** / media buttons — each fires its handler.
- 🔲 If the analyzer returns no candidates on clearly-actionable work → **investigate W70.1** (analyzer prompt / thresholds).

## 5. Smart Search (MX-4 — auth-gated 🔲)
> ✅ Claude verified: API (whoAmI-secured, mapping, tests), page renders, library entry point.
- 🔲 `/dashboard/search` — search a phrase that matches prior work → ranked results with dept badge + % match.
- 🔲 Document results link to the doc and open it.
- 🔲 New account with empty vault → graceful empty/degraded state (no error).
- 🔲 "Try Smart Search →" link on `/dashboard/library` works.

## 6. Integrations — read + health (FC-1 + MX-8)
> ✅ Claude verified: read-route mapping, health classifier. 🔲 Live round-trips human-only.
- 🔲 **Admin health panel** (`/dashboard/admin`) — all four 🟢 Connected (✅ confirmed once; re-check before demo).
- 🔲 **Read routes return live data** (need a logged-in fetch or agent context): Twenty opportunities, Chatwoot open tickets, Listmonk campaign stats.
- 🔲 **Docuseal** write (signature) still works from wherever it's surfaced.

## 7. Billing / Stripe (payments 🔲 — never auto-tested)
- 🔲 Upgrade flow: Starter → Pro checkout → Stripe → success → plan reflects in dashboard.
- 🔲 Department add-on / CEO add-on / pack add-on checkout.
- 🔲 Credit top-up (image/video) → credits increase after success.
- 🔲 Webhook idempotency: a re-delivered event doesn't double-apply.
- 🔲 Customer portal link (Settings) opens Stripe portal.
- 🔲 Cancellation → reverts to starter at period end.

## 8. Credits & generation (🔲)
- 🔲 Image generation (Design) deducts 1 image credit on success; fails gracefully at 0.
- 🔲 Video generation deducts 1 video credit.
- 🔲 Comp account shows "Unlimited" and never sees "out of credits".
- 🔲 Low-credits banner appears near threshold (non-comp).

## 9. Delivery (email / push 🔲)
- ⚙️/🔲 **Signup verification email** actually arrives (PB SMTP). Critical — test with a fresh address.
- 🔲 **Password reset email** arrives + resets.
- 🔲 **Push notifications** opt-in (Settings) → a test push arrives.
- 🔲 **Morning brief** push/delivery respects timezone + quiet hours.

## 10. Cron / workers (prod-only 🔲)
- 🔲 **Workflow drain** (`/api/worker/workflow-drain`, every min) processes W71 tasks (run T17 after W71.fix — ✅ collections repaired). 
- 🔲 **Vault ingestion** (`/api/worker/vault`) — documents get embedded + searchable (ties to Smart Search).
- 🔲 **Morning brief** (6 AM UTC) generates.
- 🔲 **Security audit** (2 AM UTC) runs clean.

## 11. Admin / super-admin (auth-gated 🔲)
- 🔲 "Admin" nav entry visible only to super-admin (✅ built; needs `NEXT_PUBLIC_ADMIN_EMAIL` — done).
- 🔲 "View Dashboard As" plan switcher changes presentation only (not real credits/billing).
- 🔲 Multi-Tenant Security + Vault Metrics panels load.
- 🔲 **STAFFD Pulse widget** (admin) — shows STAFFD's live MRR + active subscription count from Stripe (super-admin gated; operator metric, not per-customer). Non-admin / unauth → "Super-admin only".
- 🔲 Setup routes: `curl -X POST -H "x-setup-secret: $ADMIN_SECRET" .../api/setup/<name>` works; **without the header → 503** (✅ fail-closed verified live once).

## 12. Agency / multi-tenant (🔲)
- 🔲 Agency plan: create a client, switch to it, generate work scoped to that client.
- 🔲 Client A's documents never appear under Client B (row-rule isolation).

## 13. Security spot-checks (✅ Claude hardened; 🔲 confirm behavior)
- ✅ pbEscape applied to all user-controlled PB filters (codebase-wide).
- 🔲 A crafted `userId`/`slug` with a quote doesn't leak other users' data (e.g. booking slug, clients list).

---

## Known open items to resolve before demo
1. **W70.1 — analyzer returns zero action candidates** → gates whether ANY action button appears. Now **instrumented + diagnosable** (commit `e17db83`).
   **Diagnostic procedure (live):**
   - **Sharp test:** generate an artifact that maps *cleanly* to an action — e.g. Legal → "draft an NDA for a contractor" (→ expect **✍️ Send for signature** + **📄 Export**), or Marketing → "write a product launch newsletter" (→ expect **📧 Send as campaign**). If buttons appear here, the pipeline works and the earlier cold-email simply didn't map (that's correct behavior).
   - **If buttons still don't appear**, read the Vercel runtime log for the `[W62-analyzer]` line right after the generation:
     - `kept=0/3 ... raw=[...,"confidence":0.5,...]` → mapped weakly, below the 0.6 threshold → consider lowering threshold or sharpening the action definitions.
     - `kept=0/0 ... raw=[]` → the model judged the work non-actionable (expected for templates / informational work).
     - `no JSON array in response ...` → a format/parse issue in the analyzer → real bug, fix the prompt/parse.
   - Where: Vercel → project → **Logs** (or Deployments → Functions) → filter `[W62-analyzer]`.
2. **FC-2b** — Chatwoot "Open support ticket" + Docuseal "Send for signature" buttons (recipient modal) — in progress.
3. **Demo account industry** — set it so routing is maximally on-target.

---
_Last updated: 2026-06-15. Append new features here with ✅/🔲 tags as they ship._
