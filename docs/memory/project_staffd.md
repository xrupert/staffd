---
name: project-staffd
description: "STAFFD — AI business platform. Full locked vision, architecture, pricing, repo roles, and build phases."
metadata: 
  node_type: memory
  type: project
  originSessionId: b4199b94-d192-4163-a708-83951f3773e5
---

# STAFFD — Locked Product Vision

AI-powered business operating system for SMBs, solopreneurs, freelancers, agencies. Agents organized as departments — users direct, not operate.

**Positioning:** Porsche — premium only, no free tier, demo-based selling  
**Tagline:** "You're STAFFD"  
**Brand:** LSU Purple #5B21E8, dark bg #09090F, steel grays. Logo: 2x2 grid blocks, boxed D in wordmark.  
**User email:** chris.rupert@cybridagency.com  
**Live repo:** C:\Users\xrupe\staffd → github.com/xrupert/staffd  
**Deployed:** Vercel (auto-deploy main) + Railway (PocketBase: https://pocketbase-production-4774.up.railway.app)

---

## LOCKED PRICING MODEL

| Plan | What's included | Price |
|------|----------------|-------|
| Starter | 6 pre-curated agents (we pick) + 3 trial runs of any locked dept | $39/mo |
| Growth | Starter + 1 full department | $79/mo |
| Pro | Starter + 3 full departments + CEO included | $149/mo |
| Agency | All 8 departments + CEO + multi-client + white-label | $450/mo |

- Extra department add-on: $29/dept/mo (Growth and Pro)
- CEO add-on: $49.99/mo (Starter and Growth only — Pro/Agency it's included)
- **No micro-transactions** — rejected. Instead: 3 free trial runs of any locked department, then hard gate with upgrade prompt.
- Slots are NOT how we sell — departments are. User chooses departments, not individual agents.

**Starter pack 6 agents (we curate, user doesn't choose):**
Content Creator, SEO Specialist, Social Media Strategist, Sales Outreach, Customer Service Responder, Document Generator

---

## LOCKED DEPARTMENT MODEL (8 departments)

Departments = rooms. Agents = specialists inside the room. Users describe what they need, Command Center routes to right agent automatically. Users can also browse the roster.

| Dept | Key agents from agency-agents repo | External service |
|------|------------------------------------|-----------------|
| **Marketing** | content-creator, social-media-strategist, seo-specialist, growth-hacker, linkedin-creator, instagram-curator, tiktok-strategist, twitter-engager, podcast-strategist, video-optimizer, carousel-engine, agentic-search-optimizer, book-co-author | Listmonk (email sends) |
| **Paid Media** | paid-media-auditor, creative-strategist, paid-social-strategist, ppc-strategist, programmatic-buyer, search-query-analyst, tracking-specialist | — |
| **Sales** | sales-account-strategist, outbound-strategist, outreach, deal-strategist, discovery-coach, proposal-strategist, pipeline-analyst, sales-coach, sales-engineer, data-extraction | Twenty CRM |
| **Legal** | legal-document-review, legal-client-intake, legal-billing-time-tracking, compliance-auditor, legal-compliance-checker | Docuseal (e-sign) |
| **HR** | hr-onboarding, recruitment-specialist, corporate-training-designer, chief-of-staff | — |
| **Finance** | bookkeeper-controller, financial-analyst, fpa-analyst, tax-strategist, investment-researcher, accounts-payable, finance-tracker | — |
| **Operations** | supply-chain-strategist, automation-governance, data-consolidation, report-distribution, project-manager-senior, project-shepherd, document-generator, analytics-reporter, executive-summary-generator | — |
| **Design** | design-brand-guardian, image-prompt-engineer, inclusive-visuals, ui-designer, ux-architect, ux-researcher, visual-storyteller, whimsy-injector | Open-Generative-AI (image gen) |

**CEO Function** (Pro included, add-on for others): chief-of-staff + product-manager + product-feedback-synthesizer + agents-orchestrator. Cross-dept strategy, Vault health monitoring, weekly briefings, pre-emptive suggestions.

---

## LOCKED REPO ROLE MAP

### Dev tools (used by US while building — not shipped in product)
| Repo | Role |
|------|------|
| **Superpowers** | Claude Code skills methodology — ALREADY ACTIVE in every dev session |
| **Graphify** | Maps codebase into knowledge graph for AI dev assistants — run `/graphify .` anytime |
| **Agent-skills** | Engineering discipline slash commands (/spec /plan /build /ship) |
| **Taste-skill** | Anti-slop frontend quality enforcement during UI development |
| **Agency-agents** | 195 SOURCE agent prompt files — ADAPTED + CONSOLIDATED into packages/agents. Deployed result = **146 agents** (83 generic across 10 depts + 63 industry-packed across 8 packs). The ~49 difference is dedup/merge during curation, NOT loss. Verified in code 2026-06-15. Public pages advertise **83** (generic only; pack agents are entitlement-gated via W54.1 and appear only when the pack is owned). |

### Self-hosted services (deploy on Railway/Hetzner, STAFFD calls our own instances via apps/api)
| Repo | Role | Deploy target |
|------|------|--------------|
| **Listmonk** | Email campaign delivery — The Marketer sends real campaigns | Railway |
| **Chatwoot** | Support + reputation monitoring — The Reputation dept | Railway |
| **Docuseal** | E-signatures — The Closer sends contracts | Railway |
| **Cal.diy** | Scheduling — The Closer books appointments | Railway |
| **Twenty** | CRM backbone — Sales dept pushes leads | Railway |
| **Open-Generative-AI** | 200+ model image/video gen — The Designer | Railway |
| **openreel-video** | Browser-based video editor — The Producer | Embedded in UI |
| **Plausible (analytics)** | Privacy-first platform analytics | Hetzner VPS |
| **Appsmith** | Super-admin dashboard builder | Hetzner VPS |
| **PocketBase** | Auth, DB, files — ALREADY LIVE | Railway ✅ |

**Critical rule:** apps/web NEVER calls Listmonk, Docuseal etc. directly. Always calls apps/api which calls the service. Clean abstraction — swap services without touching frontend.

### Pattern to implement (not a library to import)
| Repo | What we do with it |
|------|-------------------|
| **Hermes (hermes-agent-control-room)** | Implement the Control Room → Orchestrator → Specialists → Task Bus pattern in apps/api |

---

## LOCKED ARCHITECTURE

```
staffd/
├── apps/
│   ├── web/        ← Next.js frontend (EXISTS ✅)
│   ├── api/        ← Bun/Hono — orchestration + all service calls (BUILD PHASE 0)
│   └── workers/    ← Background jobs — CEO briefings, ML, scheduled outputs (PHASE 2)
├── packages/
│   ├── agents/     ← Named agent definitions adapted from agency-agents (BUILD PHASE 0)
│   ├── ui/         ← Design system (EXISTS partially, expand later)
│   └── types/      ← Shared TypeScript types (BUILD WITH api/)
└── services/       ← Docker/Railway configs for self-hosted services (PHASE 2)
```

**Orchestration flow:**
```
apps/web → apps/api (Bun/Hono orchestrator) → specialist agent in packages/agents
                                             → external service (Listmonk/Docuseal/etc.)
```

**Vault (Phase 1):** Structured JSON passed as context — fine for V1.  
**Vault (Phase 2):** Vector embeddings (pgvector) for semantic retrieval.  
**Vault (Phase 3):** Full knowledge graph with semantic queries.

---

## WHAT'S BUILT (the shell — apps/web only)

- Homepage ✅ | Auth ✅ | Onboarding (6 steps + website auto-fill) ✅
- Dashboard + Command Center (basic routing, not Hermes pattern yet) ✅
- 7 dept pages as single-agent (wrong model, to be rebuilt as multi-agent containers) ✅
- Document Library (auto-save, search, filter, PDF/Word export) ✅
- Templates (user-defined) ✅ | Vault (flat form, not knowledge graph) ✅
- PDF + Word export ✅

**Known bugs/gaps in shell:**
- `max_tokens: 1024` — agents cap at ~750 words. Must fix immediately.
- No prompt caching — vault context re-processed every call. Cost waste.
- No rate limiting — anyone can spam Claude API for free.
- Onboarding creates duplicate businesses records if run twice.

---

## BUILD PHASES

### Phase 0 — Fix & Foundation (DO FIRST, no new features)
1. `max_tokens` 1024 → 8192 in all Claude calls
2. Prompt caching on ALL Claude API calls (system prompt cache)
3. Rate limiting on /api/agent (per-user, per-day)
4. Extract `packages/agents` — pull agency-agents prompts, adapt with vault context injection
5. Create `apps/api` skeleton with Bun/Hono (even basic structure establishes correct pattern)

### Phase 1 — MVP Corrected
6. Department pages rebuilt as multi-agent containers (roster UI + auto-routing)
7. Admin dashboard /admin — clients, usage, last active, cold users (IP-gated to Chris only)
8. Onboarding guard — prevent duplicate businesses records
9. Pre-built STAFFD templates (invoice, NDA, SOP) + PDF page-break CSS fix
10. Stripe + paywall + subscription middleware (trial runs logic)
11. Demo page (homepage "Watch the demo" dead link)

### Phase 2 — First Service Integrations
12. Deploy Listmonk → Marketing dept sends real campaigns
13. Deploy Docuseal → Legal/Sales sends contracts for e-sign
14. Deploy Plausible → platform analytics
15. Shareable document links (client-facing)
16. Agent memory (reference prior outputs in new generations)
17. Content calendar + scheduled outputs (first apps/workers job)
18. Account settings page

### Phase 3 — Full Platform
19. Deploy Chatwoot → Reputation department live
20. Deploy Cal.diy → Closer books real appointments
21. Deploy Open-Generative-AI → Designer department live
22. Deploy openreel-video → Producer department live
23. Deploy Twenty → Sales CRM connected
24. CEO function: Vault health monitoring, weekly briefings, cross-dept coordination
25. Vault semantic retrieval (vector embeddings, pgvector)
26. ML layer: personal voice learning per user
27. Agency plan: multi-client dashboard (Hermes pattern fully implemented)
28. White-label (custom domain, logo, color swap)
29. Cloudflare R2 for file storage
30. Cloudflare CDN + DDoS

---

## COMPLIANCE (not yet built — required before public launch)
- Privacy policy with explicit AI disclosure
- Terms of service with data usage clauses
- No training on user data without opt-in
- GDPR: right to deletion, data export, cookie consent (Plausible = no cookies)
- CCPA: California privacy rights disclosure
- PocketBase admin panel IP-restricted on Railway in production

---

## IMMUTABLE PRODUCT CONSTRAINTS
- No free tier — demo-based selling. Porsche doesn't give anything away.
- No personal data as placeholders anywhere — generic examples only
- No free advertising for other apps named in UI
- Stripe is last to build
- Demo page is last to build (after everything works)
- Documents must be perfect in PDF/Word — no page breaks cutting items mid-flow
- Quick-actions auto-run on click (no extra Generate step)
- "We are building a Porsche" — premium only, no misaligned elements, no cheap UI
