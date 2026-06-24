# STAFFD — Handoff / Current-State Brief

> **Read this first.** It's the single entry point for a new Claude Code (or any) session.
> It tells you what STAFFD is, how it's built, where the work stands, what remains, and how to
> work in this codebase. Then read the canonical docs it points to. Last updated: 2026‑06‑24.

---

## 1. What STAFFD is

STAFFD is a **compound agentic business operating system for SMBs** — "a full organization of
specialists you **direct, not operate**." The owner tells a Command Center / department what they
need; STAFFD routes it to the right specialist, who produces real work (copy, contracts, financials,
images, videos). A **Vault** remembers the business context so every piece of work compounds and
gets sharper over time.

**The thesis, in one line the product itself uses:** *"It's not a chatbot. It's not a subscription
tool. It's your staff. You direct the work — they produce it."*

Three product laws that govern everything (do not violate without SA sign‑off):

- **Intent‑first, never a tool palette.** The customer expresses intent in words (and clicks smart
  affordance chips); the specialist executes. We do **not** expose model pickers, vendor names, or a
  Photoshop‑style tool rack. Editing = *directing changes* ("remove the background", "make it blue"),
  routed to the right backend — not operating an editor. The day we show a model menu, STAFFD becomes
  "another AI tool" and the staff metaphor dies.
- **Model B3 — invisible, operator‑shared backends.** Customers never connect vendor accounts and
  never see vendor names. The operator (SA) holds the keys; STAFFD calls the vendors server‑side.
  See memory `project_staffd_model_b3`.
- **Bury the meter.** Price on the *work delivered*, not compute consumed. The per‑click credit
  decision is the fear we're removing. Cheap things (text, images) are unlimited; only the genuinely
  expensive thing (cinematic video) is rationed — and even then via a monthly *allowance* gated at
  project start, never a per‑click charge. See memory `project_staffd_pricing_generation`.

---

## 2. The repo & how it's deployed

- **Monorepo** at `C:\Users\xrupe\staffd` — **pnpm + Turbo**. GitHub: `https://github.com/xrupert/staffd.git`.
- **`apps/web`** — the Next.js app (App Router). This is where ~all the work is. Live at
  **https://urstaffd.com**, **auto‑deployed by Vercel on every push to `main`**.
- **`packages/agents`** — ~195 specialist definitions organized as departments (Marketing, Sales,
  Legal, HR, Finance, Operations, Paid Media, Design, Reputation, + The CEO).
- **PocketBase** (on Railway) is the database/auth. Collections are created idempotently by
  `apps/web/app/api/setup/*` routes (operator‑run). Server code talks to PB over REST.
- **Vendors (server‑side, invisible to customers):** **muapi** (ALL image+video rendering),
  **Anthropic + Groq** (LLM text intelligence, Groq→Anthropic fallback), **Stripe** (billing),
  and the integration vendors (Twenty CRM, Chatwoot, Listmonk, Docuseal, Plausible).

**Environment constraints you will hit:**
- Vercel **Sensitive** env vars (e.g. `ADMIN_SECRET`, `PB_ADMIN_PASSWORD`, `MUAPI_API_KEY`,
  `STRIPE_SECRET_KEY`, `MUAPI_WEBHOOK_SECRET`) are **not readable by you**. Don't try; don't ask SA to
  paste secrets in chat.
- `node:fs` in a serverless route and a stray `outputFileTracingRoot` have each 500'd all of `/api`
  while passing locally. **Verify deploys with a live `curl`, not Vercel's deploy status.** See memory
  `staffd_vercel_footguns`.

---

## 3. How it's built — stack, conventions, the gate

- **TypeScript + Next.js App Router.** Server routes under `apps/web/app/api/**`. UI under
  `apps/web/app/**` + `apps/web/app/components/**`. Shared server libs under `apps/web/app/api/_lib/**`.
- **TDD is the law here** (RED → GREEN). Write the failing test first, watch it fail, minimal code to
  green. Tests live in `apps/web/__tests__/**` (vitest, some `@testing-library/react`; **jest‑dom
  matchers are NOT registered** — use `el.textContent` + `.toMatch`, not `toHaveTextContent`).
- **The pre‑commit gate (run all three, from `apps/web`):**
  ```
  cd /c/Users/xrupe/staffd/apps/web
  npx tsc --noEmit        # must be exit 0
  npx vitest run          # must be all green (exits non‑zero on any failure)
  npx next build          # "Compiled successfully"
  ```
- **Then:** commit → push `main` → Vercel deploys → **live `curl` sweep** to confirm. Commit footer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  ```
- **Engineering Standards** (numbered, canonical): `docs/architecture/STANDARDS.md`. The ones you'll
  touch most: **#38** (every generation trigger passes a tier gate — enforced by a CI guard,
  `__tests__/generation/trigger-surfaces.test.ts`), **#39** (admin‑token routes must authenticate the
  caller; never trust a body `userId`), **#33/#34** (generation cost/billing), **#36/#37** (tiers,
  SA‑verifies‑architecture‑before‑dispatch). New standards append with the next free number.
- **ZERO vendor names in customer‑facing surfaces.** There's a brand‑voice grep CI test. Notifications,
  copy, URLs — all speak in STAFFD's voice.

---

## 4. Current state — what's built and working

**Generation vertical (the recent focus — image/video):**
- Customer says e.g. "make me a TikTok" / "a logo for IRIS" → orchestrator routes to the right
  **specialist** (`routeTask`), who writes the deliverable → the customer (or a chip) triggers
  generation → the **muapi route** enriches the prompt and submits → result renders inline.
- **Models are a swappable registry** (`app/api/_lib/generation/routing.ts`). Current picks
  (OpenAPI‑verified, costs from the live muapi dashboard): **video** quick=`seedance-2` / `veo3-fast`,
  pro=`veo3-fast` (~$0.60), premium=`veo3` / `sora‑2` (~$2.50); **image** quick=`flux-2-dev`,
  pro=`flux-2-pro`, premium=`nano-banana-pro` / `midjourney`. **Update these picks as the leaderboard
  turns — never bet the product on one model.**
- **Prompt enricher** (`app/api/_lib/generation/enricher-prompt.ts`): IMAGE distills a brief into the
  actual artifact (logo‑aware, never renders the brief as a document); VIDEO distills to ONE renderable
  shot. *This was the source of the "photo of a creative brief" and "5‑second blitz" bugs — both fixed.*
- **Async job ledger** (`_lib/generation/jobs.ts` + `generation_jobs` PB collection): submit → poll
  (`/api/generation/[id]/status`) with a **webhook** primary (`/api/generation/webhook`). Charge is
  claim‑first idempotent. `fingerprintFor` dedupes; a `variant`/`seed` distinguishes the "3 options".
- **Command Center renders results INLINE** (`<img>`/`<video>` + Download), never a raw vendor link.
  **Images are unmetered** and return **3 options** (distinct seeds) to choose from; **video** keeps
  the tier picker (it's the metered one).

**Security (W95.7.3d‑h6 sweep — DONE):** the "trust a body `userId` next to the admin token" IDOR
class is closed across muapi, stripe/portal + 4 stripe/checkout, clients/clients[id], departments/
choose, trial, workflow/enqueue, briefing, handoff/suggest, and `/api/agent`. Helpers in
`app/api/_lib/integrations/identity.ts`: `whoAmI`, `verifyUserOwnsSelf`, `resolveAgentUserId`.
Codified as **STANDARD #39**.

**Notifications layer (W95.8 + W95.8.1):** ONE registry‑driven layer (`_lib/notifications/{events,
notify}`) — typed events × audience × severity. `generation.ready/failed`, `workflow.completed`,
`credits.low` are wired (emitted by `completeJob`, the workflow drainer, etc.). `NotificationBell` is
**live** (polls + refreshes on focus + pulses), and web push exists. A prominent animated
`GenerationProgress` ("keep working, we'll ping the 🔔") replaced the invisible loaders.

**Pricing engine (W95.9 — IN PROGRESS, see §6).** The value‑priced model's typed spine + the
cinematic allowance gate + usage counter are built and tested (pure, not yet wired into the live
flow). Numbers are SA‑ratified (§5).

**Also live & solid:** the orchestrator (intent → route → specialist), the Vault (business context +
**voice learning**: `vault/patterns.ts` behavioral signals → `recomputeVoiceProfile` →
`getVoiceBlock`), outcome ingestion, departments/trial/plan resolution, uploads (CSV + documents),
Stripe read (MRR), Cockpit/analytics, the super‑admin dashboards, progressive autopilot, admin health.

---

## 5. The pricing model (SA‑ratified numbers, source of truth: `app/api/_lib/billing/plan-benefits.ts`)

- **Plans (held — add value, don't reprice):** Starter **$39** / Growth **$79** / Pro **$149** /
  Agency **$450** (annual = ×10).
- **Everyday video** (`veo3-fast`, ~$0.60/clip) — an **invisible fair‑use ceiling** per plan
  (25/50/100/250 clips/mo), generous enough the 95% never see it. **Images: unlimited** (~$0.015).
- **Cinematic video** (`veo3`/`sora`, ~$2.50/clip) — the one **visible monthly allowance**:
  **0 / 8 / 24 / 60** per plan. A clip = one ~4s shot; ~8 shots = one stitched 30s commercial
  (`commercialsFromClips`). So Agency 60 ≈ 7 commercials/mo.
- **Gating rule:** only cinematic is gated, **only at the start of a new project, never mid‑render**
  (a project in flight always finishes). Resets monthly. **Cinema extension packs** (+10/$39, +30/$99)
  top it up. Newcomers reaching for premium → **upsell the plan** (à‑la‑carte for a newcomer is a
  UX‑law violation); overage packs are only for committed Pro/Agency power users.

---

## 6. What remains — the roadmap (priority order, SA‑ratified; full detail in memory `project_staffd_roadmap_gaps`)

1. **Finish #2 (pricing engine):** wire the allowance gate + upsell into the live route (the next
   slice touches paid flow — careful), build the **Stripe Cinema‑pack products + redemption webhook**
   together (no orphan products), the **tier‑picker reframe** (kill the credit model in UI), the
   **UpgradeModal** value‑reframe, and **onboarding intent capture** ("what will you use it for most?").
2. **#3 — multi‑shot video stitch (REQUIRED for cinematic to be real).** A 30s commercial = N shots
   **stitched**. The mechanism is already in our vendor: **muapi `/api/v1/video-combiner`** (pass a
   `videos_list` of clip URLs → one mp4), plus `motion-graphics-edit` for captions. **Do NOT add
   Shotstack/Creatomate or build on Adobe** — `video-combiner` is the runtime path; Adobe is a creative
   seat tool, not a headless backend.
3. **Edit‑as‑intent (refine loop) — HIGH, hit live.** Following up on a creative ("no background +
   black outline", "give me variations") currently has no "edit THIS" path, so it orphans the artifact
   and produces something generic. Build edit/refine intents → muapi edit endpoints
   (`nano-banana-pro-edit`, bg‑removal, `video-combiner` reorder). No model pickers — edit‑as‑intent.
4. **Publishing (built‑but‑DISABLED).** `PUBLISH_ENABLED=false` — STAFFD can make a TikTok but can't
   post it. Closing make→publish is high value‑per‑effort.
5. **Visual‑Style learning.** Voice learning exists; *visual* taste does not — the image enricher is
   generic. Add `getStyleBlock(userId)` (learned from kept/regenerated/published visuals + brand
   assets + edit signals) injected into the enricher. Pairs with #3/edit‑as‑intent.
6. **L4 planner UI** (the "automated team" flagship has no user trigger yet — Tranche 2).
7. **Hardening pass:** verify/fix Google **OAuth** (test‑queue item 8), **billing resilience**
   (dunning / proration / trial→paid), **mobile/responsive** (creator persona is mobile‑heavy),
   **visual cold‑start seeding** at onboarding (logo/colors → first outputs aren't generic).

---

## 7. How to think / work here (operating principles)

- **You are the Builder/architect.** SA (the operator, chris.rupert@cybridagency.com) sets strategy and
  ratifies; you own the codebase truth and the implementation. External analyses / pasted suggestions
  are **input to pressure‑test, not commands** — resolve contradictions and make the call; don't bounce
  decisions back. (Memory `feedback_builder_authority`.)
- **Propose‑then‑ratify for direction; just‑build for the obvious.** Pricing numbers, vendor choices,
  and product‑shape decisions are SA's call — present a recommendation with reasoning, get a yes. Bugs,
  refactors, and clearly‑authorized polish: just do it (standing authorization to improve
  working‑but‑generic features — memory `feedback_improve_existing`).
- **One coherent tranche at a time, each behind the full gate.** Small commits, each tsc+vitest+build
  green, each with a descriptive message. Ship infra/config spines even when not yet wired.
- **The recurring trap (settle it):** image/video **pixels are ALWAYS rendered by muapi**; our
  "agents" are LLM text‑intelligence that write the **prompt**. There is no in‑house draw model and
  there can't be one without a diffusion/video model = muapi. Every generation quality problem we've
  hit has been **our prompt‑construction or our rendering**, never the plumbing. **Do not** fork/mirror
  the muapi GitHub app templates — they make the identical `POST /api/v1/<slug>` call and fix nothing.
- **Honesty over reassurance.** If a deliverable is bad, say so and root‑cause it. Verify live (curl /
  re‑test) before claiming something works.

---

## 8. Key files map (apps/web)

```
app/api/_lib/integrations/identity.ts     whoAmI / verifyUserOwnsSelf / resolveAgentUserId (auth)
app/api/_lib/generation/routing.ts        the swappable model registry (per dept × kind × tier)
app/api/_lib/generation/enricher-prompt.ts  IMAGE vs VIDEO prompt enrichers (distill, logo‑aware)
app/api/_lib/generation/jobs.ts           generation_jobs ledger, fingerprint/dedup, completeJob
app/api/_lib/generation/pricing.ts        legacy tier→credit weights (being replaced by plan‑benefits)
app/api/_lib/billing/plan-benefits.ts     NEW source of truth: plan → cinematic allowance, Cinema packs
app/api/_lib/billing/cinematic-allowance.ts  pure gate (cinematicGate, monthly reset)
app/api/_lib/billing/cinematic-usage.ts   count this month's cinematic clips + combined state
app/api/integrations/muapi/route.ts       the generation submit route (enrich → submit → job)
app/api/_lib/notifications/{events,notify}.ts   the registry‑driven notifications layer
app/api/_lib/vault/{voice,patterns,outcomes,index}.ts   the Vault + voice learning
app/api/_lib/orchestrator/**              intent → route → specialist (action‑vocabulary, handlers)
app/components/CommandCenter.tsx          the universal front door (intent + inline media + chips)
app/components/DepartmentRoom.tsx         per‑department workspace (also renders generations inline)
app/components/{GenerationProgress,NotificationBell,GenerationTierModal,GenerationTierInline}.tsx
app/api/setup/**                          idempotent PB collection + Stripe product setup (operator‑run)
docs/architecture/STANDARDS.md            the numbered engineering standards (#1–#39)
ARCHITECTURE.md · STAFFD_TRACK.md · docs/operator-runbooks/**   canonical context + runbooks
```

## 9. Cross‑session memory

The durable, cross‑session context notes are **ported into the repo at [`docs/memory/`](docs/memory/)**
(indexed by [`docs/memory/README.md`](docs/memory/README.md)) — so this project is fully portable and
self‑describing on any machine, for any reviewer, with no dependency on a local `~/.claude` memory
store. Key notes: `project_staffd`, `project_staffd_model_b3`, `project_staffd_pricing_generation`,
`project_staffd_roadmap_gaps`, `project_staffd_notifications`, `project_staffd_l4`,
`feedback_builder_authority`, `feedback_improve_existing`, `staffd_vercel_footguns`. (The operator's
live auto‑memory may run slightly ahead; `docs/memory/` is the committed snapshot — re‑port when it
drifts.)
