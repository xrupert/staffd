# STAFFD — Complete Architecture Specification

> **The single source of truth for what STAFFD is, how every piece fits, and what's missing.**
>
> If you handed this document and the repo to a senior application architect, they should be able to recreate the entire product. This is also the spec the build team uses to know what's done, what's drifting, and what's next.
>
> Last consolidated: November 2026.

---

## 1. The Vision

**STAFFD is an AI-powered hiring platform for small businesses.** You hire a full staff — Marketing, Sales, Legal, HR, Finance, Operations, Paid Media, Design, Reputation, and The CEO — for less than one freelancer. 83+ named specialists across 10 departments are on call the moment you sign up.

It is **NOT** "an AI tool." The product positions and behaves as **staff**, not software. The user is the employer. The specialists are employees. Departments are the org chart. Plans are subscriptions to a workforce.

### What makes it differentiated

1. **The room metaphor.** You walk into a department, describe what you need, the right specialist handles it. You never have to pick between agents. The Command Center routes invisibly.
2. **The CEO.** A cross-department strategic advisor that synthesizes the work of every other department. Only Pro and Agency plans get it. It's the upgrade trigger.
3. **End-to-end social publishing.** Generate an image or video in Design, click Publish, it goes live on TikTok/YouTube/Instagram. No other competitor offers this in one flow.
4. **Real specialists, real outputs.** Marketing writes campaign copy, Design produces actual images and videos via Muapi, Legal drafts contracts, Sales writes outreach. Every output is finished work, not strategic spec.

### What it is NOT

- Not a chat wrapper around Claude.
- Not a generic "AI assistant."
- Not an image generator with extra steps.
- Not a no-code builder.

It is a **business hiring platform** that uses AI as the engine but speaks the language of staff, departments, and work product.

---

## 2. Voice & Brand Rules

**Locked in `BRAND_VOICE.md`. Mandatory across the entire platform.**

| Concept | ✅ Say | ❌ Don't say |
|---|---|---|
| Workforce | **staff** | "AI team", "team" (too generic) |
| Individual workers | **specialists** | "agents", "bots" |
| Org units | **departments** | "modules" |
| Subscription action | **hire**, **promote** | "subscribe", "upgrade" |
| Work output | **work**, **drafts**, **reports** | "AI-generated output" |
| Active subscription | **on payroll**, **on staff** | "active subscription" |
| Loading state | "Drafting…", "Writing…", "Filming…" | "Generating…" |
| Welcome | "Your staff is on duty." | "Your AI team is ready." |

The product name STAFFD is also a verb. **You "staff" your business.**

---

## 3. The Pricing Architecture (locked)

### The four plans

| Plan | Price | Departments | The CEO | Credits | Add-ons |
|---|---|---|---|---|---|
| **Starter** | $39/mo | 6 curated specialists (Marketing/Sales/Legal pack) | — | 100 images / 5 videos | — |
| **Growth** | $79/mo | Starter + 1 user-chosen full department | — | 300 images / 10 videos | +$29/mo per extra dept |
| **Pro** | $149/mo | Starter + 3 user-chosen full departments + **The CEO** | ✅ included | 600 images / 20 videos | +$29/mo per extra dept |
| **Agency** | $450/mo | **ALL 9 departments** + The CEO + multi-client dashboard + white-label | ✅ included | 1,800 images / 60 videos | — (everything included) |

### Annual interval

Annual = 2 months free (monthly × 10). Default-selected on the pricing page. Pricing page always shows the round monthly subscription number; annual shows "Billed annually at $X — save $Y" callout.

### Top-up packs (credit purchases when monthly allowance runs out)

| Pack | Price | Margin |
|---|---|---|
| 50 image credits | $9.99 | 80% |
| 150 image credits | $24.99 | 76% |
| 350 image credits | $54.99 | 75% |
| 10 video credits | $22.99 | 57% |
| 25 video credits | $54.99 | 55% |
| 50 video credits | $109.99 | 55% |

Top-up unit prices are intentionally higher than what plans give per-credit — encourages plan upgrades over chronic top-ups.

### Cost basis at max usage

- HD image (Flux Pro via Muapi): $0.04
- HD video (Kling/Hunyuan via Muapi): $0.75–$1.00 per 5-second clip
- All margins ≥ 69% at maximum credit usage. Realistic margin (30% utilization) is 90%+.

### Trial gate

Locked departments offer 3 free trial runs per department before requiring upgrade or $29/mo dept add-on. CEO is NEVER an add-on — only Pro and Agency plans include it.

### Comp logic

Email domain `@jrw-solutions.com` auto-receives Agency-tier access with 100× credits (effectively unlimited). Used for operator dogfooding. See `apps/web/app/api/_lib/comp.ts`.

---

## 4. The Org Chart — 10 Departments, 83 Specialists

Every department is a "room" of specialists. The user describes a task, the system routes to the right one invisibly. Each department has 2–3 capability **categories** in the UI that group specialists conceptually.

### Department roster (current count)

| Department | Specialists | Categories | Key role |
|---|---|---|---|
| **Marketing** | 16 | Content & Authority · Social & Video · Growth, SEO & AI Search | Captions, blog, social, SEO, AI search optimization, podcast strategy |
| **Sales** | 10 | Outreach & Research · Proposals & Demos · Closing & Accounts | Cold outreach, proposals, RFPs, deal strategy, account expansion |
| **Legal** | 6 | Contracts & Review · Policies & Compliance · Client Intake & Billing | Service agreements, NDAs, policies, contract review, intake forms |
| **HR** | 4 | Hiring · Team Development | Job postings, interview frameworks, onboarding, performance reviews |
| **Finance** | 7 | Billing & Bookkeeping · Planning & Forecasting · Capital Strategy | Invoices, P&L, forecasts, tax strategy, M&A analysis |
| **Operations** | 12 | Processes & Automation · Projects & Coordination · Reporting & Insights | SOPs, automation, supply chain, project shepherding, exec summaries |
| **Paid Media** | 7 | Campaigns · Creative & Audit · Measurement | Google/Meta/TikTok ads, programmatic, attribution setup |
| **Design** | 8 | Brand & Visuals · UI & UX · Delight & Detail | Image generation, brand guides, UI design, UX research |
| **Reputation** | 5 | Customer Support · Reviews & Listings · Community & Insights | Support replies, review responses, community management, feedback synthesis |
| **CEO** (cross-department) | 8 | Strategy & Foresight · Product & Priorities · Full Team | Strategic synthesis across all unlocked departments |

### Specialists are invisible by default

Per the locked plan: **users walk into a department, describe what they need, the right specialist handles it.** The category tabs show capabilities, not specialist names. A "Meet the team (16) →" drawer lets curious users browse the roster on demand.

The starter pack (6 specialists curated for Starter plan):
- marketing-content-creator
- marketing-seo-specialist
- marketing-social-media-strategist
- sales-outreach
- reputation-customer-service-responder
- operations-document-generator

### Agent definition format

Every specialist lives in `packages/agents/src/departments/{dept}.ts` and follows this shape:

```ts
{
  id: "marketing-content-creator",
  name: "Content Creator",
  department: "marketing",
  description: "...",
  emoji: "✍️",
  color: "#0EA5E9",
  tags: ["blog", "content", "newsletter"],
  systemPrompt: `You are The Content Creator — STAFFD's...`
}
```

---

## 5. The Brain — Hermes Orchestrator Pattern (TO BUILD CORRECTLY)

**This is the most important architectural gap right now.** The original build plan called for the Hermes pattern in `apps/api`. The skeleton exists. **The brain itself has not been built.** Every "smart" feature so far has been a one-off Claude call — Command Center routing, CEO briefing, almost-shipped handoff suggestions — each spinning up its own ad-hoc prompt with no central coordination.

### What it should be

A **single orchestrator service** that:

1. Receives all "smart" requests (routing decisions, cross-functional handoffs, briefings, anything that needs LLM intelligence to coordinate departments).
2. Loads the `ceo-agents-orchestrator` system prompt from `packages/agents` as its operating instructions.
3. Has full read access to the user's unlocked departments, recent work, vault, active client (Agency mode), and credit state.
4. Returns structured routing decisions: which specialist, which task, with what context.
5. Logs every decision so we can audit and improve over time.

### The interface

```
POST /api/orchestrator
Body: {
  userId,
  pbToken,
  intent: "route" | "handoff" | "brief" | "synthesize",
  context: { ... },
}
Returns: {
  decision: { department, agentId, task, rationale },
  followUps?: Array<{ department, label, task }>,
  notes?: string,
}
```

### Locations of intelligence today (to be consolidated)

| Current ad-hoc endpoint | What it does | Where it should route |
|---|---|---|
| `/api/orchestrate` (Command Center) | Picks department for a user message | → `/api/orchestrator` with intent=route |
| `/api/briefing` (CEO weekly brief) | Synthesizes 30 days of work into a brief | → `/api/orchestrator` with intent=brief |
| `/api/handoff/suggest` (not yet shipped) | Suggests cross-functional next steps | → `/api/orchestrator` with intent=handoff |

### Where it lives

**Recommended: `apps/web/app/api/orchestrator/route.ts`** (same Vercel deploy as the rest of the web app). The original plan called for it in `apps/api` as a separate Bun/Hono service. That's architecturally cleaner but operationally heavier. For now, keeping everything on the Vercel deploy is the right tradeoff. Spin out to `apps/api` when scale demands.

**Hard rule going forward:** Any new "smart" feature MUST route through `/api/orchestrator`. No more ad-hoc Claude calls outside of generation routes (image/video) or document-saving.

---

## 6. Technical Stack

| Layer | Tech | Where |
|---|---|---|
| Frontend | Next.js 16 App Router, TypeScript, Turbopack | `apps/web` on Vercel |
| LLM | Claude Sonnet 4.6 via Anthropic SDK | `@anthropic-ai/sdk` |
| Database | PocketBase (SQLite) | Self-hosted on Railway |
| Auth | PocketBase users collection | Same Railway instance |
| File storage | PocketBase files | Same Railway instance |
| Payments | Stripe — subscriptions + one-time top-ups | api.stripe.com |
| Image generation | Muapi.ai (Flux Pro, Recraft V3, Ideogram V3) | api.muapi.ai |
| Video generation | Muapi.ai (Kling Pro, Hunyuan, Veo when available) | api.muapi.ai |
| Email campaigns | Listmonk (transactional + marketing) | Self-hosted on Railway |
| E-signatures | Docuseal | Self-hosted on Railway |
| CRM | Twenty | Self-hosted on Railway |
| Customer service | Chatwoot + inbound webhook for AI draft replies | Self-hosted on Railway |
| Analytics | Plausible | Self-hosted on Railway |
| Social publishing | Muapi.ai publish endpoints (tiktok / youtube / instagram) | Via Muapi |
| Scheduling | In-house `/book/[slug]` (replaced Cal.com) | Vercel + PocketBase |
| Vector DB (planned) | Qdrant for semantic vault retrieval | Self-hosted on Railway |
| Cron jobs | Vercel Cron at `/api/worker/scheduled` | Vercel |

### Repos as fork inventory

The user maintains forks of every self-hosted service: `xrupert/listmonk`, `xrupert/docuseal`, `xrupert/twenty`, `xrupert/chatwoot`, `xrupert/analytics` (Plausible), `xrupert/pocketbase`. These are sources of truth for the services we run.

### Repos that are dev-time only (not runtime)

- `superpowers` — engineering methodology
- `graphify` — codebase mapper
- `agent-skills` — AI-coding discipline
- `taste-skill` — UI quality enforcement
- `agency-agents` — source of the specialist system prompts (already extracted into `packages/agents`)

These tools are used by the developer building STAFFD. They do not run at user-runtime.

---

## 7. Repository Structure

```
staffd/
├── apps/
│   ├── web/                    ← Next.js 16 frontend + all API routes (Vercel)
│   │   └── app/
│   │       ├── (public pages: /, /pricing, /privacy, /terms)
│   │       ├── auth/login, auth/signup
│   │       ├── onboarding/        ← 6-step vault prefill
│   │       ├── dashboard/
│   │       │   ├── page.tsx       ← Welcome + dept grid + Command Center
│   │       │   ├── vault/         ← Business profile (extra context)
│   │       │   ├── library/       ← All produced work
│   │       │   ├── calendar/      ← Bookings + scheduled review items
│   │       │   ├── templates/     ← Pre-built doc templates
│   │       │   ├── settings/      ← Profile, scheduling, connected social
│   │       │   ├── clients/       ← AGENCY-ONLY: client roster
│   │       │   ├── ceo/           ← The CEO dashboard with weekly briefing
│   │       │   └── {dept}/        ← Each of the 10 department pages
│   │       ├── admin/             ← Operator admin (chris.rupert@cybridagency)
│   │       ├── book/[slug]/       ← Public booking page (no auth needed)
│   │       ├── doc/[id]/          ← Public share view of a generated doc
│   │       ├── components/
│   │       │   ├── DepartmentRoom.tsx        ← Core department UI
│   │       │   ├── CommandCenter.tsx         ← Smart routing chat (dashboard)
│   │       │   ├── CEOBriefing.tsx           ← Weekly brief card (CEO dept)
│   │       │   ├── UpgradeModal.tsx          ← Plan upgrade flow
│   │       │   ├── DepartmentPicker.tsx      ← Pick choosable dept on Growth/Pro
│   │       │   ├── AddDeptModal.tsx          ← +$29/mo extra dept purchase
│   │       │   ├── ClientSwitcher.tsx        ← Agency: switch active client
│   │       │   ├── SchedulingSettings.tsx    ← Set booking availability
│   │       │   ├── ConnectedAccounts.tsx     ← TikTok/YouTube/IG connections
│   │       │   └── DocExport.tsx             ← PDF/Word export
│   │       └── api/
│   │           ├── _lib/                     ← Shared backend utilities
│   │           │   ├── comp.ts               ← jrw-solutions free-Agency check
│   │           │   └── credits.ts            ← Image/video credit tracking
│   │           ├── orchestrator/  (TO BUILD) ← THE BRAIN
│   │           ├── agent/                    ← Single-shot agent run
│   │           ├── orchestrate/              ← Command Center routing (ad-hoc)
│   │           ├── briefing/                 ← CEO weekly brief (ad-hoc)
│   │           ├── agents/[department]/      ← Agent roster listing
│   │           ├── trial/                    ← Trial gate + credit state
│   │           ├── credits/                  ← Credit balance read
│   │           ├── prefill/                  ← Onboarding website prefill
│   │           ├── clients/, clients/[id]/   ← Agency CRUD
│   │           ├── departments/choose/       ← Pick depts on Growth/Pro
│   │           ├── doc/[id]/                 ← Public doc share fetch
│   │           ├── book/[slug]/              ← Booking creation
│   │           ├── book/[slug]/availability/ ← Slots for a date
│   │           ├── worker/scheduled/         ← Daily cron worker
│   │           ├── webhooks/chatwoot/        ← Inbound ticket → AI draft
│   │           ├── stripe/checkout/          ← Plan checkout
│   │           ├── stripe/checkout-addon/    ← Extra dept add-on checkout
│   │           ├── stripe/portal/            ← Customer Portal session
│   │           ├── stripe/webhook/           ← Subscription lifecycle events
│   │           ├── admin/data/               ← Admin dashboard read
│   │           ├── setup/                    ← Idempotent PB collection migrations
│   │           │   ├── businesses/
│   │           │   ├── subscriptions/
│   │           │   ├── stripe/               ← Provisions Stripe products + prices
│   │           │   ├── bookings/
│   │           │   ├── clients/
│   │           │   └── calendar/
│   │           └── integrations/
│   │               ├── muapi/                ← Image + video generation
│   │               ├── muapi/publish/        ← Social posting
│   │               ├── listmonk/             ← Email campaigns
│   │               ├── docuseal/             ← E-signature
│   │               ├── twenty/               ← CRM contacts/opportunities
│   │               └── chatwoot/             ← Open support tickets
│   ├── api/                    ← Bun/Hono skeleton (NOT YET WIRED)
│   │   └── src/
│   │       ├── routes/{agent,orchestrate,health}.ts
│   │       ├── lib/vault.ts
│   │       └── middleware/rateLimit.ts
│   └── workers/                ← (planned) background jobs
│
├── packages/
│   ├── agents/                 ← All 83+ specialist definitions
│   │   └── src/
│   │       ├── departments/{marketing,sales,legal,hr,finance,operations,paid-media,design,reputation,ceo}.ts
│   │       ├── prompts/        ← Shared prompt fragments
│   │       ├── utils/buildPrompt.ts
│   │       ├── types.ts        ← AgentDef, Department, VaultContext
│   │       └── index.ts        ← exports + getAgent() + getDepartmentAgents() + STARTER_PACK_IDS
│   ├── ui/                     ← Shared design system
│   ├── eslint-config/
│   └── typescript-config/
│
├── ARCHITECTURE.md             ← THIS DOCUMENT
├── BRAND_VOICE.md              ← Voice rules
├── package.json                ← pnpm workspace root
├── turbo.json                  ← Turborepo config
└── vercel.json                 ← Vercel deploy + cron config
```

---

## 8. Data Model (PocketBase Collections)

### `users`
Built-in PocketBase auth collection. `email`, `name`, password hash.

### `businesses` (the Vault)
One per user. Holds the business context that every specialist reads silently.
```
user (rel→users)
business_name, industry, description, target_audience
website, phone, address, primary_email, secondary_email, other_email
focus, situation, superpower, magic_wand (from onboarding)
logo (file)
recommended_departments (json)
-- Scheduling fields:
booking_enabled (bool), booking_slug (text)
booking_timezone (text, IANA)
booking_default_duration (number, minutes)
booking_buffer (number, minutes)
booking_availability (json: { mon: [["09:00","17:00"]], tue: [...], ... })
```

### `subscriptions`
One per user. Tracks plan, credits, addon subs.
```
user (text-FK)
plan (text: starter|growth|pro|agency)
stripe_customer, stripe_sub_id
active_until (iso text)
trial_runs (json: { dept: count })
unlocked_departments (json: string[])    -- user-chosen depts on Growth/Pro
dept_addon_subs (json: { dept: stripe_sub_id })  -- $29/mo dept add-ons
image_credits_used (number)              -- resets monthly
video_credits_used (number)              -- resets monthly
image_credits_topup (number)             -- never resets, depleted on use
video_credits_topup (number)             -- never resets
credits_reset_at (text, YYYY-MM-01)
```

### `documents`
Every piece of work produced.
```
user (text-FK), client (text-FK to clients, optional, Agency feature)
department (text), agent_name (text)
prompt (text), output (text)
created, updated (auto)
```

### `clients` (Agency feature)
One per agency client. Mirrors vault fields so each client gets their own context.
```
agency_user (text-FK to users)
name, industry, description, target_audience
website, phone, primary_email, address
focus, situation, superpower, magic_wand
logo_url, status (active|archived), notes
```

### `bookings`
Created when an external visitor books on a host's `/book/[slug]` page.
```
user (text-FK)         -- the host
client (text-FK, optional)
attendee_name, attendee_email, attendee_phone
start_time (iso text), duration (number, minutes), timezone (text)
notes, status (confirmed|cancelled), source
```

### `scheduled_content`
Items scheduled to auto-run via the worker, OR review reminders.
```
user (text-FK), client (text-FK, optional)
department, agent_name, task
scheduled_date (text, YYYY-MM-DD)
status (planned|completed|failed|review)
```

### `templates`
Pre-built document templates per user (Invoice, NDA, etc.).
```
user, name, content
```

---

## 9. Integrations Catalog

| Integration | Route | Env vars | Purpose |
|---|---|---|---|
| **Muapi** | `/api/integrations/muapi` | `MUAPI_API_KEY` (`MUAPI_URL` opt) | Image + video generation |
| **Muapi publish** | `/api/integrations/muapi/publish` | (same as above) | Post to TikTok/YouTube/Instagram |
| **Listmonk** | `/api/integrations/listmonk` | `LISTMONK_URL`, `LISTMONK_USERNAME`, `LISTMONK_PASSWORD` | Email campaigns & transactional |
| **Docuseal** | `/api/integrations/docuseal` | `DOCUSEAL_URL`, `DOCUSEAL_API_KEY` | E-signatures |
| **Twenty CRM** | `/api/integrations/twenty` | `TWENTY_API_URL`, `TWENTY_API_KEY` | Add contacts/opportunities |
| **Chatwoot** | `/api/integrations/chatwoot` + `/api/webhooks/chatwoot` | `CHATWOOT_URL`, `CHATWOOT_API_KEY`, `CHATWOOT_ACCOUNT_ID` | Open tickets + auto-draft replies |
| **Plausible** | (script in `app/layout.tsx`) | `NEXT_PUBLIC_PLAUSIBLE_URL`, `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | Privacy-first analytics |
| **Stripe** | `/api/stripe/*` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICES` (JSON map) | Subscriptions + top-ups |
| **PocketBase** | (admin SDK + REST) | `NEXT_PUBLIC_POCKETBASE_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD` | DB / auth / files |
| **Worker auth** | `/api/worker/scheduled` | `CRON_SECRET` (Vercel cron), `WORKER_SECRET` (manual) | Daily scheduled-content runner |
| **Qdrant** (planned) | (TBD) | `QDRANT_URL`, `QDRANT_API_KEY` | Semantic vault search |

### Service URLs in operation (production)

| Service | URL |
|---|---|
| Chatwoot | `https://chatwoot-production-fd8f.up.railway.app` |
| Twenty | `https://twenty-server-production-016b.up.railway.app` |
| Listmonk, Docuseal, Plausible | (live but URLs in Vercel env only) |
| Muapi | `https://api.muapi.ai` |
| Stripe price IDs | See `STRIPE_PRICES` env var |

---

## 10. The Generation Pipeline

### The 3-Layer Briefing Flow (the differentiator)

This is what separates STAFFD from every prompt-paste competitor. Average users describe what they want in plain language. STAFFD turns that into a sophisticated, dense, model-tuned prompt that produces extraordinary output. The user never has to learn prompt engineering.

```
LAYER 1 — Image Brief (conversational, when input is vague)
  User: "I need a hero image"
  System: Asks 2-3 focused clarifying questions filling the creative gaps:
    - What feeling? Confident, calm, energized, premium, approachable?
    - Who's the audience? (often inferred from vault)
    - Style direction? Clean, bold, retro, photoreal, illustrated?
    - Any text in the image, color anchors, where it will live?
  When vault has enough context, Layer 1 is silent — agent skips
  straight to Layer 2 with sensible defaults from vault.

LAYER 2 — The Image Prompt Engineer
  Takes the user's intent + their answers + vault context and produces
  a DENSE, SOPHISTICATED prompt of roughly 100-300 words containing:
    - Subject, setting, framing/composition
    - Multiple style modifiers (lighting, mood, medium, palette)
    - Specific visual details (lens, depth of field, texture, era)
    - Reference styles where useful (editorial, propaganda poster,
      cinematic, painterly, Annie Leibovitz, Wes Anderson)
    - Any on-image text written out with typography + placement
    - Aspect-aware composition notes
  This is the part that produces extraordinary output. Quality lives here.

LAYER 3 — Smart Model Routing (server-side, silent)
  The dense prompt is read for content and routed to the best Muapi model:
    - Has quoted text or text-related keywords → ideogram-v3
    - Logos / brand marks / UI mockups → recraft-v3
    - Cinematic / dramatic video → kling-pro
    - Default image → flux-pro-1.1
    - Default video → hunyuan-video
  Studio Mode (Pro+) lets power users override.
```

### Image / video flow at runtime

```
1. User describes need in any department
2. Layer 1 + Layer 2 — specialist produces the dense prompt (or full brief in
   the case of Visual Storyteller / Brand Guardian)
3. User clicks Generate Image / Generate Video
4. /api/integrations/muapi POST { userId, kind, prompt, aspectRatio }
5. Pre-flight credit check via getCreditState() — 402 if out
6. enrichToPrompt() — universal pre-step at the integration boundary:
   - If the specialist already produced a Layer-2 dense prompt, pass through
   - If the specialist produced a brief, layout spec, or strategy doc
     (Visual Storyteller, Brand Guardian, etc.), call Claude to ENRICH it
     into a Layer-2 dense prompt with all the same sophistication as a
     direct Image Prompt Engineer output
   - This step never compresses or simplifies — only enriches and focuses
7. Layer 3 — routeImageModel() / routeVideoModel() picks the best endpoint
8. submitPrediction() → POST to Muapi
9. Either synchronous result OR pollResult() until succeeded
10. spendCredits() debits 1 credit (monthly first, then top-up)
11. Return { url, model, promptUsed, remaining }
12. UI displays inline with Download + Publish buttons
```

### Universal prompt enrichment at the boundary

Different specialists produce different artifacts — some produce a Layer-2 dense prompt directly (Image Prompt Engineer), others produce strategic briefs or layout specs (Visual Storyteller for infographics, Brand Guardian for brand assets). The enrichment step at the muapi route boundary normalizes them: anything that isn't already a Layer-2 dense prompt is converted to one, preserving all the strategic intent and adding the dense visual modifiers needed for an extraordinary render. **The output is never dumbed down. It is always elevated to Layer-2 sophistication before generation.**

### Smart model routing

`routeImageModel()` and `routeVideoModel()` use regex pattern detection to pick the best model. Today the routing is local in `/api/integrations/muapi/route.ts`. **Future:** route through the central orchestrator so model selection can use richer context (the source agent, the vault, the user's history).

### Generation buttons surface only on Design

Today the Generate Image / Generate Video buttons appear only in the Design department. **Architectural plan:** any department where a generated visual makes sense (Marketing for social posts, Sales for proposal covers) should be able to call generation, ideally via cross-functional handoff orchestration.

---

## 11. Social Publishing

| Platform | Muapi endpoint | Button location |
|---|---|---|
| TikTok | `tiktok-publish` | Design dept video output |
| YouTube | `youtube-publish` | Design dept video output |
| Instagram | `instagram-publish` | Design dept image + video output |

### Flow

1. User connects accounts via `/dashboard/settings` → Connected Accounts → opens Muapi's OAuth flow (Muapi handles the handshake)
2. Returns to STAFFD. Connection stored on Muapi side, accessible via API key.
3. Generate image or video.
4. Click Platform button → `/api/integrations/muapi/publish`.
5. STAFFD passes the media URL + caption to Muapi's publish endpoint.
6. Muapi posts to the user's connected account.
7. Returns the live post URL.

### Why this is the wedge

No competitor offers AI generation + social publishing in a single flow without manual download / upload / app-switching. This is the **Porsche moment** referenced in the locked plan.

---

## 12. The Credit System

### Plan allotments

| Plan | Monthly images | Monthly videos |
|---|---|---|
| Starter $39 | 100 | 5 |
| Growth $79 | 300 | 10 |
| Pro $149 | 600 | 20 |
| Agency $450 | 1,800 | 60 |
| Comp (jrw-solutions) | 180,000 | 6,000 (100× Agency) |

### Monthly reset

Lazy — on the first credit-state read of a new calendar month, the system zeros out `image_credits_used` and `video_credits_used` and bumps `credits_reset_at` to the new month's first day.

### Top-up balance

Never resets. Depleted only after monthly allowance is exhausted. Purchased via Stripe one-time payments (TO BUILD — checkout SKUs and webhook handler not yet shipped).

### Hard rules

- **Comp users never see "out of credits."** Their cap is 100× Agency, effectively unlimited for testing/dogfooding.
- **Failed generations don't charge.** Credit is debited only on the success path.
- **Pre-flight checks return 402** with a clear `out_of_credits` error to prevent generation calls that would silently fail.

---

## 13. The Vault — Living Memory Layer

**The Vault is not a profile. It is the living memory of the entire business.** Every interaction adds to it. Every retrieval is semantic. The 100th conversation with a specialist is infinitely smarter than the 1st because the Vault holds the previous 99.

This is the engine that makes STAFFD genuinely learn the business over time. Without it, every session starts cold and the platform is just a chat wrapper.

### Layers of the Vault

| Layer | What it holds | Storage | Today |
|---|---|---|---|
| **Business Profile** | Business name, industry, focus, voice, target audience, brand details | `businesses` collection (PocketBase) | ✅ live |
| **Work History** | Every document the staff has produced | `documents` collection (PocketBase) | ✅ stored, ❌ not semantically searchable |
| **Conversation History** | Every turn the user has had with a specialist or the Command Center | **TO BUILD** — currently lost (only the final doc is saved) | ❌ |
| **Successful Patterns** | The prompts that produced kept / shared / published / regenerated work — the "what worked" library | **TO BUILD** — pattern tracking required | ❌ |
| **Brand Voice Corpus** | The user's actual produced work as the truest signal of their voice | Derived from `documents`, but not extracted as a corpus | ❌ |
| **Decisions Made** | Strategic choices from CEO briefings, what the owner committed to | **TO BUILD** — decisions collection required | ❌ |
| **Scheduling Rules** | Booking slug, timezone, availability windows | `businesses` (booking_* fields) | ✅ live |

### The flow at runtime (the way it must work)

```
User interaction (ask in a department, talk to Command Center)
   ↓
Specialist produces output
   ↓
Save artifact to PocketBase (doc / turn / pattern)
   ↓
Embed the artifact (voyage-3 or openai text-embedding-3-large)
   ↓
Store vector in Qdrant — collection scoped by user (or user+client for Agency)
   ↓
NEXT TIME the user asks anything:
   ↓
Query Qdrant for the 5-10 most semantically relevant past artifacts
   ↓
Inject those into the specialist's prompt as living memory
   ↓
Specialist produces work that builds on what came before
```

### What the Vault unlocks

- "Write me an Instagram caption about paint jobs" → specialist sees the last 5 captions the user kept, the last 3 paint-job related outputs, the brand voice patterns — produces something stylistically continuous
- "Draft a sales proposal for a new prospect" → Sales sees the user's last 3 proposals (what they actually sent), the winning language patterns, the pricing structures used — drafts based on real history
- "What should I focus on this week?" → The CEO synthesizes thematic patterns from the last 30 days of work across every department, not a chronological dump
- "Regenerate that Patton image but more cinematic" → System recalls the exact prompt that produced the original, mutates it intentionally

### Graphify vs Qdrant — clearing the confusion

**Graphify** is a code mapper — it understands repository structure, not business data. **Not the right tool for the Vault.** Graphify is a dev-time tool for the team building STAFFD, not a runtime component.

**Qdrant** is a vector database for semantic search. **The right tool for the Vault.** Stores embeddings of every Vault artifact and serves the "most semantically relevant past work" queries.

**Embedding model**: voyage-3 or openai text-embedding-3-large. ~$0.02 per 1,000 embeddings — negligible cost even at scale. One Qdrant instance on Railway (~$10/mo flat) serves all users, scoped by collection name.

### Field inventory (Business Profile layer)

`business_name, industry, description, target_audience, website, phone, primary_email, secondary_email, other_email, address, focus, situation, superpower, magic_wand, logo`

Plus scheduling fields (booking_*).

### Agency-mode override

When the user is on the Agency plan and has switched to acting as a client via `ClientSwitcher`, the agent route loads the **client's** Vault instead of the agency's own — including the client's profile fields AND (once Qdrant is wired) the client's semantic history. Verified by checking `agency_user === userId` to prevent leakage between clients.

### Phases (the real roadmap)

| Phase | What | Status | When |
|---|---|---|---|
| **Phase 1** — Static profile | Flat JSON fields injected as `--- BUSINESS VAULT ---` block | ✅ live | Done |
| **Phase 1.5** — Same-dept memory | Last 2 documents from same user+department injected as prior work | ✅ live | Done |
| **Phase 2** — Conversation persistence | Each turn saved to a `conversations` collection; threads survive sessions | ❌ to build | Now |
| **Phase 2** — Qdrant semantic retrieval | Documents + conversation turns + patterns embedded and queryable | ❌ to build | Now (co-equal with Orchestrator) |
| **Phase 2** — Successful pattern tracking | "Pattern" = a prompt + output the user kept/shared/published. Stored, embedded, surfaced. | ❌ to build | Now |
| **Phase 3** — Knowledge graph | Facts as nodes, relationships as edges. CEO queries it for cross-cutting briefings. | ❌ future | After Phase 2 stable |
| **Phase 3** — Brand voice extraction | Continuous extraction of voice patterns from kept work. Updates as the business evolves. | ❌ future | After Phase 2 stable |

---

## 14. The Agency Layer

### Multi-client

- New collection: `clients` (see Data Model).
- Agency users access `/dashboard/clients` to manage their roster.
- `ClientSwitcher` in header lets them pick "Acting as" any client.
- Active client persists in localStorage as `staffd_active_client`.
- All downstream calls (agent generation, document save, library filter) scope to the active client.
- `/api/clients` route enforces Agency plan or jrw-solutions comp via `isAgencyUser()`.

### White-label (planned, not built)

- Per-client logos on document headers (logo_url field exists, not surfaced).
- Per-client booking page customization.
- Per-client custom domains (future).

---

## 15. Environment Variables Manifest

Every env var the platform reads, what it does, where it's used:

```
# ─── Anthropic (LLM) ──────────────────────────────────────────────────────
ANTHROPIC_API_KEY            All Claude calls

# ─── PocketBase ───────────────────────────────────────────────────────────
NEXT_PUBLIC_POCKETBASE_URL   PB instance URL (client + server)
PB_ADMIN_EMAIL               Admin auth for server-side routes
PB_ADMIN_PASSWORD            Admin auth

# ─── Stripe ───────────────────────────────────────────────────────────────
STRIPE_SECRET_KEY            Server-side Stripe SDK
STRIPE_PUBLISHABLE_KEY       (client-side, future use)
STRIPE_PRICES                JSON map: { "starter_monthly": "price_X", ... }
STRIPE_WEBHOOK_SECRET        Verifies inbound webhook signatures

# ─── Muapi (image + video + social publishing) ────────────────────────────
MUAPI_API_KEY                Bearer token for all Muapi calls
MUAPI_URL                    Optional — defaults to https://api.muapi.ai

# ─── Listmonk ─────────────────────────────────────────────────────────────
LISTMONK_URL                 Self-hosted Railway URL
LISTMONK_USERNAME            Default "listmonk"
LISTMONK_PASSWORD

# ─── Docuseal ─────────────────────────────────────────────────────────────
DOCUSEAL_URL
DOCUSEAL_API_KEY

# ─── Twenty CRM ───────────────────────────────────────────────────────────
TWENTY_API_URL               Endpoint hits {url}/graphql
TWENTY_API_KEY

# ─── Chatwoot ─────────────────────────────────────────────────────────────
CHATWOOT_URL
CHATWOOT_API_KEY
CHATWOOT_ACCOUNT_ID          Numeric account id (usually 1)

# ─── Plausible ────────────────────────────────────────────────────────────
NEXT_PUBLIC_PLAUSIBLE_URL    Self-hosted URL — drives layout script tag
NEXT_PUBLIC_PLAUSIBLE_DOMAIN Site domain for tracking (default urstaffd.com)

# ─── Qdrant (Vault Phase 2 — semantic memory) ─────────────────────────────
QDRANT_URL                   Self-hosted Railway URL
QDRANT_API_KEY               Auth token for the Qdrant instance

# ─── Embeddings (Vault Phase 2) ───────────────────────────────────────────
VOYAGE_API_KEY               voyage-3 for embeddings (preferred)
# OR
OPENAI_API_KEY               text-embedding-3-large fallback

# ─── App ──────────────────────────────────────────────────────────────────
NEXT_PUBLIC_APP_URL          Public app origin
CRON_SECRET                  Vercel cron auth header
WORKER_SECRET                Manual worker trigger via x-worker-secret header
```

---

## 16. API Routes Catalog

### Public / unauth
- `GET /api/book/[slug]` — host metadata for booking page
- `GET /api/book/[slug]/availability` — open slots for a date
- `POST /api/book/[slug]` — create booking
- `GET /api/doc/[id]` — public doc share fetch
- `POST /api/prefill` — pull business info from a URL for onboarding

### Authed (requires user identity via `userId` body field or pbToken)
- `POST /api/agent` — single-shot agent generation
- `POST /api/orchestrate` — Command Center routing (ad-hoc, to consolidate)
- `POST /api/briefing` — CEO weekly brief (ad-hoc, to consolidate)
- `GET /api/agents/[department]` — list specialist roster for a dept
- `GET /api/trial?userId=…` — trial state, plan, resolved departments, comp flag
- `POST /api/trial` — record a trial run (called internally by `/api/agent`)
- `GET /api/credits?userId=…` — image/video credit state
- `GET /api/clients?userId=…` — list clients (Agency only)
- `POST /api/clients` — create client
- `PATCH /api/clients/[id]` — update client profile
- `DELETE /api/clients/[id]` — archive client (soft)
- `POST /api/departments/choose` — save Growth/Pro chosen depts

### Integrations
- `POST /api/integrations/muapi` — image or video generation
- `POST /api/integrations/muapi/publish` — TikTok/YT/IG publishing
- `POST /api/integrations/listmonk` — create email campaign
- `POST /api/integrations/docuseal` — send doc for e-signature
- `POST /api/integrations/twenty` — create CRM contact/opportunity
- `POST /api/integrations/chatwoot` — open support ticket from output

### Stripe
- `POST /api/stripe/checkout` — start plan checkout
- `POST /api/stripe/checkout-addon` — start $29 extra dept checkout
- `POST /api/stripe/portal` — open Customer Portal session
- `POST /api/stripe/webhook` — subscription lifecycle events

### Setup (idempotent migrations, safe to re-run anytime)
- `POST/GET /api/setup/businesses` — create/migrate businesses collection
- `POST /api/setup/subscriptions` — create/migrate subscriptions collection
- `POST/GET /api/setup/stripe` — provision products + prices
- `POST/GET /api/setup/bookings` — create/migrate bookings + biz scheduling fields
- `POST/GET /api/setup/clients` — create/migrate clients + tag fields on documents/bookings/scheduled_content
- `POST /api/setup/calendar` — create scheduled_content collection

### Worker
- `GET /api/worker/scheduled` — daily cron at 08:00 UTC, runs due `scheduled_content` items

### Webhooks
- `POST /api/webhooks/chatwoot` — inbound message events, drafts AI replies as private notes
- `POST /api/stripe/webhook` — subscription events

### Admin
- `GET /api/admin/data` — clients, document stats, cold users (operator only)

---

## 17. Build Status — Honest Audit

### ✅ Phase 0 — DONE
- max_tokens raised to 8192
- Prompt caching on all Claude calls
- Rate limiting on /api/agent
- `packages/agents` extracted with 83 specialists
- `apps/api` skeleton exists (not wired)

### ✅ Phase 1 — DONE
- 6-step onboarding with website prefill
- Admin dashboard with cold-user tracking
- All 9 department pages + CEO
- Department picker (Growth picks 1, Pro picks 3)
- Department add-on ($29/mo) Stripe SKU
- Calendar + Library + Templates + Vault
- 7-day money-back FAQ
- Compliance: Privacy Policy + Terms of Service + AI disclosure + GDPR/CCPA section
- Starter pack fixed (Customer Service Responder swapped in)

### ✅ Phase 2 — DONE
- Listmonk + Docuseal + Plausible + Twenty CRM + Chatwoot all wired and live
- In-house scheduler (replaced Cal.com): public `/book/[slug]`, availability API, host notifications
- Shareable doc links via `/doc/[id]` + Share button
- Daily content calendar worker via Vercel cron
- Plausible analytics live
- Agent memory (last 2 docs same user+dept)
- Chatwoot inbound webhook auto-drafts replies as private notes

### ✅ Phase 3 — partially DONE
- ✅ CEO cross-department orchestrator (synthesizes across unlocked depts)
- ✅ Agency multi-client dashboard + ClientSwitcher
- ✅ Comp logic for jrw-solutions
- ✅ Muapi integration for image + video generation
- ✅ Smart model routing (Flux Pro / Recraft / Ideogram / Kling / Hunyuan)
- ✅ Universal prompt distillation at the muapi route boundary
- ✅ Credit tracking schema + monthly auto-reset + comp 100× multiplier
- ✅ Social publishing to TikTok/YouTube/Instagram via Muapi
- ✅ Connected Accounts UI in Settings
- ✅ Visible save indicators, "Send to…" cross-functional UI (intelligence stub started, not finished — pending orchestrator refactor)
- ✅ Schedule-for-review button + calendar integration
- ✅ Resume banner ("Continue last session?") on dept entry

### ❌ MISSING / BROKEN (in priority order)

**Foundation gaps — both required before further "smart" features:**

1. **THE CENTRAL ORCHESTRATOR (the brain).** Multiple ad-hoc Claude calls scattered across routes. Must consolidate behind `/api/orchestrator` using the `ceo-agents-orchestrator` system prompt.
2. **THE LIVING VAULT (the memory).** Currently a flat business profile + chronological docs. Missing: conversation persistence, Qdrant embeddings, successful pattern tracking, semantic retrieval into agent context. This is the engine that makes STAFFD learn the business over time. Without it every session starts cold.

**Revenue and product gaps:**

3. **Stripe top-up SKUs.** Plan/dept-addon prices exist. Image/video credit top-ups do NOT. Need 6 one-time Stripe products + checkout flow + webhook handler that credits the user.
4. **Credits widget on dashboard.** No visible balance or "Top up" CTA. Users discover their limit by hitting 402.
5. **Intelligent cross-functional handoff.** Started but not shipped. Must route through the orchestrator (not be a standalone Claude call) and pull relevance from the Vault.
6. **Multi-turn conversation persistence.** Currently each turn creates a new document; full thread not preserved. Required precondition for the Vault's conversation history layer.
7. **3-Layer Briefing flow (UI).** Agents now ask intelligent questions (system prompts updated), but no structured "brief me" modal that walks users through a guided flow.
8. **Successful pattern tracking.** No system to mark + reuse prompts that produced extraordinary results.
9. **Smart Search UI for Pro+.** Semantic Vault search for power users. Requires Qdrant.
10. **White-label (Agency).** Per-client logos/branding on docs/booking pages.
11. **Studio Mode for Pro+.** Model picker + cost display toggle.

**Deferred / decided against:**

12. **Open-Generative-AI fork integration.** Decided against — Muapi backs everything (cleaner architecture).
13. **openreel-video.** Deferred — browser-based video editor, not generation. Future when video customers ask.
14. **MoneyPrinterTurbo.** Skipped — GPU infrastructure cost prohibitive vs. Muapi.
15. **Knowledge graph Vault (Phase 3).** After Qdrant is stable.
16. **Brand voice extraction (Phase 3).** Continuous extraction of voice patterns from kept work.
17. **The Demo Page.** Last by user's explicit rule. Demonstrates everything once everything works.

---

## 18. Key Decisions Log

This is the running record of locked product/architecture decisions. Anyone reading this should treat these as binding unless explicitly revisited.

1. **CEO is Pro/Agency only.** Not an add-on for Starter/Growth. Forces upgrade decision.
2. **Pricing always shows monthly subscription number.** Annual toggle adds "Billed annually at $X — save $Y" callout. Never shows effective per-month price as the headline.
3. **All video is HD.** No SD/HD split. Porsche, not Volkswagen.
4. **Default-to-action specialists.** Agents produce work on first response when vault provides enough context. Only ask one focused question when truly ambiguous.
5. **No competitor name leakage.** Never mention Midjourney, DALL-E, Stable Diffusion, etc. in user-facing copy or specialist outputs.
6. **STAFFD generates directly via Muapi.** Specialists don't tell users to paste into other tools. The Image Prompt Engineer's prompt goes straight to our generator.
7. **Universal distillation at the integration boundary.** Specialists produce whatever they normally produce. Muapi route handles extraction-to-prompt. No per-agent prompt engineering needed.
8. **Smart routing happens server-side and silently.** User picks aspect ratio. System picks model. Studio Mode for Pro+ to override.
9. **Cross-functional handoff is intelligent.** System suggests next steps based on what was produced and the user's unlocked plan. Locked depts shown as upgrade triggers.
10. **Comp accounts use the same code path.** No special UI. They simply resolve as `plan: agency` with 100× credits. Easy to revoke.
11. **No tracked-changes amends to commits.** New commit on each meaningful change.
12. **Voice is non-negotiable.** "Staff", "specialists", "hire", "promote". Never "AI team", "agents", "subscribe", "upgrade".
13. **The Vault is living memory, not a profile.** Profile + work history + conversation history + successful patterns + brand voice corpus + decisions made. Every interaction adds to it. Every retrieval is semantic.
14. **Graphify is dev-time only.** It maps code, not business data. Wrong tool for the Vault. Used by the team building STAFFD, not by the user-facing runtime.
15. **Qdrant is the Vault's memory engine.** Right tool for semantic retrieval. One instance on Railway serves all users via per-user (or per-user-per-client) collection scoping.
16. **Brain and Memory are co-equal foundations.** Orchestrator without Vault is a smart router with no context. Vault without Orchestrator is a smart database with no decision-maker. Both must exist before further "smart" features.

---

## 19. Onward — Build Priorities

**The first TWO are foundation and they're co-equal.** Everything else depends on them being built right. Build them in parallel if practical, but neither ships meaningfully until both exist.

### 🧠 FOUNDATION 1 — The Brain (Central Orchestrator)

Build `/api/orchestrator` using the `ceo-agents-orchestrator` system prompt as its operating instructions. Single entry point for every "smart" decision: Command Center routing, CEO weekly briefings, cross-functional handoff suggestions, intent classification, dispatch to the right specialist with the right context. Refactor `/api/orchestrate`, `/api/briefing`, and any future ad-hoc Claude calls to route through it. **Hard rule: any new "smart" feature MUST go through the orchestrator. No more scattered Claude calls.**

### 🧬 FOUNDATION 2 — The Memory (Living Vault via Qdrant)

Deploy Qdrant on Railway. Wire embedding pipeline (voyage-3 or openai text-embedding-3-large). Build:

- **Conversation persistence layer.** New `conversations` collection in PocketBase that captures every turn (department, agent, user message, assistant message, timestamp, document_id if it produced an artifact). Threads survive sessions.
- **Embedding pipeline.** On every document save and every conversation turn, embed and store in Qdrant. Collection scoped per user (or per user+client for Agency).
- **Pattern tracking.** When a user keeps / shares / regenerates / publishes a work, mark its prompt+output as a "successful pattern." Store with extra weight in Qdrant.
- **Semantic retrieval into agent context.** Every agent run queries Qdrant for the 5-10 most semantically relevant artifacts (not "last 2 same-dept docs") and injects them as living memory.
- **Smart Search UI for Pro+.** Pro and Agency users get a search bar that semantically queries their entire Vault — "find every reference to refund policy across my work."

The orchestrator and the Vault are co-equal because the brain's decisions are only as good as the memory it reads from. A brilliant orchestrator with no memory is just a smart router. A rich vault with no orchestrator is just a smart database. Together they're the platform.

---

### After Foundation — Parallelizable

3. **Ship the credit top-up flow.** 6 Stripe one-time SKUs ($9.99 / $24.99 / $54.99 image packs + $22.99 / $54.99 / $109.99 video packs) + checkout + webhook → `addTopupCredits()`. Add a `Credits` widget to the dashboard showing remaining balance + a "Top up" CTA when low.

4. **Intelligent cross-functional handoff (through orchestrator).** Replace the dumb Send-to picker with 2-3 smart suggestions per output. Locked depts shown as upgrade triggers. Tied directly to the orchestrator + uses the Vault for relevance.

5. **Studio Mode for Pro+.** Power-user toggle that exposes model picker + per-generation cost.

6. **White-label polish.** Per-client logos on document headers and booking pages.

7. **Knowledge graph (Phase 3 Vault).** After Phase 2 Qdrant is stable. Facts as nodes, relationships as edges. CEO queries it for cross-cutting briefings.

8. **Demo page.** Last. Wraps everything as a sales walkthrough.

---

## 20. How to read this document

- **Sections 1-4** describe what the product is.
- **Sections 5-6** describe the brain and stack.
- **Sections 7-10** describe the code structure and core flows.
- **Sections 11-14** describe specific subsystems.
- **Sections 15-16** are operational reference (env vars, routes).
- **Sections 17-19** are the build state and priority queue.
- **This section** explains the others.

When a new conversation begins, the model should read this doc first and treat Section 17 (Build Status) and Section 19 (Onward) as the active work list.

---

*End of Architecture Specification.*
