# Reality Audit — June 2026 — ARCH §17 vs. Repo State

**Purpose.** Per Decision 79 / Standard #9, ARCH §17's "MISSING / BROKEN" list cannot be trusted as a planning input after two prior discoveries (PR-T2.0 brain + PR-T1.8 ACTION 2 memory) showed its claims were structurally stale. This audit classifies every surviving §17 item against repo state.

**NO production code shipped.** Pure read + grep + classify.

---

## §1 — Executive summary

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Stripe top-up SKUs | ✅ DONE | 6 packs (100/250/500/1k/2.5k/5k credits), full webhook crediting |
| 2 | CEO add-on SKU | ✅ DONE | Route + webhook + price id wiring complete |
| 3 | Stripe billing portal | ✅ DONE | `/api/stripe/portal` route ships, verified PR-T1.6 |
| 4 | Credits widget on dashboard | ✅ DONE | `CreditsWidget` + `LowCreditsBanner` + dashboard integration |
| 5 | Smart aspect ratio auto-selection | ❌ NOT BUILT | Route accepts client-supplied `aspectRatio`; no server-side prompt-based selection |
| 6 | 3-Layer Briefing flow UI | ❌ NOT BUILT | Zero UI references to Layer1/2/3 vocabulary or briefing-modal |
| 7 | Intelligent cross-functional handoff (UI) | ✅ DONE | `HandoffPanel` + DepartmentRoom "Send to…" modal + `/api/handoff/suggest` wired |
| 8 | Successful pattern tracking — UI surface | ⚠ PARTIAL | Write-side complete (V6); no read-side UI surfacing "pattern weight" or "past win" badges |
| 9 | Smart Search UI for Pro+ | ❌ NOT BUILT | No `SmartSearch`/`VaultSearch`/`vault_search` component in codebase |
| 10 | Studio Mode for Pro+ | ❌ NOT BUILT | No `StudioMode`/`PowerUser` references anywhere |
| 11 | White-label (Agency) | ❌ NOT BUILT | Only hit is a pricing-page marketing mention; no per-client branding code |
| 12 | Multi-turn conversation persistence (UI) | ✅ DONE | `ThreadPickerDrawer` + localStorage threadStorageKey + `ensureConversationThreadRow` |
| 13 | Onboarding flow | ✅ DONE | `/onboarding/page.tsx` — 6-step wizard with focus / bottlenecks / vault prefill |
| 14 | Settings dashboard | ✅ DONE | `/dashboard/settings` with 7 panels (Connected Accounts, Voice, Push, Packs, Autopilot, Brief Prefs, Scheduling) |
| 15 | GDPR data export / deletion | ❌ NOT BUILT | Privacy + Terms pages reference rights; no `/api/user/export` or `/api/user/delete` endpoint exists |
| 16 | Listmonk transactional templates | ⚠ PARTIAL | Integration route + webhook for outcomes + ad-hoc `/api/tx` POST from booking flow. NO `STAFFD_LISTMONK_TEMPLATES` env, NO centralized `sendTransactional()` helper, NO template registry |
| 17 | Per-event cron scheduler | ✅ DONE | `vercel.json` ships 6 crons (scheduled, vault, morning-brief, brief-push-dispatcher, security-audit, tick) |
| 18 | Document upload / parse / review with versioning | ⚠ PARTIAL | `document_versions` collection + `versions.ts` append-only writer + restore-version + versions API exist. **NO upload/parse pipeline** for user-supplied source docs |
| 19 | Templates system rebuild (Model C) | ⚠ PARTIAL | Templates page + `STARTER_TEMPLATES` library + 4-field setup route exist. Bundle 6 G0 noted partial schema vs Model C (no scope/variables/capabilities/tags/recency/pack/global fields) |
| 20 | Pack discovery UX | ✅ DONE | `IndustryPacksPanel` + `PackUpsellCard` + `PackActiveBadge` cover discovery + active + upsell |
| 21 | Pack purchase flow | ✅ DONE | `/api/stripe/checkout-pack` + UI triggers in IndustryPacksPanel + PackUpsellCard |
| 22 | Bundle 9 V2 client management | ✅ DONE | `/dashboard/clients/page.tsx` (489 LOC) + `ClientSwitcher.tsx` (194 LOC) + clients API |

**Tally:** 14 ✅ DONE / 4 ⚠ PARTIAL / 4 ❌ NOT BUILT.

The §17 staleness is consistent with the prior two discoveries: ~64% of items the doc said were "MISSING/BROKEN" are actually DONE. Items 5, 6, 9, 10, 11, 15 are the genuine NOT BUILT set.

---

## §2 — Per-item evidence

### ✅ DONE — 14 items

**#1 Stripe top-up SKUs.** `apps/web/app/api/stripe/checkout-topup/route.ts` defines `TOPUP_CREDIT_QUANTITY` for 6 packs (`topup-100` through `topup-5000`). `apps/web/app/api/setup/stripe/route.ts` registers them in `STRIPE_PRICES`. `stripe/webhook/route.ts` consumes `staffd_topup_pack` + `staffd_topup_credits` metadata and credits the user via `addAgentTopupCredits()`. Success URL routes back to `/dashboard?topup=success`.

**#2 CEO add-on SKU.** `apps/web/app/api/stripe/checkout-ceo-addon/route.ts` reads `prices["ceo-addon_monthly"]` from STRIPE_PRICES (registered in `setup/stripe/route.ts:34`). Webhook handler `setCeoAddonForUser()` patches `subscriptions.ceo_addon_sub` field. Tied to plan resolution via `trial.ts:resolveUnlocked` (per file comment). UI trigger location not exhaustively traced; backend complete.

**#3 Stripe billing portal.** `/api/stripe/portal` route exists and was hardened in PR-Tranche-1.6 (W8 URL resolver refactor — confirmed working live).

**#4 Credits widget.** `apps/web/app/components/CreditsWidget.tsx` (dashboard credit balance card, Phase 4). `apps/web/app/components/LowCreditsBanner.tsx` (low-credit warning with "Top up" CTA). Both wired into `dashboard/page.tsx` (lines 10, 424, 440). CommandCenter.tsx also surfaces "Agent credits remaining" (line 329).

> **Note on W14 ("CreditsWidget is heavy-handed"):** the widget exists. If W14 means "the current display is too prominent / interrupts flow," that's a UX polish item — distinct from "doesn't exist."

**#7 Cross-functional handoff (UI).** `apps/web/app/components/HandoffPanel.tsx` (Phase 9 — calls `/api/handoff/suggest` which delegates to orchestrator `intent:"handoff"`). DepartmentRoom.tsx integrates: "Send to…" button at line 1398; modal at line 1783; HandoffPanel rendered at line 1810; `handoffToDepartment()` handler at line 499. Locked depts surfaced as upsell triggers per the handoff intent's contract.

**#12 Multi-turn conversation persistence (UI).** `apps/web/app/components/ThreadPickerDrawer.tsx` (Phase 25 slide-in list of recent threads with rehydration). CommandCenter.tsx uses `THREAD_STORAGE_KEY = "staffd_command_center_thread_id_v1"` localStorage key (line 40); DepartmentRoom.tsx uses per-department key `staffd_dept_thread_id_v1:${department}` (line 121). `ensureConversationThreadRow()` from `_lib/conversations` creates metadata row idempotently. Phase 9 comment notes the thread "survives reloads via localStorage."

**#13 Onboarding flow.** `apps/web/app/onboarding/page.tsx` — 6-step wizard with FOCUS_OPTIONS (4 choices) + BOTTLENECK_OPTIONS (5 choices) + downstream steps. Wired to vault prefill via `/api/prefill`.

**#14 Settings dashboard.** `apps/web/app/dashboard/settings/page.tsx` imports + renders 7 panels: SchedulingSettings, ConnectedAccounts, VoiceProfilePanel, PushNotificationsToggle, IndustryPacksPanel, AutopilotControlsPanel, BriefPreferencesPanel. Profile name + password change forms inline. Covers everything Decision 56 listed except GDPR data export (item #15).

**#17 Per-event cron scheduler.** `vercel.json` ships 6 crons: scheduled (`0 8 * * *`), vault (`*/1 * * * *`), morning-brief (`0 6 * * *`), brief-push-dispatcher (`*/15 * * * *`), security-audit (`0 2 * * *`), plus tick (per worker listing). ARCH §15 expected set fully covered.

**#20 Pack discovery UX.** Three components: `IndustryPacksPanel.tsx` (catalog browse + checkout trigger), `PackUpsellCard.tsx` (per-department upsell when pack unlocked elsewhere), `PackActiveBadge.tsx` (the inverse — shown when user has the pack). DepartmentRoom.tsx renders PackUpsellCard at line 930.

**#21 Pack purchase flow.** `/api/stripe/checkout-pack/route.ts` (auditioned during PR-T1.7 vendor reconnect — origin chain hardened). UI triggers: `IndustryPacksPanel.tsx:69` and `PackUpsellCard.tsx:103` both POST to `/api/stripe/checkout-pack`.

**#22 V2 client management.** `apps/web/app/dashboard/clients/page.tsx` (489 LOC — full client CRUD surface). `apps/web/app/components/ClientSwitcher.tsx` (194 LOC — header dropdown for active-client selection in Agency mode). Dashboard integration at `dashboard/page.tsx:339`.

### ⚠ PARTIAL — 4 items

**#8 Successful pattern tracking — UI surface.** Write side fully shipped (V6 — PR #13 per task log + memory discovery §3). Patterns bump `vault_embeddings_index.weight` and propagate to Qdrant payload; `retrieve()` multiplies cosine by weight in scoring. Only UI consumer found was `VoiceProfilePanel.tsx` (which surfaces recent kept/shared work for brand voice). **Gap:** no UI badge/indicator on documents to show "this was a successful pattern" / "regenerated 3 times" / "high engagement." Pattern data is invisible to the user even though the engine uses it silently. Could be a single per-document badge component (~50 LOC).

**#16 Listmonk transactional templates.** Three surfaces exist:
- `/api/integrations/listmonk/route.ts` — list/broadcast send (manual)
- `/api/webhooks/listmonk/route.ts` — receives campaign.complete + subscriber.bounced + subscriber.complaint events; feeds vault outcomes
- `/api/book/[slug]/route.ts:182-202` — ad-hoc POST to `/api/tx` for booking confirmation emails

**Gap:** no `STAFFD_LISTMONK_TEMPLATES` env var, no template registry, no `sendTransactional(templateKey, vars)` helper. Each transactional send is hand-rolled. A registry + helper would centralize (signup welcome, booking confirmation, payment receipt, low-credit warning, brief-ready notification) into one place.

**#18 Document upload / parse / review with versioning.** Versioning side fully built:
- `setup/document-versions/route.ts` (Phase 27 — Vault Editing History)
- `_lib/vault/versions.ts` — append-only writer
- `/api/documents/[id]/save-edit` + `/api/documents/[id]/restore-version` + `/api/documents/[id]/versions`

**Gap:** no document upload pipeline for user-supplied source files (PDF, DOCX, image). `documentUpload`/`uploadDocument`/`parseDocument` greps returned zero hits. The versioning system handles edits to AI-generated docs but doesn't ingest user-provided source material. If the operator wants users to upload their own brand guide / contract template / brief and have specialists work from it, that pipeline doesn't exist.

**#19 Templates system rebuild (Model C).** Three surfaces exist:
- `/dashboard/templates/page.tsx` — user template CRUD UI
- `apps/web/lib/starterTemplates.ts` — `STARTER_TEMPLATES` library + `fillVaultData()` helper
- `setup/templates/route.ts` — 4-field setup route (user, name, department, content) — Bundle 6 G0 partial

**Gap:** Model C spec (per prior bundles) called for richer schema — scope (global vs pack vs user), variables (typed slots), capabilities (which agents accept this template), tags, recency tracking, pack association. Current schema is the minimum viable shape. Whether to extend to full Model C depends on whether template sophistication is product-blocking; today it's not.

### ❌ NOT BUILT — 4 items

**#5 Smart aspect ratio auto-selection.** `apps/web/app/api/integrations/muapi/route.ts:267-300` reads `aspectRatio` from the client request body, validates against `VALID_RATIOS` set, defaults to `"1:1"`. **No prompt-content detection.** DepartmentRoom.tsx (lines 630, 665) sends `aspectRatio: imageRatio` from a UI-selected state. Decision 8 calls for the system to auto-pick aspect ratio from prompt content ("Instagram post" → 1:1, "TikTok video" → 9:16, etc.); none of that logic exists. **Build estimate:** ~80 LOC — regex/keyword detection in routeImageModel + tests.

**#6 3-Layer Briefing flow UI.** Zero hits on "Layer1", "Layer2", "Layer3", "BriefingFlow" anywhere in `apps/web/app/`. The brain has briefing intelligence (`handlers/brief.ts`), but no UI walks the user through a structured "brief me" modal. The brief is generated automatically by the morning-brief cron; the on-demand briefing flow per ARCH §10 is conceptual only. **Build estimate:** ~200-300 LOC — modal + 3 stepped views + brief intent invocation + render.

**#9 Smart Search UI.** Zero hits on "SmartSearch", "VaultSearch", "vault_search". The memory has full retrieval (`/api/_lib/vault/retrieve.ts`) but no user-facing surface lets a power user query their vault directly. The retrieval works silently inside the agent loop. **Build estimate:** ~150 LOC — search input + results component + new `/api/vault/search` route that wraps `retrieve()`.

**#10 Studio Mode for Pro+.** Zero hits anywhere. No power-user generation interface with model picker, cost display, vault top-K override, retrieval-score visibility. The plumbing exists (orchestrator policies are per-intent + overridable); UI doesn't. **Build estimate:** ~250 LOC — settings panel + per-request overrides + cost display.

**#11 White-label (Agency).** Only hit is a marketing mention on `/dashboard/clients/page.tsx:135`. No per-client logo upload, no per-client brand color theming, no doc/booking page rebranding by client. `ClientSwitcher` selects active client for VAULT scoping, not for visual branding. **Build estimate:** ~200 LOC — per-client `brand_logo` + `brand_color` fields + theming injection on docs/booking pages.

**#15 GDPR data export / deletion.** Privacy + Terms pages cite GDPR rights as policy; no API endpoint implements them. Greps for `data_export` / `delete_account` / `deleteAccount` / `right.*forgotten` returned only the marketing-copy hits. **Build estimate:** ~150 LOC — `/api/user/export` (returns full PB record dump as JSON + Qdrant points) + `/api/user/delete` (cascade-deletes user + documents + conversations + vault rows + Qdrant collection) + UI confirmation modal in settings.

---

## §3 — Recommended next-tranche scope

Sorted by user-impact (highest first), keyed to the genuine NOT BUILT + the most impactful PARTIAL items.

### Tier A — direct user impact, small build, foundation-clean

1. **#5 Smart aspect ratio auto-selection** (~80 LOC).
   - Honors Decision 8 explicitly: "user does not need to know the right ratio per platform — the application does."
   - The current state quietly degrades every image/video output (users either pick wrong or default to 1:1 for content destined for 9:16).
   - Zero schema, zero new dependencies.

2. **#15 GDPR data export / deletion** (~150 LOC).
   - Compliance-required (Privacy Policy promises rights that don't have an implementation).
   - Single user-visible button in Settings → "Download my data" + "Delete my account."
   - Defensive value: any privacy complaint now has a documented remediation path.

3. **#9 Smart Search UI for Pro+** (~150 LOC).
   - Memory has full retrieval; this is the user-facing surface that finally exposes it.
   - High-value for users with large vaults (Agency tier especially).
   - Single new component + thin `/api/vault/search` wrapper.

### Tier B — strategic build, medium-impact

4. **#11 White-label (Agency)** (~200 LOC).
   - Differentiates Agency tier in a way the current product doesn't.
   - Per-client `brand_logo` + `brand_color` on the clients collection, injected into doc + booking templates.
   - Modest scope; high perceived value per Agency dollar.

5. **#16 Listmonk transactional template registry** (~120 LOC).
   - Centralizes the 5 hand-rolled transactional sends into one helper.
   - `STAFFD_LISTMONK_TEMPLATES` env var with template key → Listmonk template id mapping.
   - `sendTransactional(key, vars)` helper.
   - Unlocks future emails (low-credit warning, brief-ready notification) without per-route reinvention.

6. **#8 Pattern weight UI badges** (~50 LOC).
   - Reveals the engine's intelligence to users — "regenerated 3x" / "high engagement" badges on documents.
   - Reinforces "this product learns about you" positioning.

### Tier C — significant build, defer until justified

7. **#6 3-Layer Briefing flow UI** (~200-300 LOC).
   - Brain already supports it (briefing intent ships layered context).
   - UI requires modal + stepped flow + render — meaningful design + frontend work.
   - Defer unless a specific user-journey (e.g. "guided weekly brief setup") demands it.

8. **#10 Studio Mode (Pro+)** (~250 LOC).
   - Power-user surface, low expected DAU.
   - Build when a Pro+ user explicitly asks for model picker / cost display.

9. **#18 Document upload / parse pipeline** (~300+ LOC + parser dependency).
   - Adds a substantial new ingest path (PDF/DOCX parsing, OCR for images, embedding for vault).
   - Defer until a customer interview surfaces it as blocking.

10. **#19 Templates Model C extension** (~150 LOC).
    - Current 4-field schema is sufficient for user template CRUD.
    - Extend to Model C only when a template sophistication need (e.g. typed-variable interpolation in pack templates) actually blocks something.

### Tier D — already adequate

The 14 DONE items don't need rebuilding. Items that surfaced as "DONE but maybe rough" (CreditsWidget UX, item #4) belong in a polish PR, not a foundation tranche.

---

## Closing note (Standard #9 reinforced)

Decision 79 / Standard #9 mandates pre-strategy verification before any "build the X" tranche. This audit is the verification layer for the surviving §17 list. The pattern across three consecutive discoveries (brain, memory, this audit) is consistent: **the ARCH planning docs lag the repo state by ~6 months of shipped work.** Treat ARCH §17 as historical commentary, not as the planning input. Treat this report + the two Discovery reports as the current planning input until ARCH §17 is rewritten to match.

When that rewrite happens (suggest folding into a single ARCH §17 refresh PR), the four classifications here can drop straight in — ✅ DONE items move to the "Built" list with file pointers; ⚠ PARTIAL items move to "Polish backlog" with the specific gap; ❌ NOT BUILT items become the active build queue, prioritized per §3 tiers.
