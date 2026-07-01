# STAFFD — Connections & Plug-In Reference

**Purpose:** every external service STAFFD talks to, in one place, so a new frontend (Lovable or otherwise) knows exactly what exists and how to reach it. This is a **map of connection points, not a secrets file** — every value below is an environment variable *name*, never an actual key/URL/password. Real values live in the Vercel and Railway dashboards for this project and must never be committed to the repo or pasted into a prompt.

Verified against the live codebase 2026-07-01 (`apps/web/lib/env.ts`, `apps/web/app/api/_lib/integrations/resolve.ts`, `apps/web/app/api/_lib/qdrant.ts`, `apps/web/app/api/_lib/llm-router.ts`, `.env.local.example`).

---

## 1. Repository

| | |
|---|---|
| **URL** | https://github.com/xrupert/staffd.git |
| **Branch** | `main` (protected by convention: feature branches → TDD → review → fast-forward merge → push) |
| **Monorepo layout** | pnpm + Turbo — `apps/web` (Next.js App Router app), `packages/agents` (department/agent definitions) |

---

## 2. Hosting

| Service | Role | Where configured |
|---|---|---|
| **Vercel** | Hosts the Next.js app (frontend + all `/api/**` serverless routes); deploys on push to `main` | Vercel project dashboard → Environment Variables |
| **Railway** | Self-hosts **PocketBase** and **Qdrant** — both run as Railway services | Railway project dashboard |

---

## 3. Database, Auth & File Storage — PocketBase

The system of record for everything: users, documents, conversations, subscriptions, clients, vault data, notifications — all of it.

| Env var | Purpose |
|---|---|
| `NEXT_PUBLIC_POCKETBASE_URL` | The PocketBase instance URL (client- and server-resolved). Example shape: `https://your-pocketbase-instance.railway.app` |
| `PB_ADMIN_EMAIL` / `PB_ADMIN_PASSWORD` | Superuser credentials the API layer uses to mint short-lived admin tokens for privileged operations (row-rule setup, cascade deletes, cross-collection lookups) |

**For Lovable:** if the new frontend talks to PocketBase directly (e.g. for auth or simple reads), it needs only `NEXT_PUBLIC_POCKETBASE_URL` and a user's own session token — never the admin credentials, which must stay server-side only.

---

## 4. Vector Search — Qdrant

Backs the Business Vault's semantic retrieval (RAG). Self-hosted on Railway.

| Env var | Purpose |
|---|---|
| `QDRANT_URL` | The Qdrant instance URL |
| `QDRANT_API_KEY` | Sent as the `api-key` header on every request |

Collection naming convention (useful if building any admin/debug tooling): `vault_{userId}` per customer, or `vault_{userId}__{clientId}` for an agency acting on behalf of a client.

---

## 5. LLM Providers

| Provider | Env var | Role |
|---|---|---|
| **Anthropic Claude** | `ANTHROPIC_API_KEY` (must start with `sk-ant-`) | Primary reasoning model. Sonnet for department-critical work (Legal, Finance, Operations) and synthesis/brief intents; Haiku for cheap/short-form and as the universal fallback |
| **Groq (Llama 3.1 70B)** | `GROQ_API_KEY` (optional) | Cost-optimized short-form generation. If unset, short-form tasks route straight to Anthropic Haiku instead — this is a genuine plug-and-play seam, not a hard dependency |

---

## 6. Image/Video Generation — Muapi

Platform-scoped (billed in STAFFD's own credit system, never a per-customer "connect your account" integration).

| Env var | Purpose |
|---|---|
| `MUAPI_URL` | Base API URL (defaults to `https://api.muapi.ai` if unset) |
| `MUAPI_API_KEY` | Auth key |
| `MUAPI_WEBHOOK_SECRET` | Verifies inbound generation-complete webhooks |

---

## 7. Vendor Integrations (Twenty, Chatwoot, Listmonk, Plausible, DocuSeal)

These five share one resolution pattern (`apps/web/app/api/_lib/integrations/resolve.ts`) — this is the actual "plug-and-play" mechanism already built, and it's the one Lovable should be told about explicitly:

**Resolution order, per user, per integration type:**
1. **The user's own stored credentials** (`user_integrations` collection, encrypted at rest) — if a customer has connected their own account, theirs wins.
2. **Operator-scoped environment variables** — but **only for the super-admin/operator account** (dogfooding STAFFD's own instances of these tools). A regular customer with nothing connected gets a clean "not connected" response — never silently falls back to the operator's data. This is the tenant-isolation guarantee for vendor integrations.

| Integration | Type key | Env vars (operator fallback) | What it's for |
|---|---|---|---|
| **Twenty** | `twenty` | `TWENTY_API_URL`, `TWENTY_API_KEY` | CRM — contacts, deals, the underlying store some STAFFD-native records mirror into |
| **Chatwoot** | `chatwoot` | `CHATWOOT_URL`, `CHATWOOT_API_KEY`, `CHATWOOT_ACCOUNT_ID` | Customer messaging/support inbox — powers the "reply to ticket" workflow recipe |
| **Listmonk** | `listmonk` | `LISTMONK_URL`, `LISTMONK_USERNAME`, `LISTMONK_PASSWORD` | Email/newsletter sending |
| **Plausible** | `plausible` | `PLAUSIBLE_API_URL` (or `NEXT_PUBLIC_PLAUSIBLE_URL`), `PLAUSIBLE_API_KEY`, `PLAUSIBLE_SITE_ID`; client tracking script uses `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` (defaults `urstaffd.com`) | Privacy-first, cookie-free product analytics |
| **DocuSeal** | `docuseal` | `DOCUSEAL_URL`, `DOCUSEAL_API_KEY` | E-signature — powers the "send for signature" workflow recipe |

**For Lovable:** every one of these should be treated as "may or may not be connected" — the frontend's job is to call the existing `/api/integrations/{type}` routes and render whatever state comes back (connected / not connected / error), never to assume a vendor is live.

---

## 8. Billing — BillingProvider seam

Stripe was fully removed 2026-06-25. There is currently **no billing provider configured** — every checkout/portal/cancel route returns a stable `503 { error: "billing_not_configured" }`. When a real processor (Paddle, Nickel, or otherwise) is chosen, it plugs into one function: `getBillingProvider()` in `apps/web/app/api/_lib/billing/provider.ts`. No env vars exist for this yet — they'll be introduced alongside whichever provider gets implemented against the seam.

---

## 9. App-level config

| Env var | Purpose |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Public base URL for outbound redirects (checkout success/cancel, etc.) — defaults to `https://urstaffd.com` |

---

## 10. Quick-reference table for a Lovable "Connections" panel

If building a settings/connections screen (the natural Lovable-side counterpart to this doc):

| Connection | Category | Customer-connectable? | Status endpoint |
|---|---|---|---|
| PocketBase | Core data | No — infrastructure | N/A (always on) |
| Qdrant | Core data | No — infrastructure | N/A (always on) |
| Anthropic / Groq | AI | No — infrastructure | N/A (always on) |
| Muapi | AI (image/video) | No — platform-billed | N/A (always on) |
| Twenty | CRM | Yes | `/api/integrations/twenty` |
| Chatwoot | Support inbox | Yes | `/api/integrations/chatwoot` |
| Listmonk | Email | Yes | `/api/integrations/listmonk` |
| Plausible | Analytics | Yes | `/api/integrations/plausible` |
| DocuSeal | E-signature | Yes | `/api/integrations/docuseal` |
| Billing provider | Payments | No — operator-configured | Returns 503 until wired |

---

## Appendix — The CEO Function, as a Prompt

The "CEO" department is not one monolithic persona — it's a family of **8 specialist agents** under one department, each with its own system prompt, selected either by default or by keyword-routing against the user's task. The default (`ceo-chief-of-staff`) is what fires when no more specific CEO specialist matches.

### The default CEO agent — Chief of Staff (verbatim production system prompt)

```
You are The Chief of Staff — STAFFD's cross-department strategic coordinator for business owners.

HOW TO USE THE VAULT:
Think like a trusted advisor who knows this business deeply. Use the vault context to ground every recommendation in their specific situation — their industry, competitive edge, current challenges, and what they most want off their plate. Think with it, don't quote it.

YOUR ROLE:
You help business owners see the full picture, cut through noise, and focus on what actually moves the needle. You coordinate across Marketing, Sales, Legal, HR, Finance, Operations, and Design — connecting dots the owner is too deep in the weeds to see.

WHAT YOU DO:
- Weekly briefings: what matters this week, what's at risk, what decisions need to be made
- Priority audits: what are they working on vs. what should they be working on
- Decision frameworks: when owners face complex decisions, help them think it through clearly
- Cross-department coordination: identify when Marketing needs to sync with Sales, or when Legal needs to review an Ops decision
- Health checks: where is the business strong, where is it fragile, top 3 priorities right now

PRINCIPLES:
- Be direct. Business owners need clarity, not options menus.
- Prioritize ruthlessly. The right answer is usually "do less, better."
- Strategy without execution is worthless — always end with numbered next steps.
- Acknowledge real constraints: time, money, team size. No ideal-world advice.
- If you see something they're not asking about but need to hear, say it.

OUTPUT FORMAT:
- Weekly briefs: This Week's Priorities → Key Decisions → Risks → Next Steps
- Priority audits: Current Focus → What Actually Matters → The Gap → Recommended Shift
- Decisions: Recommendation first, then 2-3 reasons why
- Health checks: What's Working → What's Broken → Top 3 Priorities

OUTPUT RULES:
- Deliver immediately. No preamble, no "great question."
- Use headers for structure.
- Specific — name the action, not just the category.
- Ready to act on today.
```

### The other 7 CEO specialists (selected by keyword/tag match against the task)

| Agent | Fires for |
|---|---|
| **Growth Strategist** | 90-day growth plans, revenue strategy, market positioning, business model analysis |
| **Product Manager** | Roadmaps, feature prioritization, MVP definition, user feedback synthesis |
| **Agents Orchestrator** | Multi-department tasks (e.g. a product launch touching Marketing + Sales + Legal + Operations at once) — this is the "meta-agent" that breaks a complex ask into a sequenced, department-by-department plan |
| **Sprint Prioritizer** | Force-ranking initiatives, kill-lists, 2-week execution sprints |
| **Trend Researcher** | Industry trend scans, weak-signal detection, strategic foresight |
| **Feedback Synthesizer** | Synthesizing customer/team/market feedback into themes and decisions |
| **Cultural Intelligence Strategist** | Market expansion, localization, cross-cultural risk |

### The CEO function, summarized (for product/scaffolding purposes)

If describing "what the CEO does" as a single product concept rather than quoting the literal prompt: **the CEO is the one specialist that sits above every department rather than inside one** — it's the business owner's cross-functional advisor, the thing that turns "I have 9 separate AI departments" into "I have a staff that talks to each other." Concretely, it: (1) delivers unprompted weekly priority briefings, (2) coordinates multi-department work by sequencing which specialist does what and in what order, (3) makes strategic calls (growth, product, positioning, prioritization) the same way a real chief-of-staff or fractional exec would, and (4) is the one place in the product where "ask a vague, big question about the business" gets a direct, decisive answer instead of a menu of options.
