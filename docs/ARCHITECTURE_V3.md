# STAFFD — ARCHITECTURE V3

> Successor to `ARCHITECTURE.md`. This is the live architecture as of Phase 1
> cleanup. The previous doc is kept at the repo root for historical reference;
> when this doc and that doc disagree, **this doc wins**.

---

## 1. Overview

STAFFD is an autonomous work platform for SMBs, built around two core primitives:

### The Brain
An orchestrator that interprets user intent, routes work to the right department, executes via LLMs, and performs cross-functional collaboration. Single public entry point: `/api/orchestrator`.

### The Vault
A living memory system that stores documents, summaries, patterns, decisions, voice fingerprint, and outcome-driven insights. Every artifact STAFFD produces or receives feeds the Vault; every agent run consults it.

STAFFD's differentiation comes from:

- Owned service stack (Listmonk, Docuseal, Twenty, Chatwoot, Plausible) — competitors integrate via paid 3rd parties, STAFFD owns the binaries
- Structured memory with outcome feedback loops
- Autonomy (Morning Brief; nightly per-user runs)
- Brand voice fingerprint (per-user voice extraction injected into every applicable agent)
- Industry-specific agent packs from a 195-agent curated library
- A full daily SMB operations loop, not isolated AI features
- Mobile-first PWA

---

## 2. System diagram

```
                    ┌────────────────────┐
                    │  User (browser/PWA) │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │  Frontend (Next 16) │
                    │  Dashboard + Rooms  │
                    └─────────┬──────────┘
                              │
              ┌───────────────┼─────────────────┐
              │               │                 │
   ┌──────────▼─────┐ ┌───────▼────────┐ ┌──────▼──────┐
   │  /api/agent    │ │ /api/orchestr. │ │ /api/vault/*│
   │ (non-CEO gen)  │ │   (Brain)      │ │  (writes)   │
   └────────┬───────┘ └────────┬───────┘ └──────┬──────┘
            │                  │                │
            └──────────┬───────┴────────┬───────┘
                       │                │
              ┌────────▼────────┐  ┌────▼─────────┐
              │   Vault         │◄─┤ Integrations │
              │  (PB + Qdrant)  │  │  outcomes    │
              └────────┬────────┘  └──────────────┘
                       │
              ┌────────▼────────┐
              │ Nightly Worker  │
              │ Morning Brief   │
              └────────┬────────┘
                       │
                    Push notification
                       │
                   User (8am)
```

---

## 3. Components

### 3.1 Frontend (`apps/web`)

Next.js 16 App Router, TypeScript, Turbopack, Tailwind v4, deployed on Vercel.

Surfaces:
- Landing (`/`), pricing, privacy, terms
- Auth (PocketBase session)
- 6-step onboarding with website prefill
- Dashboard with Command Center + dept grid
- 10 department workspaces (one room per dept)
- Library, Vault, Templates, Calendar, Settings, Clients (Agency)
- Admin (IP-gated)
- Public surfaces: `/doc/[id]` (shared docs), `/book/[slug]` (booking)
- Mobile PWA (planned in Phase 7 of the build roadmap)

### 3.2 Brain (`apps/web/app/api/`)

**Single public entry point.** `POST /api/orchestrator` accepts an `intent`:

| Intent | Purpose |
|---|---|
| `route` | Command Center routing — pick the unlocked dept best suited to a user message |
| `handoff` | Cross-functional next-step suggestions for a generated artifact |
| `brief` | CEO weekly briefing synthesis |
| `synthesize` | CEO cross-department synthesis for any user query |

**Thin backward-compat wrappers** (kept so the UI doesn't have to change all at once):
- `POST /api/orchestrate` — streams the orchestrator's `route` decision as `<rationale>\n\nREADY:{...}` so `CommandCenter.tsx` keeps working
- `POST /api/briefing` — calls `intent:"brief"` and streams the result
- `POST /api/handoff/suggest` — calls `intent:"handoff"` and returns JSON
- `POST /api/agent` for CEO dept — delegates to `intent:"synthesize"` internally (non-CEO depts run their own Anthropic call directly)

**Brain responsibilities:**
- Interpret user input
- Resolve agent identity (caller-supplied or department default from `getDepartmentDefaultAgent()`)
- Pull context from the Vault via `retrieve()`
- Pull cross-department workload + prior CEO continuity for `synthesize`
- Execute the LLM call via the single guardrail wrapper (`_lib/orchestrator/llm.ts`)
- Apply per-intent deadlines, retries, and structured fallbacks
- Log every decision to `orchestrator_decisions`

### 3.3 Specialists (`packages/agents`)

83 named specialists across 10 departments, plus a department-default map (`DEPARTMENT_DEFAULT_AGENT_IDS`) so the Brain always has a canonical agent for each room when no agent id is supplied.

Each agent:
- Has a system prompt with role, principles, output format, quality bar
- Lives in `packages/agents/src/departments/{dept}.ts`
- Exported as one flat `allAgents` array + per-dept arrays
- Looked up by id via `getAgent(id)` or by dept default via `getDepartmentDefaultAgent(dept)`

**Single source of truth.** No system prompts live elsewhere in the codebase. The legacy `_lib/dept-prompts.ts` and the legacy inline prompt map in the scheduled worker were both removed in Phase 1.

### 3.4 Vault

PocketBase collections (live):

| Collection | Purpose |
|---|---|
| `businesses` | Business profile (the static layer of the Vault) |
| `subscriptions` | Plan + credits + rate limit counters |
| `documents` | Every produced artifact (with `summary` + `tokens` fields, V1) |
| `conversations` | Per-turn chat history (`thread_id` groups turns) |
| `clients` | Agency multi-client roster |
| `bookings`, `scheduled_content`, `templates` | Calendar + content automation |
| `vault_embeddings_index` | One row per Qdrant point — denormalized summary, weight, dept |
| `vault_patterns` | kept/shared/published/regenerated signals |
| `vault_retrieval_metrics` | One row per `retrieve()` call — latency, items, cost flag |
| `vault_ingest_queue` | Job queue for summarize+embed worker |
| `orchestrator_decisions` | One row per orchestrator request — intent, attempts, latency, fallback, vault cost flag |

Planned (not yet built):
- `vault_voice_profile` (Phase 2 / Task #1 — Brand Voice Fingerprint)
- `vault_decisions` (Phase 5 — decisions made, with scope + expiration)
- `vault_outcomes` (Phase 5 — outcome feedback from Listmonk/Plausible/Docuseal)
- `vault_briefs` (Phase 6 — Morning Brief artifacts)
- `vault_clusters` (Phase 5+ — monthly cluster-summarization rollups)

**Summary storage.** Per-document summaries are denormalized on `documents.summary` AND on `vault_embeddings_index.summary` for retrieval speed — no separate `vault_summaries` table exists today.

**Vector store.** Qdrant on Railway. Per-user (or per-user-per-client) collections via `userCollection(userId, clientId?)`. Cosine similarity. Vector dim pinned to embedding provider (Voyage 1024 / OpenAI 3072) to prevent dim mismatch.

**Embeddings.** Voyage-3 primary, OpenAI `text-embedding-3-large` fallback for transient Voyage outages. Provider pinned per user-collection so mid-flight fallbacks that produce mismatched dims are skipped (the job re-queues and retries).

### 3.5 Integrations (`apps/web/app/api/integrations/`)

| Integration | Status | Purpose |
|---|---|---|
| **Muapi** | ✅ live | Image + video gen + social publishing |
| **Listmonk** | ✅ live | Email campaigns + transactional |
| **Docuseal** | ✅ live | E-signature requests |
| **Twenty CRM** | ✅ live | Contacts + opportunities |
| **Chatwoot** | ✅ live | Support tickets + inbound webhook for AI draft replies |
| **Plausible** | ✅ live | Privacy-first analytics |
| **PocketBase** | ✅ live | Auth, DB, files |

Deleted in Phase 1 cleanup:
- `integrations/replicate/` (predated Muapi consolidation; was an empty stub)
- `integrations/cal/` (in-house `/book/[slug]` replaced it; was vestigial)

### 3.6 Autonomous layer (planned — Phase 6)

Nightly cron worker per active user:

1. CEO synthesizes the prior day's activity
2. Marketing drafts 2–3 next-day posts (tied to content calendar)
3. Reputation drafts replies to open Chatwoot tickets / reviews
4. Operations checks calendar + drafts reminders
5. Sales surfaces top 20 CRM contacts due for follow-up
6. Compile output into a single `vault_briefs` row
7. Push notification at user's chosen wake time
8. User opens app → single "Morning Brief" card → approve/review-each/dismiss
9. Decisions thread back into `vault_decisions` for next night's synthesis

---

## 4. LLM Routing (locked policies)

Today:

| Intent / Workload | Model | Notes |
|---|---|---|
| `route` | claude-sonnet-4-6 | max_tokens 512, deadline 4s, retries 0 |
| `handoff` | claude-sonnet-4-6 | max_tokens 1024, deadline 6s, retries 0 |
| `brief` | claude-sonnet-4-6 | max_tokens 4096, deadline 25s, retries 1 |
| `synthesize` | claude-sonnet-4-6 | max_tokens 4096, deadline 30s, retries 1 |
| Doc generation (non-CEO) | claude-sonnet-4-6 | max_tokens 8192, streamed |
| Summarization | claude-haiku-4-5 | max_tokens 256, deadline 4s, retries 1 + extractive fallback |

Planned (Phase 3 — Model Routing PR):

| Intent / Workload | Model |
|---|---|
| `route`, `handoff`, summarize, short-form drafts (<350 chars expected) | Haiku |
| `brief`, `synthesize`, legal, finance | Sonnet (+ extended thinking) |
| Long-form marketing/sales drafts | Sonnet |
| Captions, short replies (optional) | Llama 3.1 70B via Groq |

Cost target: 40–70% reduction vs. all-Sonnet baseline.

---

## 5. Data flow

**Write side.** User input → orchestrator (or agent) → LLM → output streamed to user. Output saved to `documents` (client-side or server-side depending on path) → fire-and-forget `POST /api/vault/enqueue` → job lands in `vault_ingest_queue` → cron worker drains → V3 summarization + V2 embedding → Qdrant point + `vault_embeddings_index` row.

Conversations: every `/api/agent` turn writes a `conversations` row + enqueues for ingestion (V5).

Patterns: user clicks Share/Publish → `POST /api/vault/patterns` → `vault_patterns` row + weight bump on matching `vault_embeddings_index` rows + Qdrant payload merge (V6).

Outcomes (planned, Phase 5): Listmonk/Plausible/Docuseal webhooks → `POST /api/vault/outcome` → impact metric on the source pattern → weight boost.

**Read side.** Any agent run → `retrieve(userId, query, {topK, maxTokens, intent, preferDept, clientId})` → Qdrant cosine + normalized weighting → trim to token cap → return items + cost flag. Items injected as `--- LIVING MEMORY ---` block in the system prompt.

---

## 6. Deployment + infra

| Layer | Where |
|---|---|
| Frontend + API + workers | Vercel (Pro plan; required for `*/1` cron) |
| PocketBase | Railway (single instance) |
| Qdrant | Railway |
| Listmonk, Docuseal, Twenty, Chatwoot, Plausible | Railway (forked from each project) |
| Muapi | external (api.muapi.ai) |
| Anthropic | external (api.anthropic.com) |
| Voyage / OpenAI | external |
| Stripe | external |

Cron jobs (`vercel.json`):
- `0 8 * * *` → `/api/worker/scheduled` (content calendar + daily Vault p95 rollup)
- `* / 1 * * * *` (every minute) → `/api/worker/vault` (drains `vault_ingest_queue`)

---

## 7. Required + recommended env vars

See `scripts/preflight-check.mjs` for the live verification. Summary:

**Required (app breaks without these):**
`NEXT_PUBLIC_POCKETBASE_URL`, `PB_ADMIN_EMAIL`, `PB_ADMIN_PASSWORD`, `ANTHROPIC_API_KEY`, `MUAPI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICES`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `WORKER_SECRET`.

**Required for Vault Phase 2:**
`VOYAGE_API_KEY` (or `OPENAI_API_KEY`), `QDRANT_URL`, `QDRANT_API_KEY`.

**Optional integrations:**
Listmonk, Docuseal, Twenty, Chatwoot, Plausible env triplets.

**Admin gate:** `ADMIN_IP`.

**Recommended to add (not yet wired):**
`SENTRY_DSN`, `POSTHOG_KEY`, `EMAIL_FROM`, `EMAIL_REPLY_TO`.

---

## 8. Build roadmap reference

The live build sequence is tracked in conversation, not in this doc. Current ordering:

1. ✅ Foundation 1 (Brain) — B1 through B5
2. ✅ Foundation 2 (Vault) — V1 through V6
3. **🟢 Phase 1 cleanup (this PR)** — kill cruft, single-source agent fallbacks, preflight script
4. Phase 2 — Brand Voice Fingerprint (`vault_voice_profile`)
5. Phase 3 — Model Routing
6. Phase 4 — Stripe CEO add-on + top-ups
7. Phase 5 — Vault outcome feedback loop
8. Phase 6 — Nightly autonomous Morning Brief
9. Phase 7 — Mobile PWA + push
10. Phase 8 — Industry packs

---

## 9. Notes on previous documents

- `ARCHITECTURE.md` (root): preserved for historical reference; contains the original Brain + Vault audit and the v2 build roadmap. Section 17's "missing" list is now stale where Foundation 1 + 2 are complete.
- `apps/api/README.md`: deleted alongside `apps/api/` in Phase 1.
- `BRAND_VOICE.md`: still authoritative for voice rules across the product.
