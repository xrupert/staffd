# STAFFD — Execution Tracker
> **The single living source of truth for what's left to build, in what order, in how many hours.**
> Every new CC session: read this file first. Update status as work completes.
> Do NOT use this for architecture decisions — that's `ARCHITECTURE.md`. This is the punch list.
>
> Last updated: 2026-06-15 | Audit baseline: Phase 1-4 comprehensive audit

---

## STATUS KEY
- ✅ DONE — shipped and verified
- 🔄 IN PROGRESS — current session
- ⬜ NOT STARTED
- 🚫 BLOCKED — has a dependency (noted inline)
- ⏭ DEFERRED — deliberately postponed

---

## AGENT REGISTRY — AUTHORITATIVE COUNT
> Verified against code 2026-06-15. Do not re-derive; reference this.

| Layer | Count | Notes |
|---|---|---|
| Generic department agents | **83** | 16 Marketing, 10 Sales, 6 Legal, 4 HR, 7 Finance, 12 Operations, 7 Paid Media, 8 Design, 5 Reputation, 8 CEO. Verified in `packages/agents/src/departments/*.ts` |
| Industry-packed agents | **63** | Across 8 packs: Law, Real Estate, Restaurants, Coaches, Trades, Salons, Agencies, Consultants. Verified in `packages/agents/src/packs/*.ts` |
| **`allAgents` total** | **146** | Flat pool, brand-laws applied. `getAgent(id)` resolves all 146. |

**Why public pages say "83":** `getDepartmentAgents()` returns generic agents only by default. Pack agents are **entitlement-gated** (W54.1) — they enter a roster only when the user owns that pack. So 83 = what every user gets out of the box; 146 = total in code. Both correct.

**Stale numbers to ignore:** The Phase 1 audit said "138 (83+55)" — the 55 was an Explore-subagent undercount; real pack count is 63. Memory's "195" = the original agency-agents source pool, consolidated down to 146 during adaptation (not a loss).

**Pricing + landing page per-dept counts:** verified accurate and matching code (2026-06-15).

---

## CONTEXT POINTERS
> Fast-access file map for any fresh session. Read these before touching related code.

| Area | Key Files |
|---|---|
| Agent library | `packages/agents/src/departments/`, `packages/agents/src/packs/` |
| Core agent route | `apps/web/app/api/agent/route.ts` |
| Orchestrator | `apps/web/app/api/orchestrate/route.ts`, `apps/web/app/api/orchestrator/route.ts` |
| Task bus (W71) | `apps/web/app/api/workflow/`, `apps/web/lib/workflow.ts` |
| PocketBase helpers | `apps/web/lib/pb.ts`, `apps/web/app/api/_lib/pb.ts` |
| Row rules (security) | `apps/web/app/api/_lib/security/row-rules.ts` |
| Billing | `apps/web/app/api/stripe/` |
| Credits | `apps/web/app/api/credits/route.ts`, `apps/web/app/api/_lib/credits.ts` |
| Trial gate | `apps/web/app/api/_lib/trial.ts` |
| Comp override | `apps/web/app/api/_lib/comp.ts` — COMP_EMAILS exported (W71.5) |
| Vault (Qdrant) | `apps/web/lib/qdrant.ts`, `apps/web/lib/ingest.ts` |
| Dashboard | `apps/web/app/dashboard/page.tsx` |
| Dept room | `apps/web/app/components/DepartmentRoom.tsx` |
| Command Center | `apps/web/app/components/CommandCenter.tsx` |
| Admin page | `apps/web/app/dashboard/admin/page.tsx` |
| Effective plan hook | `apps/web/lib/hooks/useEffectivePlan.ts` (W71.5) |
| Auth / signOut | `apps/web/lib/auth/signOut.ts` (W71.5) |
| Integrations | `apps/web/app/api/integrations/` |
| Setup routes | `apps/web/app/api/setup/` |
| Vercel crons | `vercel.json` (6 crons: vault, workflow-drain, morning-brief, brief-push-dispatcher, security-audit, scheduled) |
| Tests | `apps/web/__tests__/`, `packages/agents/__tests__/` |
| Env vars | See Section 5 for full required list |

---

## SECTION 1 — ACTIVE STATE

### Last completed work
- **Landing page full redesign** — `apps/web/app/page.tsx` rebuilt: sticky nav, hero + product mock, How It Works, all 10 departments, 4 feature highlights, pricing callout, trust section, final CTA, proper footer. Zero console errors. 476/477 tests still green.
- **W71.5** — Super-admin dogfooding pack (commit `9737e8a`)
  - `COMP_EMAILS` exported, `chris.rupert@cybridagency.com` added
  - Admin nav button in `dashboard/page.tsx` (visible when `isSuperAdminClient()` = true)
  - `useEffectivePlan()` hook + `staffd_view_as_plan` localStorage key
  - "View Dashboard As" radio card in `/dashboard/admin`
  - Shared `signOut()` helper clearing `staffd_view_as_plan`
  - Test floor: 476/477 passed (1 skipped)

### Current blockers
- **W71.fix PB reconciliation** — `rules: "failed"` on `/api/setup/workflow-tasks` (field name `user_id` vs `user` on PB `workflows` + `workflow_tasks` collections). Blocks W72.
- **NEXT_PUBLIC_ADMIN_EMAIL** not set in Vercel — Admin nav hidden in production until this is set.

### W72 status
- **BLOCKED** on W71.fix PB reconciliation completing first

### ✅ INTEGRATIONS VERIFIED LIVE (2026-06-15)
Confirmed green in production via the admin health panel: **Twenty 🟢 · Chatwoot 🟢 · Listmonk 🟢 · Docuseal 🟢**.
(Twenty URL fixed to server origin; Listmonk migrated to an API user token.) All read routes + write routes now have working credentials in prod.

### ⚠️ DEPLOYMENT STATUS (2026-06-15)
**Everything built this session is LOCAL and uncommitted** — landing redesign, T1-1→T1-8, pbEscape
standardization, Smart Search, Google OAuth, FC-1 read integrations, integrations health-check.
None of it is live on urstaffd.com until committed + pushed (Vercel auto-deploys `main`).
To test the integrations in prod (and to demo any of this), these changes must be pushed first.

---

## SECTION 2 — TIER 1: CRITICAL FIXES
> Must ship before scaling user acquisition. ~20h total.

| ID | Item | Hours | Status | Depends On | Key Files |
|---|---|---|---|---|---|
| T1-1 | W71.fix: PB reconciliation (delete wrong collections, re-run setup route, verify T17) | 0.5h | ✅ 2026-06-15 | — | `/api/setup/workflow-tasks` |
| T1-2 | Vercel: set `NEXT_PUBLIC_ADMIN_EMAIL=chris.rupert@cybridagency.com` | 0.1h | ⬜ **USER ACTION** | — | Vercel dashboard |
| T1-3 | W70.2: Orchestrator thread-continuity regression (turns 2/3 wrong dept) | 8h | ✅ 2026-06-15 | — | `CommandCenter.tsx` — `condenseForOrchestrator()` drops coordinator stubs + truncates deliverables so latest user msg drives routing. +7 tests. |
| T1-4 | Groq → Anthropic fallback on error (catch Groq fail, fall through to Haiku) | 1h | ✅ 2026-06-15 | — | `/api/agent/route.ts` — on Groq throw, reassign `choice` to Anthropic Haiku + fall through. +2 tests. |
| T1-5 | Muapi credit post-confirm deduction (deduct AFTER API success, not before) | 2h | ✅ 2026-06-15 | — | ALREADY CORRECT — `spendCredits` fires only after confirmed `resultUrl` (route.ts:398/414). Audit misread; no change needed. |
| T1-6 | pbEscape() audit (grep all filter strings for unescaped user-controlled input) | 2h | ✅ 2026-06-15 | — | Fixed 6 injection vectors: `clients` (×2), `departments/choose`, `stripe/portal`, `stripe/checkout-topup`, `book/[slug]` + `availability` (public path!). +4 pbEscape contract tests. |
| T1-6b | pbEscape() codebase-wide standardization (defense-in-depth follow-up) | 1h | ✅ 2026-06-15 | T1-6 | A better grep caught sites the `filter=`-only grep missed. Escaped ALL remaining interpolations: `stripe/webhook` (9), `stripe/checkout` + `checkout-addon` + `checkout-ceo-addon` (userId from body — **were also injectable**), `credits.ts`, `vault/outcomes.ts`, `book` host.user (×2), and converted 4 manual `.replace(/"/g,…)` sites (`account/delete`, `account/export-data`, `vault/patterns/list`, `setup/users`) to single-quote + pbEscape. Whole codebase now uses one convention. Updated 2 test mocks. |
| T1-7 | Vault dead-letter queue (add retry_count + last_error to vault_queue; skip after 3 fails) | 6h | ✅ 2026-06-15 | — | ALREADY IMPLEMENTED — `vault_ingest_queue` has attempts + last_error + exp-backoff + terminal `dead` after MAX_ATTEMPTS=5 (`_lib/vault/queue.ts`). Worker routes all failures through `fail()`. Audit misread; no change needed. |
| T1-8 | Setup routes auth protection (require ADMIN_SECRET header on all `/api/setup/*`) | 3h | ✅ 2026-06-15 | — | `middleware.ts` gates `/api/setup/:path*` via `_lib/setup-auth.ts` `checkSetupAuth()`. **Fail-closed**: 503 if `ADMIN_SECRET` unset, 401 if wrong. Verified live (503). +6 tests. |

**Tier 1 total: ~22.6h**

---

## SECTION 3 — TIER 2: FEATURE COMPLETION
> Closes the obvious product gaps. ~109h total.

| ID | Item | Hours | Status | Depends On | Key Files |
|---|---|---|---|---|---|
| FC-1a | Read integration: Twenty CRM (`GET /api/integrations/twenty?type=opportunities`) | 6h | ✅ 2026-06-15 | — | GET added; GraphQL→flat list; env read in-handler; 503/502 handled. +3 tests. |
| FC-1b | Read integration: Chatwoot (`GET /api/integrations/chatwoot?status=open`) | 6h | ✅ 2026-06-15 | — | GET added; conversation payload→flat list w/ deep links. +3 tests. |
| FC-1c | Read integration: Listmonk campaign stats (`GET /api/integrations/listmonk?campaign_id=X`) | 8h | ✅ 2026-06-15 | — | GET added; campaign→stats summary (sent/views/clicks/bounces). +4 tests. |
| FC-1d | Wire reads into agent context via `AgentCapability` (auto-inject pipeline/tickets/stats into prompts when agent declares `reads_crm`/`reads_support_history`/`reads_email_campaigns`) | 8h | ⬜ FOLLOW-UP | FC-1a/b/c | Touches `/api/agent` (§5-sensitive) — deferred for careful design. Read APIs above are usable now by UI / action candidates. |
| FC-2a | Action vocabulary +2 integration actions (`send_to_crm`→Twenty, `send_email_campaign`→Listmonk) wired in CommandCenter | 7h | ✅ 2026-06-15 | FC-1 | SA-authorized vocabulary growth (6→8); updated 3 locked pins; zero-input handlers fire to connected write routes w/ result message. +1 wiring test. |
| FC-2b | `open_support_ticket`→Chatwoot + `send_for_signature`→Docuseal, with a shared recipient-email modal, wired in CommandCenter | 7h | ✅ 2026-06-15 | FC-2a | Vocabulary 8→10 (pins updated); new `ActionRecipientModal`; handlers POST to chatwoot/docuseal w/ result message. Wiring test extended. |
| FC-2c | Wire `useActionDispatcher` into DepartmentRoom (HandoffPanel already renders affordances there, but clicks have no handlers) | 4h | ⬜ FOLLOW-UP | FC-2a/b | `DepartmentRoom.tsx` |
| FC-3 | W63: Outcome auto-ingestion (post-write integration call → create `vault_decisions` record) | 5h | ✅ 2026-06-16 (Twenty+Docuseal) | — | Twenty→`lead_added`, Docuseal→`contract_sent_for_signature` recorded on success (userId-gated, fire-and-forget) via `recordDecision`. +2 tests. |
| FC-3b | Same for Listmonk (`campaign_drafted`) + Chatwoot (`support_ticket_opened`) | 2h | ✅ 2026-06-16 | FC-3 | All 4 integration writes now record vault outcomes (userId-gated). Outcome loop complete. |
| FC-4 | Google OAuth (enable PB OAuth2 provider + "Continue with Google" button in login UI) | 6h | ✅ 2026-06-15 (code) / ⬜ **OPERATOR: enable Google in PB admin** | — | New shared `GoogleAuthButton.tsx` on login + signup; `authWithOAuth2`; new user → onboarding, returning → dashboard. Graceful "not enabled yet" message until PB config. +2 tests, browser-verified. |
| FC-5a | Autopilot: data reader worker (reads Stripe MRR + connected integration data → brief struct) | 10h | ⬜ | MS-A | `/api/worker/autopilot/route.ts` (new) |
| FC-5b | Autopilot: W71 task queue builder (brief struct → enqueue W71 tasks per dept) | 10h | ⬜ | FC-5a, T1-1 | `lib/workflow.ts`, `/api/workflow/enqueue/route.ts` |
| FC-5c | Autopilot: approval notification + UI (push notification with approve/skip per task) | 8h | ⬜ | FC-5b | `/api/push/send/route.ts`, new `/dashboard/autopilot` review page |
| FC-6a | Team workspaces: data model (add `workspace_id` to users + subscriptions + documents + conversations) | 10h | ⬜ | — | `/api/setup/` routes, row-rules registry |
| FC-6b | Team workspaces: invite flow (invite by email, accept link, join workspace) | 16h | ⬜ | FC-6a | `/api/workspace/invite/route.ts` (new), `/join/[token]` page |
| FC-6c | Team workspaces: shared vault scope (agency team shares client documents + conversation threads) | 10h | ⬜ | FC-6a | `/api/agent/route.ts`, `/api/vault/**` |

**Tier 2 total: ~109h**

---

## SECTION 4 — TIER 3: MOONSHOTS
> Excluding Moonshot 5 (outcome-indexed pricing — deferred) and MS-E (franchise OS — sales motion first).
> ~88h total.

| ID | Item | Hours | Status | Depends On | Key Files |
|---|---|---|---|---|---|
| MS-A | Stripe read connector (`/api/connectors/stripe`) + admin pulse widget | 6h | ✅ 2026-06-16 | — | GET (super-admin gated) returns active-sub count + MRR (annual→monthly normalized) from STAFFD's live Stripe. `BusinessPulseWidget` on `/dashboard/admin`. +4 tests. NOTE: reads STAFFD's OWN revenue (operator metric), not per-customer. |
| MS-B1 | Voice input: Web Speech API capture + Whisper fallback (client-side, CommandCenter) | 12h | ⬜ | — | `CommandCenter.tsx`, new `/api/voice/transcribe/route.ts` |
| MS-B2 | Voice output: Elevenlabs response playback (wire `voice_profile` collection to response stream) | 16h | ⬜ | MS-B1 | `/api/agent/route.ts`, `voice_profile` collection, `ELEVENLABS_API_KEY` (new env var) |
| MS-C1 | Marketplace Phase 1: internal pack builder tool (Cybrid Agency creates packs via UI) | 20h | ⬜ | — | `packages/agents/` pack schema, new `/dashboard/admin/packs` page |
| MS-C2 | Marketplace Phase 2: partner program infra (partner accounts, pack submission, review queue) | 16h | ⬜ | MS-C1 | New collections: `pack_submissions`, `pack_reviews` |
| MS-D1 | Client portal MVP: shareable read-only doc link (`/share/[token]`) | 8h | ⬜ | — | New `/share/[token]/page.tsx`, `documents` collection token field |
| MS-D2 | Client portal: revision request flow (comment → notify agency user → re-generate) | 10h | ⬜ | MS-D1 | New `document_comments` collection, notification plumbing |

**Tier 3 total: ~88h**

---

## SECTION 5 — MISSING (not in original audit)
> Gaps discovered post-audit. ~41h total.

| ID | Item | Hours | Status | Key Files / Notes |
|---|---|---|---|---|
| MX-1 | Error monitoring: Sentry install + wrap API routes (production error visibility) | 4h | ⬜ | `apps/web/next.config.ts`, `@sentry/nextjs` |
| MX-2 | SMTP verification: test PB email delivery (signup verify email + password reset) | 2h | ⬜ | PB admin SMTP settings; test with new account |
| MX-3 | Onboarding wizard: guided VaultContext population post-signup (name, industry, magic_wand, bottlenecks) | 12h | ✅ ALREADY BUILT | `/onboarding/page.tsx` — 6 steps, website auto-fill, industry picker, full VaultContext capture, agent recommendation, results screen. Verified 2026-06-15. |
| MX-4 | Document search UI: "search my vault" page using Qdrant semantic search already built | 8h | ✅ 2026-06-15 | NEW `POST /api/vault/search` (whoAmI-secured — userId from token, not body) + `/dashboard/search` page + Library entry point. Closes the pricing-page "Smart Search" promise. +5 tests, browser-verified render. |
| MX-5 | Push notification opt-in UI: Settings toggle to subscribe/unsubscribe device | 4h | ⬜ | `/dashboard/settings/page.tsx`, `/api/push/subscribe`, `/api/push/unsubscribe` |
| MX-6 | Mobile responsiveness audit: dashboard + DepartmentRoom on 390px viewport | 8h | ⬜ | `dashboard/page.tsx`, `DepartmentRoom.tsx` |
| MX-7 | Stripe customer portal: confirm `/api/stripe/portal` is linked in Settings UI | 1h | ✅ 2026-06-16 | Was missing — added a Billing section to `/dashboard/settings` with a "Manage billing →" button → Stripe customer portal (plan/card/invoices/cancel). |
| MX-8 | Integrations health-check (read-only auth probes for Twenty/Chatwoot/Listmonk/Docuseal) + live admin panel | 3h | ✅ 2026-06-15 | `GET /api/admin/integrations-health` (super-admin gated) + `IntegrationsHealthPanel` on `/dashboard/admin`. The one-click "are my integrations wired?" test. +5 tests. **Needs deploy to read prod creds.** |

**Missing total: ~39h**

---

## SECTION 6 — DEFERRED (deliberately not in scope)

| Item | Reason |
|---|---|
| Moonshot 5: Outcome-indexed pricing | SA not ready; pricing model review first |
| MS-E: Franchise OS pitch | Sales motion before product build; identify pilot franchise first |
| Elevenlabs voice fingerprinting | Deferred to after MS-B2 voice output ships |
| Plausible Analytics read integration | Low priority; internal product analytics after scale |
| Bundle 5 OCR/vision | Wait until a paying customer requests it |
| Bundle 7 scheduling/transcript | Wait for voice pipeline (MS-B) to complete first |
| super_admin_usage_log | Activate when user base justifies margin analysis |

---

## SECTION 7 — ENVIRONMENT VARIABLES

### Currently required (must be in Vercel)
```
NEXT_PUBLIC_POCKETBASE_URL=https://pocketbase-production-4774.up.railway.app
PB_ADMIN_EMAIL=chris.rupert@cybridagency.com
PB_ADMIN_PASSWORD=[in Railway secrets]
ANTHROPIC_API_KEY=[in Vercel]
STRIPE_SECRET_KEY=[in Vercel]
STRIPE_PRICES=[JSON map of plan_interval → price_id]
STRIPE_WEBHOOK_SECRET=[in Vercel]
QDRANT_URL=[in Vercel]
QDRANT_API_KEY=[optional]
GROQ_API_KEY=[optional — activates Groq routing if set]
CHATWOOT_URL / CHATWOOT_API_KEY / CHATWOOT_ACCOUNT_ID [optional]
DOCUSEAL_URL / DOCUSEAL_API_KEY [optional]
TWENTY_API_URL / TWENTY_API_KEY [optional]
LISTMONK_URL / LISTMONK_USERNAME / LISTMONK_PASSWORD [optional]
MUAPI_API_KEY / MUAPI_URL [optional]
ADMIN_IP=[for /admin IP gate]
```

### MISSING — must add now
```
NEXT_PUBLIC_ADMIN_EMAIL=chris.rupert@cybridagency.com   ← Admin nav hidden until this is set (T1-2) ✅ DONE
ADMIN_SECRET=<generate a long random string>            ← T1-8: REQUIRED. Setup routes are now FAIL-CLOSED.
```
> **⚠️ ADMIN_SECRET is now load-bearing.** As of T1-8, every `/api/setup/*` route is locked (503) until
> `ADMIN_SECRET` is set in Vercel. To run any setup route in production:
> `curl -X POST -H "x-setup-secret: $ADMIN_SECRET" https://urstaffd.com/api/setup/<name>`
> Generate the secret with e.g. `openssl rand -hex 32` and add it to Vercel env (all environments).

### Needed when shipping new features
```
ELEVENLABS_API_KEY          ← MS-B2 voice output
ADMIN_SECRET                ← T1-8 setup route protection (generate a secure random string)
SENTRY_DSN                  ← MX-1 error monitoring
```

---

## SECTION 8 — TEST FLOOR

| Milestone | Tests Passed | Notes |
|---|---|---|
| Pre-W71.5 | 469 | Baseline |
| Post-W71.5 (W71.5 commit 9737e8a) | 476/477 | 1 skipped |
| Post-T1-3 (W70.2 fix) | 483/484 | +7 routing-history tests, 1 skipped |
| Post-T1-4/5/6 | 489/490 | +2 Groq fallback, +4 pbEscape contract, 1 skipped |
| Post-T1-7/8 | 495/496 | +6 setup-auth contract, 1 skipped |
| **TIER 1 COMPLETE** | 495/496 | All 8 critical fixes shipped ✅ |
| Post-MX-4 (Smart Search) | 500/501 | +5 vault-search tests, 1 skipped |
| Post-FC-4 (Google OAuth) | 502/503 | +2 oauth-route tests, 1 skipped |
| Post-FC-1 (read integrations) | 512/513 | +10 read-integration tests, 1 skipped |
| Post-MX-8 (integrations health) | 517/518 | +5 classifier tests, 1 skipped |
| Post-FC-2a (CRM + campaign actions) | 518/519 | vocabulary 6→8 (SA-auth), +1 wiring test, pins updated |
| Post routing fix (vertical pollution) | 523/524 | +5 routablePacksFor tests |
| Post affordance-gate fix | 528/529 | +5 shouldFetchAffordances tests — buttons no longer suppressed by a trailing offer question |
| Post FC-2b (support + signature actions) | 528/529 | vocabulary 8→10 (SA-auth), recipient modal, pins + wiring test updated |
| Post analyzer observability (W70.1) | 528/529 | analyzer logs raw vs kept candidates — "no buttons" now diagnosable |
| Post dept keyword hint | 533/534 | +5 suggestDepartmentFromKeywords tests — NDA→Legal etc. no longer mis-route |
| Post analyzer-timeout + dept-override | 537/538 | analyzer 4s→7s (logs showed analyzer_deadline → empty); +4 resolveRoutedDept tests — keyword hint now AUTHORITATIVE |
| Post MS-A (Stripe read connector) | 541/542 | +4 connector tests — live MRR / active-sub pulse |
| Post MS-A widget + FC-3 | 543/544 | pulse widget (admin); +2 outcome-ingestion tests (Twenty/Docuseal → vault) |
| Post FC-3b + MX-7 | 543/544 | all 4 integration outcomes recorded; Settings → Manage billing (Stripe portal) |
| Post W80.1 + W80.1a (Cockpit) | 553/554 | Operations Home at /dashboard/cockpit (super-admin), 4 read-cards + augment chips + calendar strip; Plausible read (cached); operator reads gated super-admin; landing brand-voice fix. +10 tests |
| Post W80.2 (Email Campaigns native) | 564/565 | /dashboard/cockpit/campaigns list/detail/compose; Listmonk lists read + send/schedule PUT; +11 tests. Plus Plausible CE URL fix + middleware→proxy migration. |
| Post Cockpit→Front Desk rename | 564/565 | route + nav + 301 redirect; no test delta (rename only) |
| Post W80.3 (Site Analytics native) | 577/578 | /dashboard/front-desk/analytics: range toggles + headline + breakdowns + inline-SVG trend; Plausible route gains ?view=deep (2-tier range-keyed cache); +13 tests |
| Post W72 (Workflow object) + Plausible opt-out | 601/602 | parent Workflow lifecycle state machine + aggregate hook + drain reconcile + usage-log audit; super-admin Plausible opt-out; +24 tests |
| Post W92 (Usage Dashboard) | 624/625 | fleet-wide /dashboard/admin/usage (4 tabs) + aggregator + drill-in (audit-logged); pure metric helpers; +23 tests |
| Post W91 (per-user creds + W80 pivot) | 640/641 | user_integrations (AES-256-GCM, v1: prefix) + resolveCredentials (user→operator-only→null) + 4 routes + Settings "Connect Your Tools" + 5 integration routes refactored + Front Desk/Campaigns/Analytics opened to all authed users; +16 tests |
| Post W91.5 (STAFFD self-knowledge, fs-free) | 646/647 | STAFFD_SELF.md canonical + embedded mirror in staffd-self.ts (no node:fs); fetchVault override for operator; VaultEditor banner; +6 tests |
| Post W91-rollback (Model B3) | 649/650 | removed customer Connect-Your-Tools UI + deleted component; W80 empty states → STAFFD voice (frontDeskEmptyStates); /dashboard/upload stub; W92 dropped customer-adoption block; substrate untouched; +5 tests |
| Post W91.5 content reprise | 651/652 | STAFFD_SELF content → SA consultation canonical values (positioning "compound agentic OS for SMBs", pillars "You've been staffed"/"SMBs deserve to compete"/"Vault is the moat"/"compound execution not chatbot", customer 1-10 employees, hard-no vendor-leak + no AI-team/agents/bots/modules); doc + embedded mirror in sync; infra (901e9d7) untouched |
| Post W92.1 (effective plan + pack-bias verify) | 660/661 | effectivePlan(email,plan,adminEmail) in comp.ts → comp/operator render Agency; both usage routes use it (byPlan/roster/drill-in); pack-bias VERIFIED working (no fix); +9 tests |
| Post W95-DISCOVERY (Model B3 spike) | 660/661 | docs/architecture/model-b3-spike-W95.md (design only, no code) |
| Post W95.1 (one intent e2e + Twenty probe) | 677/678 | Twenty tag-partition probe PASSED; intent.ts + ConfirmActionModal + /api/intent/{extract,commit} + contacts collection + TwentyClient leak-guard; CommandCenter + Front Desk pipeline wired; +17 tests |
| Post W95.2 (partition substrate + mirror-retry) | 692/693 | Listmonk (list-per-customer) + Docuseal (metadata tag) leak-guard clients; Plausible probe FAILED (no Sites API → client NOT built, SA decision pending); Twenty mirror-retry worker via W71 (workflow-drain extension); W92 mirror-retry stats; probe routes removed; +15 tests |
| Post W95.3 (upload paths) | 711/712 | Sidebar: setup-401 fully diagnosed (proxy.ts gate; all secrets Vercel-Sensitive → agent can't run migration; contacts collection 404, operator must curl from Git Bash; ADMIN_SECRET rotation flagged). Upload: contacts-CSV route (dep-free RFC4180 parser → native contacts + async Twenty mirror via W71 + best-effort Listmonk) + documents route (→ existing documents collection, source-marked) + /dashboard/upload two-card UI + upload_sessions USER_OWNED ledger + GET /api/upload/sessions. Bulk probe blocked (no super-admin token) → loop fallback. +19 tests. Live smoke DEFERRED (contacts 404) |
| Post W95.3.4 (in-app migration trigger) | 726/727 | proxy.ts DUAL-AUTH (x-setup-secret OR super-admin session JWT, Standard #24; logic in setup-auth.ts → Edge-safe); MIGRATION_REGISTRY constant (no fs scan); GET/POST /api/admin/migrations (server-side status detection + admin_migration_log audit); /dashboard/admin/migrations UI (per-row + run-all, gated by admin layout); admin_migration_log ADMIN_ONLY collection + self-bootstrap setup route. +15 tests. Screenshot/operator-smoke DEFERRED (needs super-admin login + bootstrapped collections) |
| Post W95.3.5 (documents depth) | 736/737 | pdf-parse@2 + mammoth (DYNAMIC-imported inside worker only → footgun-isolated); _lib/upload/extract.ts; documents-v2 migration (file 25MB + source + extraction_status) via registry (detectField status detection); document_extraction_worker branch in workflow-drain (final-attempt records honest error, else W71 retry); upload/documents stores binary multipart + inline TXT/MD + async PDF/DOCX + 202; GET /api/documents/[id] poll; UI per-file Processing→Ready/Error + preview; OPERATOR_TEST_QUEUE.md. +10 tests. Live extraction DEFERRED (needs documents-v2 migration + super-admin upload) |
| Post W95.5 (progressive autopilot) | 827/828 | The B3 graduation mechanism. autopilot_prefs + autopilot_audit_log collections; INTENT_FIELDS gains 3-tier policy (trivial N=3 / audited N=5 / never); _lib/autopilot/policy.ts (streak: clean confirm +1, edit no-op, cancel −1 floor0, fire +1, undo→revoke+7d cooldown; graduation offer per tier; ambiguity blocks autopilot). Commit dual-path: autopilot fire writes audit + returns undo info; undo handler reverses create (delete + vendor delete) / update (restore previous_state + vendor update), resets+revokes. extract route returns autofire/graduationOffer. 3 worker handlers (twenty_delete, listmonk_unsubscribe, docuseal_void stub). UndoToast (new); ConfirmActionModal graduation block; Settings Automation section; disable_autopilot intent; /dashboard/admin/activity (super-admin). intent.ts split → intent-policy.ts (llm-free, fixes happy-dom Anthropic guard). +36 tests. Live smokes DEFERRED (need migrations) |
| Post W95.4b (delegate + disambiguation + lists) | 791/792 | WORKER_HANDLERS lookup in workflow-drain (registry); +docuseal_send_worker; delegate COMMIT_HANDLERS (draft_campaign 1-task Marketing wf, send_for_signature 2-task Legal→Docuseal chained via depends_on); extractIntent → IntentResult[] top-2 disambiguation (delta 0.15); ConfirmActionModal single+two-option; 3 status handlers (task/followup/lead) widened COMMIT_HANDLERS to Record<string>; documents-v3 (docuseal_submission_id) migration; 3 Front Desk list pages (/tasks,/followups,/leads) + SideDrawer (new) + /api/front-desk/[list] canonical order + count cards→Links (Standard #27). Docuseal live probe BLOCKED (no super-admin token) → operator smoke #11 is the gating verify. +26 tests (net; removed superseded W95.1 intent.test). Live smokes DEFERRED |
| Post W95.4a (registry + 7 intents) | 766/767 | WORKER_HANDLERS registry (_lib/worker/handlers.ts) — workflow-drain runAgent now a lookup; existing mirror-retry + doc-extraction handlers relocated (behavior-preserving, untouched route tests pass); +2 handlers (listmonk_subscribe, twenty_update). 7 new intents (log_interaction, schedule_followup, add_to_email_list, create_task, capture_lead, update_contact, log_expense) via intent.ts (flat field model, 8 types) + COMMIT_HANDLERS dispatch; create_contact mirror moved INLINE→bus (Standard #20); Listmonk now on the bus. 5 collections (interactions/followups/tasks/leads/expenses) + setup routes (shared ensureBaseCollection) + registry + row-rules + CASCADE (+upload_sessions backfill). ConfirmActionModal generalized (per-intent required gate); CommandCenter per-intent success copy; Front Desk "Your work" cards (tasks/followups/leads) + /api/front-desk/summary. +30 tests. Live intent smokes DEFERRED (need migrations + super-admin) |

### W95 — CONVERSATIONAL INTENT (Model B3 build)
- **W95-DISCOVERY ✅** (`a00932c`) Spike `docs/architecture/model-b3-spike-W95.md` (1603 words): per-vendor internal partition, upload paths, ConfirmActionModal primitive, intent.ts layer, top-10 intents, autopilot via subscriptions json, Vault reuse, downstream map, W95.1–.7 sequence.
- **W95.1 ✅** (`8660072`) ONE intent end-to-end (create_contact). **Twenty live probe PASSED** (retires W80 multi-tenant flag): `staffdCustomerId` TEXT field created on Person via metadata API (createOneField/CreateOneFieldMetadataInput, field id b6d9b748); custom-field filtering works; unfiltered `people`=all 5 → app-layer filter mandatory. `TwentyClient.forCustomer(userId)` leak-guard (refuses empty tenant; injects tag on read filter + write; raw GraphQL fn module-private). `intent.ts` extractIntent (create_contact only; reuses callLLM; threshold 0.7). `ConfirmActionModal` primitive. `/api/intent/commit` → STAFFD-native `contacts` write → tenant-tagged Twenty mirror (graceful) → recordDecision → audit. CommandCenter detects alongside routing; Front Desk pipeline reads STAFFD-native contacts. +17 tests. UI flow verified in preview (input→modal→confirm→pipeline "1 contact · latest Jane Doe").
- **⚠️ OPERATOR (before live commit persists):** run `POST /api/setup/contacts` with `x-setup-secret: <ADMIN_SECRET>` to create the `contacts` PB collection. (The Twenty `staffdCustomerId` field is already created via the probe.) Until then the modal/extract work but commit returns save_failed.
- **W95.2 ✅** Partition substrate for the next two vendors + automated mirror healing. **Probes (server-side, prod creds):** Listmonk PASS (list create + subscriber-add-to-list + filter-by-list all 200 → `LIST-PER-CUSTOMER`, list `staffd-<userId>`); Docuseal PARTIAL (API+auth OK, metadata is the documented submission field, but live round-trip NOT exercised — creating a submission sends a real signature email → `listSubmissions` filters by metadata CLIENT-SIDE defensively); **Plausible FAIL** (`POST /api/v1/sites` → 404 HTML, no Sites-provisioning API on this self-hosted CE → `PlausibleClient` NOT built; SA decision needed — see questions). `ListmonkClient`/`DocusealClient` leak-guard identical to TwentyClient (`forCustomer("")` throws; tag/list derived from userId; raw HTTP fn module-private). **`staffdCustomerId` = PB userId across all vendors** (documented in each client header). **Mirror-retry worker = W71 task-bus, EXTENDED workflow-drain** (Standard #20, not a new route): `/api/intent/commit` enqueues a `specialist_id="mirror_retry_worker"` `workflow_task` on Twenty mirror failure; `workflow-drain` `runAgent` branch re-mirrors via `TwentyClient.forCustomer(task.user)`, patches `contacts` row (`twenty_record_id`+`twenty_mirror_status:"synced"`) on success, throws on failure → W71 retry/exhaust (3 attempts). W92 Workflows tab shows mirror-retry counts by status. All probe routes removed in this commit. +15 tests (5 Listmonk + 5 Docuseal + 2 commit-enqueue + 3 worker drain).
- **W95.3 ✅** Cold-start ingestion. **Sidebar (setup-401):** root-caused to `proxy.ts` (Next16 `middleware`→`proxy`) gating `/api/setup/:path*` on `x-setup-secret`==`ADMIN_SECRET` (strict trim-eq, fail-closed 503). Config correct (live no-header POST → 401 not 503). **Agent can't run the migration**: all ~45 STAFFD secrets are Vercel _Sensitive_ vars → `vercel env pull` returns empty → no `ADMIN_SECRET`/`PB_ADMIN_PASSWORD` access; `.env.local` has only the prod PB URL. Current PB state: `contacts` MISSING(404), `workflows`+`workflow_tasks` EXIST(200). Operator must run `curl -X POST -H 'x-setup-secret: <SECRET>' .../api/setup/contacts` **from Git Bash** (PowerShell `curl`=Invoke-WebRequest alias → 401). **ADMIN_SECRET rotation flagged to SA** (operator leaked plaintext). Standard #17 fix candidate: in-app authenticated setup trigger. **Upload:** dep-free RFC4180 `parseContactsCsv` (`_lib/upload/csv.ts`); `POST /api/upload/contacts` (native `contacts` write → **async** Twenty mirror enqueued via W71 mirror_retry_worker → best-effort inline Listmonk add; vendor never fails a native row; no de-dup); `POST /api/upload/documents` (→ EXISTING `documents` collection, Standard #20; no `source`/`file` field so marked via `agent_name="Uploaded document"`+`department="library"`, TXT/MD text in `output`, PDF/DOCX a metadata note — no binary storage, flagged); `upload_sessions` USER_OWNED ledger + `GET /api/upload/sessions`; `/dashboard/upload` two-card UI (CSV preview + column match + dedup warning, multi-file docs, recent-uploads, empty state, STAFFD voice). **Twenty bulk probe NOT run** (needs super-admin pbToken I lack) → loop fallback per dispatch. +19 tests. Live smoke DEFERRED (contacts 404).
- **⚠️ OPERATOR (W95.3):** (1) rotate `ADMIN_SECRET` (record at creation — Sensitive vars unreadable after) + redeploy; (2) `curl -X POST -H 'x-setup-secret: <NEW>' https://urstaffd.com/api/setup/contacts` AND `.../api/setup/upload-sessions` from **Git Bash**; then contacts CSV upload + W95.1 commit persist live.
- **Next (await SA dispatch):** W95.4 expand intents + delegation (first non-Twenty mirror → generalize mirror worker) → .5 autopilot → .6 Chatwoot inbox + Plausible (pending Sites-API decision) → .7 repoint W80/W92 to per-customer partitions.

### W92.1 — EFFECTIVE PLAN + PACK-BIAS VERIFICATION
- **W92.1 ✅** (`2da1800`) Comp accounts + operator now render their EFFECTIVE tier (Agency), not stale stored "starter". `effectivePlan(email, plan, adminEmail?)` in `_lib/comp.ts` (agency if isCompedEmail or adminEmail match, else stored plan). Both `/api/admin/usage` routes (byPlan tally, roster, drill-in) use it; the Comp/Operator type badge is unchanged (WHO ≠ WHAT — both render). Standard #9 grep: only the two usage routes rendered plan (page renders their payloads); no other sites. Verified live: roster Kalebc/jaxr=Comp·agency, operator=Operator·agency, byPlan agency:3.
- **PACK-BIAS verification (read-only, packages/agents untouched):** **CONFIRMED WORKING — no fix needed.** Runtime test mirrors the real flow (`resolveIndustryToPackId("consulting")`→"consultants" → `routablePacksFor(pack, activePacks)` → `getDepartmentAgents(dept,{activePacks})`): when industry resolves to an active pack, the candidate roster gains that pack's specialists (additive over the generic-only base; inactive pack → not offered). +9 tests total.
- **Next (await SA dispatch):** W95-DISCOVERY (conversational-intent / partition / upload / confirmation-modal / Vault-ingestion design spike, no code).

### MODEL B3 (architecture pivot) + W91-rollback
- **MODEL B3 (confirmed):** customers do NOT connect their own Twenty/Listmonk/Chatwoot/Plausible/Docuseal. Vendor backends become **invisible operator-shared infrastructure**, partitioned per-customer (tagging/workspace). Customers populate via **upload** (CSV/archive/history) at cold-start, then operate via **conversational intent** — voice-first: say it → parse intent+fields → confirmation preview → confirm → write to vendor backend (partitioned) + Vault. **Delegation-plus-direct** (trivial ops = confirm-to-commit; heavy work → specialists). **Progressive autopilot** (skip confirmation after N successes, per-action-type opt-in). Every confirmed action enriches the Vault.
- **W91-rollback ✅** (`25d8751`) Took down customer-facing connect surfaces; **substrate kept intact** (crypto, resolveCredentials, user_integrations collection + routes — operator/future use). Settings "Connect Your Tools" section + component removed. W80 surfaces: STAFFD-voice empty states (`frontDeskEmptyStates`), no "connect"/vendor names, pipeline → `/dashboard/upload` (W95 cold-start placeholder). Campaigns/Analytics 503 copy pivoted. W92 Integrations: dropped always-zero customer-adoption block → operator health + outcomes + honest note. Operator env-fallback regression verified live (all 4 surfaces 200). +5 tests.
- **Queue (await SA dispatch each):** W92.1 (effective-plan: comp users show Agency tier) → W95-DISCOVERY (conversational-intent / partition / upload / confirmation-modal / Vault-ingestion design spike, **no code**) → W95.x build → W73+ (L4 planner/recipes/surface against B3). Staging W95 thinking allowed; no W95 code/docs until dispatched.

### W91.5 — STAFFD SELF-KNOWLEDGE AUTO-POPULATES OPERATOR VAULT
- **W91.5 ✅** (`901e9d7`) `STAFFD_SELF.md` (repo root) is the canonical, human-editable brand identity (YAML frontmatter → Vault fields + notes cross-referencing BRAND_VOICE.md / ARCHITECTURE.md). The loader `_lib/vault/staffd-self.ts` embeds a **verbatim mirror** of the frontmatter as a string constant and parses it (**fs-free** — see incident below); `fetchVault` returns it for the super-admin (memoized), overriding the businesses row. Customers + agency-client mode unchanged. VaultEditor shows an operator-only banner. +6 tests. Smoke verified live: Marketing specialist auto-produced STAFFD voice ("You don't hire software. You staff your business.", premium positioning, demo CTA, no "AI-powered").
- **⚠️ INCIDENT (resolved):** the first W91.5 attempt (`5a9ca8b`) read STAFFD_SELF.md via `node:fs` at runtime + set `outputFileTracingRoot` in next.config. This **500'd ALL /api routes on Vercel** (passed locally) — the `node:fs` import poisoned a shared serverless chunk and the tracing-root override broke function bundling. Reverted (`4f2badc`), prod restored, then rebuilt **fs-free** (content embedded, no fs, no tracing changes). **Lesson: never `readFileSync` a repo-root file from a serverless route, and never set `outputFileTracingRoot` on this Vercel monorepo.** SYNC CONTRACT: edits to STAFFD_SELF.md frontmatter must be mirrored into `staffd-self.ts`.

### W91 — PER-USER VENDOR CREDENTIALS + W80 SURFACE PIVOT
- **W91 ✅** (`d3c097e`) Customers bring their own Twenty/Chatwoot/Listmonk/Plausible/Docuseal creds. `user_integrations` collection (USER_OWNED, unique (user,type), in `CASCADE_COLLECTIONS_USER` → GDPR erase). `_lib/integrations/crypto.ts` AES-256-GCM `v1:iv:tag:ct` (version prefix for V2 rotation), **fail-closed** if `INTEGRATION_ENCRYPTION_KEY` unset/≠32B. `_lib/integrations/resolve.ts` `resolveCredentials(user,type)`: own creds → operator env (**super-admin ONLY** — no cross-tenant leak) → null. **muapi excluded** (platform credit infra; documented in resolve.ts + muapi route). Routes: GET `/api/user-integrations` (masked, never plaintext), POST/DELETE `[type]`, POST `[type]/test`. All 5 integration routes refactored to the resolver (no direct vendor-env reads). Settings "Connect Your Tools" (vendor names OK per D4 exception). **W80 PIVOT:** Front Desk/Campaigns/Analytics dropped super-admin gate → open to all authed users; per-card "Connect your tools →" empty state; operator keeps env fallback (regression verified live — all 4 surfaces still 200). W92 Integrations tab now shows fleet adoption (zero is honest). +16 tests.
- **⚠️ OPERATOR (before connect flow works):** (1) `openssl rand -base64 32` → set `INTEGRATION_ENCRYPTION_KEY` in Vercel (Prod+Preview+Dev); (2) `POST /api/setup/user-integrations` with `x-setup-secret: <ADMIN_SECRET>` to create the collection. Surfaces + operator fallback already work without these; only customer save/connect needs them.
- **Next:** OAuth flows (V2), key rotation (V2), per-client agency creds (W94), W93 (admin actions).

### W92 — SUPER-ADMIN USAGE DASHBOARD
- **W92 ✅** (`388b586`) Fleet-wide `/dashboard/admin/usage`, 4 tabs (Users / Departments / Integrations / Workflows), under existing super-admin admin layout. `GET /api/admin/usage` (single aggregator) + `GET /api/admin/usage/[userId]` drill-in — both `requireSuperAdmin`. Drill-in = metadata-only (D4 privacy) + writes `super_admin_audit_log` `usage_drill_in` row (existing helper). Users classified operator/comp/customer by email; operator+comp rows **badged** (mark, never filter — Operator=purple, Comp=amber). Last-activity proxy for active/dormant; churn from `active_until`. Counts via O(1) `totalItems`; list aggregations capped + commented. Pure helpers in `_lib/usage.ts`. Inline SVG (velocity), no chart dep. Read-only (admin actions = W93). **No new collections/logging (Standard #20).** +23 tests. Verified live with real fleet (3 users, dept/specialist counts, all 4 tabs + drill-in).
- **Next:** W93 (admin actions: revoke/adjust credits/suspend) if dispatched; per-customer integration metrics gated on W91.

### W72 — WORKFLOW OBJECT (L4 substrate, layer 2 of compound execution)
- **W72 ✅** (`66b9671`) Parent `workflows` object owns task groups + lifecycle. `computeWorkflowStatus`/`reconcileWorkflow` (pure, dep-injected) in `_lib/workflow.ts`: pending→running→completed|failed|partial. Routes: `/api/workflow/[id]` GET (super-admin OR row-owner via `canAccessWorkflow`); `/api/workflow/aggregate` POST (aggregation HOOK — V1 stub doc, ADMIN_SECRET/WORKER_SECRET gated; W74 recipes fill it). `workflow-drain` reconciles touched workflows post-drain + runs aggregate when all tasks succeed. Status transitions → `super_admin_usage_log` (exists; mapped to schema, Standard #9) for W92 trail. `setup/workflow-tasks` extends `workflows` (root_goal, recipe_id, aggregation_doc_id, started/completed_at, cost_*, error) w/ idempotent field-patch. +20 tests.
- **Plausible opt-out ✅** (`0aba731`) super-admin/operator sessions no longer counted as customer traffic — `PlausibleScript` client component skips the script + stubs `window.plausible` when email matches `NEXT_PUBLIC_ADMIN_EMAIL`. Verified in-browser (customer present / admin absent). +4 tests. No historical cleanup (CE limitation).
- **⚠️ OPERATOR:** run `POST /api/setup/workflow-tasks` with `x-setup-secret: <ADMIN_SECRET>` to migrate the new `workflows` fields into prod PB (idempotent). Aggregate stub-return smoke needs a real workflow_id (fake id → 404 by design).
- **Next:** W92 (Super-Admin Usage Dashboard) — SA dispatches after W72 closes.

### W80 — DIRECT-SERVICE UX (operator-scoped, decision b)
- W80 Part 2 thinking: chat + would-be doc. W80 spike: `docs/architecture/direct-service-capability-spike-W80.md` (`791d2f9`).
- **W80.1 ✅** Operations Home → **`/dashboard/cockpit`** (renamed from `/operations` — collides with Operations dept, Standard #9). Super-admin nav "Cockpit". Cards: Email/Pipeline/Inbox/Analytics. Augmentation chip → Command Center via `?ask=`.
- **W80.1a ✅** Plausible read `/api/integrations/plausible` (5-min cache, super-admin). **⚠️ OPERATOR: set `PLAUSIBLE_API_KEY` + `PLAUSIBLE_SITE_ID` in Vercel** or the Analytics card shows "Not connected yet".
- **Security:** FC-1 reads (Twenty/Chatwoot/Listmonk) + Plausible + Stripe connector now **super-admin gated** (were exposing operator data). Reopens to all under **W91 per-user creds**.
- **W80.2 ✅** Email Campaigns native depth → `/dashboard/front-desk/campaigns` (list/detail/compose). Listmonk gains lists read (`?resource=lists`), enriched list (recipients/dates/open-rate), send/schedule (`PUT`). Compose has "✨ Make this smart →" (→ Command Center). Email card now drills in. +11 tests (564 floor). No vendor names in rendered UI (proven via grep). Pulse widget "Stripe" → "your billing".
- **Rename ✅** Cockpit → **Front Desk** across all user-facing surfaces (`cc0cf9d`). Route `/dashboard/cockpit`(+sub) → `/dashboard/front-desk`; 301 redirect in `next.config.js`. Zero `cockpit/Cockpit` in user-facing copy (one redirect docstring only).
- **W80.3 ✅** Site Analytics native depth → **`/dashboard/front-desk/analytics`** (`fd94520`). Range toggles (Today/7d/30d), headline (visitors/pageviews/bounce/avg-visit), source/page/country top-5 breakdowns, inline-SVG visitor trend (no chart dep — Standard #9). "✨ Make sense of this →" → analytics specialist via `?ask=`. Front Desk Analytics card drills in. Plausible route extended with `?view=deep&range=` — single auth/cache substrate; 2-tier cache (5-min headline+timeseries / 15-min breakdowns), keyed by range. +13 tests (577 floor). Verified live in prod with operator data (7d=21 / 30d=88 visitors). **READ SUBSTRATE COMPLETE.**
- **Pending:** operator smoke (live-browser click-through on prod, super-admin); SA ratify Front Desk name; FC-2c (DepartmentRoom action handlers); Chatwoot native inbox (deferred per spike).
| TDD iron law | Always RED before GREEN | No production code without a failing test |

---

## SECTION 9 — HOUR TOTALS

| Section | Hours | Working Days (6h/day) |
|---|---|---|
| Tier 1: Critical Fixes | 22.6h | 3.8 days |
| Tier 2: Feature Completion | 109h | 18.2 days |
| Tier 3: Moonshots (excl. MS-5, MS-E) | 88h | 14.7 days |
| Missing items | 39h | 6.5 days |
| **GRAND TOTAL** | **258.6h** | **~43 days** |

> At 1 CC session of ~5-6h per day, this is approximately 43–52 sessions.
> Sequentially critical path (T1 → FC-1/2/3/4 → FC-5 → MS-A → MS-D) is ~65h = ~11 sessions before the autonomy milestone.

---

## SECTION 10 — SESSION HANDOFF PROTOCOL

When starting a new CC session, paste this block into the first message:

```
Read STAFFD_TRACK.md at C:\Users\xrupe\staffd\STAFFD_TRACK.md first.
Active context: [describe what we're building this session]
Last completed: [item ID from tracker, e.g. T1-1, T1-2]
Next up: [item ID]
Test floor going in: [current passing count]
```

When ending a session, update this file:
- Mark completed items ✅
- Update test floor in Section 8
- Note any new blockers discovered
- Add any new missing items to Section 5

---

## SECTION 11 — RECOMMENDED SESSION ORDER

1. **Session A** (0.6h): T1-1 + T1-2 — W71.fix PB + Vercel env var → unblocks W72
2. **Session B** (8h): T1-3 — W70.2 orchestrator regression (P1 bug)
3. **Session C** (6h): T1-4 + T1-5 + T1-6 — Groq fallback + Muapi credit + pbEscape audit
4. **Session D** (9h): T1-7 + T1-8 — Vault DLQ + setup route auth
5. **Session E** (12h): MX-1 + MX-2 + MX-7 — Error monitoring + SMTP check + portal link
6. **Session F** (12h): MX-3 — Onboarding wizard (biggest conversion lever)
7. **Session G** (20h, 3-4 sessions): FC-1a + FC-1b + FC-1c — Read integrations (Twenty, Chatwoot, Listmonk)
8. **Session H** (14h): FC-2 — Action candidates UI (depends on FC-1)
9. **Session I** (5h): FC-3 — Outcome auto-ingestion
10. **Session J** (6h): FC-4 — Google OAuth
11. **Session K** (8h): MX-4 — Document search UI
12. **Session L** (5h): MX-5 + MX-6 — Push UI + mobile audit
13. **Session M** (6h): MS-A — Stripe read connector (enables FC-5)
14. **Session N** (28h, 4-5 sessions): FC-5a + FC-5b + FC-5c — Autopilot loop (THE milestone)
15. **Session O** (26h, 4 sessions): FC-6a + FC-6b + FC-6c — Team workspaces
16. **Session P** (18h, 3 sessions): MS-D1 + MS-D2 — Client portal
17. **Session Q** (28h, 4 sessions): MS-B1 + MS-B2 — Voice input + Elevenlabs
18. **Session R** (36h, 6 sessions): MS-C1 + MS-C2 — Marketplace
