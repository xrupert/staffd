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

### Add-ons (recurring)

| Add-on | Price | Who can buy it | Purpose |
|---|---|---|---|
| **Extra department** | $29/mo per dept | Growth, Pro | Add more departments without changing plan |
| **The CEO** | $49/mo | Starter, Growth | Get the cross-department CEO without promoting to Pro yet — also acts as a soft Pro upsell |

CEO add-on math is intentional: Growth ($79) + CEO ($49) = $128/mo. Pro is $149/mo and includes CEO **plus** 2 additional departments. $21/mo difference for substantial extra value = clear upsell at point of add-on purchase.

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

## 4.5 Agent Capabilities

The `AgentDef.capabilities` field declares what an agent can consume or produce beyond text generation. Capabilities are foundational for routing, context injection, and feature gating across STAFFD. Established by PR-Pre per Decision 23 (capability-first architecture).

### Current capability values

| Capability | Purpose | Consumed by |
|---|---|---|
| `ocr` | Image/PDF text extraction | Document Review pipeline (Bundle 5) |
| `vision` | Image content analysis | Document Review pipeline (Bundle 5) |
| `structured_extraction` | Schema-aware data extraction | Future structured query routing |
| `transcript_handling` | Audio transcript processing | DEFERRED (Bundle 7 telephony) |
| `voice` | Voice synthesis/recognition | DEFERRED (Bundle 7 telephony) |
| `scheduling` | Calendar event creation | DEFERRED (Bundle 7 + Connected Sources) |
| `urgency_classification` | Priority assessment | DEFERRED (Bundle 7 voicemail triage) |
| `reads_crm` | Twenty CRM READ access | Bundle 9 V2 (Sales agents) |
| `reads_email_campaigns` | Listmonk READ access | Bundle 9 V2 (Marketing agents) |
| `reads_support_history` | Chatwoot READ access | Bundle 9 V2 (Reputation agents) |
| `reads_signatures` | Docuseal READ access | Bundle 9 V2 (Legal/Sales agents) |
| `reads_analytics` | Plausible READ access | Bundle 9 V2 + Decision 47A (Growth/CEO/Marketing) |

### How capabilities are consumed

Routes and helpers check `agent.capabilities?.includes(...)` before injecting capability-specific context blocks. This follows the **capability-first architecture (Decision 23)** — new agent-side features are gated on declared capabilities, not hardcoded in routes.

PR-Pre ships the field as **optional** so all 138 existing agents continue to compile without modification. Declarations land in downstream PRs:
- OCR / vision → PR-Doc-Review-A (Tranche 6)
- CRM / email / support / signatures / analytics → PR-Bundle-9-A/B/C (Tranche 5)
- Voice / transcript / scheduling / urgency → DEFERRED (Bundle 7)

### Adding new capabilities

1. Extend `AgentCapability` union type in `packages/agents/src/types.ts`
2. Document purpose + consumer in the table above
3. Add capability declaration to relevant agent definitions
4. Implement consumer logic gated on `agent.capabilities?.includes(...)`

Per **Standard #7 (Audit-Before-Extend)**, new capabilities beyond the locked enum require explicit Senior Architect approval — get a 1-page architecture brief signed off before extending the union.

---

## 4.6 Execution Scope

STAFFD specialists fall into three execution-scope categories. The Zero-Confusion Output Rule + No-External-Execution Rule in `packages/agents/src/brand-laws.ts` enforce these category boundaries across all 138 agents via `applyBrandLawsToPrompt()`.

### ADVISORY ONLY (~45-55 agents)
Strategy, audit, planning roles. Output = recommendations the user must implement on external systems. Examples: SEO Specialist, Reputation Manager, Workflow Designer, CEO Chief of Staff.

**Zero-Confusion Output Rule applies:** every recommendation must include exact location + exact text + verification + rollback. The user must be able to execute in five minutes without opening Google, asking a friend, or guessing.

### PRODUCES ARTIFACT (~75-85 agents)
Writers, generators, drafters. Output = literal text/code the user copies into external systems. Examples: Content Creator, Document Drafter, Review Responder, Invoice Generator.

**Artifact IS the four-element answer.** User pastes verbatim into their CMS / email / platform. The artifact itself satisfies "exact text"; the surrounding agent output should still include location + verification + rollback when relevant.

### EXECUTES EXTERNALLY (0 agents — empty by design)
STAFFD agents NEVER silently write to a user's external system. External execution always requires explicit user button-click via integrations (Send to CRM, Send as Campaign, Send for Signature).

This category exists to track future emergence via watchlist trigger `b8-d-executes-externally-introduction`. Any agent that ever ships with `capabilities: [...]` implying external write requires Senior Architect approval to break the empty-by-design rule — and at that point, Decision 45's No-External-Execution Rule must still hold (user-click required for the write).

See `packages/agents/src/brand-laws.ts` for the No-External-Execution Rule enforced across all 138 agents.

---

## 4.7 Multi-Tenant Security Verification

STAFFD enforces multi-tenant isolation at the PocketBase row-rule level. Every user-scoped collection has row rules requiring `user = @request.auth.id` (or the equivalent relational pattern for collections like `document_versions`).

### Why row rules matter

Without correct row rules, a malicious user could:
- Read any other user's documents via direct PB API call
- Modify another user's records
- Delete another user's data

Row rules are the **security floor**. Application-layer auth (e.g., `/api/clients` Agency-tier gate) provides defense-in-depth, not replacement for row rules.

### Automated verification

Three surfaces enforce this:

1. **Diagnostic route** — `GET /api/admin/verify-row-rules` (super-admin only)
   Programmatically validates all user-scoped collection rules against expected patterns. Returns ✅ / 🔴 / ℹ️ status per collection.
2. **Security dashboard** — `/dashboard/admin/security` (super-admin only)
   Live status display, click-to-expand gap details, refresh button. Operator-facing.
3. **Daily cron** — `/api/worker/security-audit`
   Runs at 2 AM UTC daily, detects drift, logs structured findings. When `super_admin_signals` ships (Tranche 6), this will also alert via email.

### Operator runbook

See `docs/operator-runbooks/pb-row-rules.md` for step-by-step PB admin UI instructions to fix detected gaps.

### When to re-verify

- After any new collection ships (Setup Route Discipline + this verification combine)
- After any PocketBase schema migration
- Quarterly as routine practice
- Whenever the daily cron flags drift
- After any rule change, run `/api/admin/verify-row-rules` to confirm no drift

### Rule Enforcement via Setup Routes (Decision 69)

Per **Decision 69 — Security Floor Restoration via Code**, every user-scoped collection's setup route under `apps/web/app/api/setup/*` calls `ensureCollectionRulesWithFreshToken(collectionName)` after its schema work. This is the **primary** rule-enforcement mechanism.

Canonical pattern for new collections:

1. Define the collection schema in the setup route
2. After schema work succeeds, call `ensureCollectionRulesWithFreshToken("collection_name")`
3. The helper consults `apps/web/app/api/_lib/security/row-rules.ts` (single source of truth) and PATCHes the rules
4. Idempotent — re-running on a correctly-configured collection is a no-op

To add a new collection to the baseline:

1. Add an entry to `EXPECTED_COLLECTIONS` in `_lib/security/row-rules.ts`
2. Call `ensureCollectionRulesWithFreshToken("new_collection")` from its setup route
3. The verifier, repair endpoint, daily cron, and dashboard all pick up the new entry automatically (single source of truth — Standard #2)

### Repair Endpoint (safety net)

When PB rules drift outside of code paths (e.g., manual edits, migration tools, recovery), `POST /api/admin/repair-row-rules` (super-admin only) bulk-PATCHes every flagged collection back to the expected pattern. Idempotent — collections already at the expected state report `already-correct` without a PB write.

The security dashboard exposes a one-click "Run Security Repair" button when overall status is 🔴.

See `docs/operator-runbooks/security-floor-restoration.md` for full operator instructions.

### Templates G0 Fix (Decision 69 accelerated)

The Bundle 6 G0 anomaly (templates collection without a setup route) is **partially fixed** by Decision 69:
- `apps/web/app/api/setup/templates/route.ts` now exists and enforces row rules
- Schema mirrors current production (id, user, name, department, content)
- Tranche 7 PR-Templates-A extends this with the Model C schema (scope, variables, capabilities, tags, recency, pack/global)

This pattern — accelerate the foundational fix (collection setup + rules) ahead of the feature work (full Model C schema) — keeps security on the floor without blocking the Tranche 1 closure.

### 19-collection baseline (Decision 68 + Decision 71 refinements)

| Pattern | Collections | Count |
|---|---|---|
| `user = @request.auth.id` (USER_OWNED_RULES) | subscriptions, businesses, documents, vault_briefs, vault_decisions, vault_patterns, vault_retrieval_metrics, vault_voice_profile, vault_embeddings_index, conversations, conversation_threads, push_subscriptions, scheduled_content, bookings, orchestrator_decisions, **document_versions** (Decision 71), **templates** (Bundle 6 G0) | 17 |
| `agency_user = @request.auth.id` (AGENCY_OWNED_RULES) | clients | 1 |
| All-null admin-only (ADMIN_ONLY_RULES) — Decision 71 | vault_ingest_queue | 1 |
| PB auth-collection self-listing (USERS_AUTH_RULES) — Decision 71 | users | 1 |

Total inclusive: 20 entries (19 verified + templates with Bundle 6 G0 anomaly).

The verifier reports `ℹ️ unexpected_collection` for any PB collection not in this baseline — surfacing schema drift before it becomes a security gap.

### Decision 71 — Three Cleanup Resolutions

Pre-build verification for `PR-Tranche-1-Security-Cleanup` surfaced that three collections in the baseline had **incorrect expected patterns** grounded in misunderstandings of the actual PB schema:

1. **`vault_ingest_queue` → ADMIN_ONLY_RULES.** Schema has no `user` field by design; this is a backend-only queue collection that the vault ingestion worker operates via admin token. Users have no path to query it directly. Expected pattern is now all-null (admin-only).

2. **`document_versions` → USER_OWNED_RULES.** Schema has a denormalized `user` text field (deliberate PR-27 design for fast user-scoped queries). The previously expected `document.user = @request.auth.id` relational pattern was unworkable — `document` is a text field, not a PB relation, so PB cannot traverse it. The standard pattern works because `user` was already denormalized.

3. **`users.list = "id = @request.auth.id"` (was `null`).** Codebase grep confirmed zero callsites depend on a `null` list rule — `users` is only ever accessed via `auth-refresh` or single-record GET-by-id; admin paths use the admin token (which bypasses rules regardless). PB's default for auth collections is self-listing — the verifier was wrongly expecting `null`.

The `users` entry retains `systemManaged: true` (Decision 68) — the repair endpoint never modifies PB's auth-collection rules autonomously. The verifier reports `✅` when PB matches; any mismatch must be fixed manually in PB admin UI per the runbook.

### Decision 74 — Super-Admin Architecture (simplified)

**Identity model.** A user is super-admin iff `user.email === process.env.ADMIN_EMAIL` (single-admin Option α). Currently `chris.rupert@cybridagency.com`. Multi-admin infrastructure deferred to backlog (Option γ).

**Single canonical helper.** `apps/web/app/api/_lib/auth/super-admin.ts`:
- `isSuperAdmin(user)` — synchronous check given resolved identity
- `requireSuperAdmin(req)` — gate every super-admin API route; throws `SuperAdminAuthError` mapped to `toAuthErrorResponse()` (Web Request/Response, not NextRequest — matches codebase convention)
- `trySuperAdminFromToken(pbToken)` — non-throwing variant for billing/permission bypass at sites where we have the user's PB JWT (e.g., agent route)
- `trySuperAdminByUserId(userId)` — non-throwing variant for sites where we only have `userId` (e.g., muapi route); fetches user record via admin token

**Three operational layers:**

1. **Permissions — DEFERRED.** No `canAccessPack`/`canAccessAgent`/`canUseFeature` functions currently exist in the codebase (pack access is implicit data display, agent access is implicit dept activation). When the first such function is built in Tranche 2+, **WRAP** with `isSuperAdmin()` short-circuit + `logSuperAdminAccess()`. **This is non-negotiable.**

2. **Admin surfaces — ENFORCED.** `apps/web/app/dashboard/admin/layout.tsx` performs client-side super-admin gate (PB auth + ADMIN_EMAIL match + server-side verification via `/api/admin/log-page-view`). Renders shared admin chrome (nav + breadcrumbs) on success; 403 + redirect on failure. Every page navigation logged to `super_admin_audit_log`. 8 admin routes also gated server-side via `requireSuperAdmin`.

3. **Billing — APPLIED.** Two real call sites bypassed:
   - `/api/integrations/muapi/route.ts` (image/video generation via `spendCredits`) — uses `trySuperAdminByUserId`
   - `/api/agent/route.ts` (agent credit via `spendAgentCredit`) — uses `trySuperAdminFromToken`

   Both log a `super_admin_usage_log` entry instead of charging credits. **Comped users (jrw-solutions 100× allowance) pattern preserved** — super-admin is a distinct tier above comp.

**Mandatory audit logging.** `apps/web/app/api/_lib/auth/super-admin-logging.ts`:
- `logSuperAdminAccess(user, actionType, resource, opts)` — writes to `super_admin_audit_log` (every admin route call, dashboard view, future permission bypass). Captures IP + user-agent from request when provided. **Non-blocking** — logging failure never blocks primary operation.
- `logSuperAdminUsage(user, operationType, opts)` — writes to `super_admin_usage_log`. Non-blocking. Cost estimation fields **DEFERRED** — operation log itself is the visibility surface for now; add cost columns when real data exists to estimate against.

Both helpers `sanitize()` parameter objects, redacting common secret keys (password, token, secret, apikey, authorization, pbtoken) recursively before persisting.

**Auth tier distinctions (NOT super-admin overlay):**
- `/api/worker/security-audit` uses `CRON_SECRET` (automated worker) — distinct tier; **not** refactored.
- `/api/admin/data` uses `ADMIN_IP` env gate (IP allow-list) — distinct tier; **not** refactored.

These are deliberate auth-tier separations: super-admin = human user; cron secret = automated worker; ADMIN_IP = network-tier admin.

**Future application pattern.** When adding ANY new permission check or billing call site in future tranches:
```ts
const admin = await trySuperAdminFromToken(pbToken); // or ByUserId
if (admin) {
  await logSuperAdminUsage(admin, "new_operation_type", { ... });
} else {
  await normalBillingOrPermissionCheck();
}
```
This is non-negotiable. Partial bypass breaks the operator's ability to use the product end-to-end without billing themselves.

**Log viewer UI — DEFERRED.** View `super_admin_audit_log` + `super_admin_usage_log` collections in PocketBase admin UI (links surfaced from `/dashboard/admin` index page). Dedicated viewer pages added in a future PR when sufficient log volume makes them useful.

**Multi-admin extension path (Option γ — DEFERRED).** Replace single `ADMIN_EMAIL` env var with a PB `super_admins` collection (rows: email + granted_at + granted_by). `isSuperAdmin()` and the `trySuperAdmin*` variants update to consult that collection. No call site changes; the abstraction layer absorbs the model change. Document in this section when implemented.

### Decision 73 — Orphan Data Migration + Drop (two-phase)

For orphan collections that hold real production data (e.g., capital-letter `Documents` and `Templates` from early schema drift), Decision 73 lands a two-phase migration workflow:

**Phase 1 — Migration (idempotent, ID-preserving):**
- `POST /api/admin/migrate-orphans-preflight` (read-only) — schema diff per source/canonical pair, row counts, sample rows, `can_migrate` verdict + block reasons
- `POST /api/admin/migrate-orphans-execute` — iterates source rows, creates in canonical with **same id preserved** (so external URLs/references stay valid). Idempotent — re-running on already-migrated rows returns `already_migrated`. Requires `confirm: "MIGRATE-<source>"` literal token. Supports `dry_run: true`.

**Phase 2 — Drop (gated):**
- `POST /api/admin/drop-orphan-collection` — drops the source collection. Allow-list: `vault_queue` (Decision 72a), `Documents`, `Templates` only. Programmatic safety gate: `row_count == 0` OR every source id verified to exist in `verified_migrated_to` canonical (else returns `409 migration_incomplete`). Requires `confirm: "DROP-<name>"` literal token. Logged with operator email + safety reason.

**Operator-Task Minimization honored**: dashboard exposes "Migrate to {canonical}" + "Drop {name}" buttons per orphan card. No PB admin UI work required for the standard path.

**Investigation Panel UI fix (Decision 73):** Decision-button highlight now reflects the **recorded decision** (from `orphan_decisions` PB collection), not the recommendation. Recommendation appears as a `★` badge on the recommended button when not selected, plus a static label in the purple panel above. Resolves the prior UX bug where the recommendation looked like the persisted decision.

**`orphan_decisions` added to EXPECTED_COLLECTIONS** as `systemManaged: true` with `ADMIN_ONLY_RULES`. Verifier reports ✅ once the setup route runs; repair never modifies it autonomously. This resolves what would have been a future ℹ️ entry.

### Decision 71 — Orphan Investigation Panel

For collections that show as `ℹ️ unexpected_collection` (case-variant orphans from prior schema drift, like `Documents` vs canonical `documents`), the security dashboard now includes an **Investigation Panel** with per-orphan investigation data and a "record-decision" workflow:

- `GET /api/admin/orphan-details` — read-only investigation: row count, last-modified, schema preview, canonical-equivalent comparison, structured recommendation
- `POST /api/admin/orphan-decisions` — records operator decision (`drop_safe` | `drop_after_migration` | `investigate_active_usage` | `keep_with_setup_route`) to `orphan_decisions` PB collection
- Setup route: `apps/web/app/api/setup/orphan-decisions/route.ts` (idempotent)

**No autonomous deletion.** Recorded decisions are advisory; Senior Architect authorizes a separate follow-up PR for any approved drops. See `docs/operator-runbooks/orphan-collection-resolution.md`.

---

## 5. The Brain — In-App Orchestrator (BUILT)

> **PR-Tranche-1.8 ARCH-Alignment.** Earlier versions of this section described the orchestrator as "TO BUILD CORRECTLY." That was stale. Discovery PR-T2.0 (commit `a46c515`) confirmed the orchestrator is built and shipping. The reframe below documents what actually exists.

The central orchestrator lives in-app at **`apps/web/app/api/_lib/orchestrator/`** (1,814 LOC across 10 files). It is the single coordinator for every "smart" request that needs LLM intelligence to coordinate departments. The `apps/api` split was reviewed and deferred indefinitely (Decision 77).

### File structure

```
apps/web/app/api/_lib/orchestrator/
├── index.ts (82)          runOrchestrator() entry + dispatch + audit log
├── llm.ts (250)           THE single Anthropic SDK callsite — owns retries,
│                          deadlines, soft-token budget, backoff, abort
├── logger.ts (36)         fire-and-forget orchestrator_decisions row
├── policies.ts (97)       per-intent max_tokens, deadline, retries,
│                          vault topK + token cap, model selection
├── types.ts (94)          OrchestratorIntent / Request / Response /
│                          Decision shape contracts
├── fallbacks.ts (114)     deterministic degraded outputs per intent
└── handlers/
    ├── route.ts (232)     intent="route" — Command Center routing
    ├── brief.ts (248)     intent="brief" — CEO weekly brief
    ├── handoff.ts (153)   intent="handoff" — cross-functional next steps
    └── synthesize.ts (225) intent="synthesize" — CEO multi-dept synth
```

**Hard rule enforced by spec §B1:** no file under `handlers/**` may import `@anthropic-ai/sdk`. Every handler goes through `callLLM()` in `llm.ts`, which owns all retry / deadline / budget logic.

### Per-intent policy table (from `policies.ts`)

| Intent | max_tokens | Deadline | Retries | Vault topK | Vault token cap |
|---|---|---|---|---|---|
| `route` | 512 | 4 s | 0 | 3 | 1 000 |
| `handoff` | 1024 | 6 s | 0 | 5 | 2 500 |
| `brief` | 4096 | 25 s | 1 | 10 | 6 000 |
| `synthesize` | 4096 | 30 s | 1 | 10 | 6 000 |

Soft input-token budget: 12 000 across all intents. Conversation message caps: 6 turns for `route`, 20 turns for `brief` + `synthesize`. Wall-clock budget check: if elapsed > 1.5× per-attempt deadline, abort with `llm_budget_exceeded`.

### The 4 intent handlers

| Intent | System prompt source | What it does | Returns |
|---|---|---|---|
| `route` | `ceo-agents-orchestrator` agent + runtime roster protocol | Picks the unlocked department + specific specialist for a Command Center message. Roster-augmented to prevent the SEMrush-bug class (Hotfix A1). | `{department, agentId, task, rationale, lockedAlternative}` |
| `brief` | `ceo-chief-of-staff` agent + 30-day activity rollup | Synthesizes the user's last-30-day work into a CEO weekly brief. Inline activity rollup (B3 enrichment); voice profile + recent decisions injected via vault. | Structured weekly brief text |
| `handoff` | Coordinator system prompt | Suggests 2-3 cross-functional next steps for a generated document. Locked departments returned with `locked:true` for upsell triggers. | `{followUps: [...]}` |
| `synthesize` | `ceo-chief-of-staff` agent + multi-dept context | CEO-mode multi-department synthesis. Pulls recent docs across unlocked depts; synthesizes into a unified view. | Synthesized analysis text |

All four handlers read from the vault library (see §13 — Vault) for business context, voice profile, recent decisions, and retrieval. All four log a `vault_retrieval_metrics` row when they touch retrieval, and every `runOrchestrator()` dispatch logs a `orchestrator_decisions` row fire-and-forget.

### Consolidated routes (the front door)

| Route | Intent | Status |
|---|---|---|
| `/api/orchestrator` | `route` \| `handoff` \| `brief` \| `synthesize` | Direct surface |
| `/api/orchestrate` (Command Center) | `route` | Thin wrapper — B2 cutover shipped |
| `/api/briefing` (CEO weekly brief) | `brief` | Thin wrapper — B3 cutover shipped |
| `/api/handoff/suggest` | `handoff` | Thin wrapper — B5 cutover shipped |

The 4 consolidated routes are all thin wrappers (~95-122 LOC each) that delegate to `runOrchestrator()` and stream the response. They never call Anthropic directly.

### 5 remaining non-orchestrator Claude callsites (correctly separate)

These domain pipelines call Anthropic directly because they are NOT user-facing intelligence:
1. `_lib/vault/morning-brief.ts` — vault snapshot generation (input to `brief` handler)
2. `_lib/vault/summarize.ts` — document summary shards (vault ingest pipeline)
3. `worker/scheduled/route.ts` — scheduled content drafting (worker, no user prompt)
4. `webhooks/chatwoot/route.ts` — inbound conversation auto-reply (webhook, not user-initiated)
5. `prefill/route.ts` — onboarding vault prefill (tiny scoped helper)

`agent/route.ts` and `integrations/muapi/route.ts` are also outside the orchestrator by design — they're the specialist execution tier and the generation tier respectively.

### Hard rule going forward

Any new "smart" feature MUST route through `runOrchestrator()`. Direct Anthropic calls outside the 5 domain pipelines above require explicit Senior Architect authorization with documented justification. This rule is mechanically enforced, and the full call-site audit + contracts are recorded, in `docs/architecture/orchestrator-audit-W61.md` (W61′).

---

## 5.5 Orchestrator Maturity — L1→L4

The Hermes Control Room project (reviewed in Discovery PR-T2.0 §6) frames agent system maturity as a four-level progression:

| Level | Pattern | Where STAFFD is |
|---|---|---|
| L1 | Single agent | (long surpassed) |
| L2 | Direct specialists, user picks | (long surpassed) |
| L3 | Orchestrator + specialists | **STAFFD is here.** |
| L4 | Automated agent team (recurring workflows, self-managing tasks) | Future tranche if/when needed |

STAFFD operates at **L3** and is designed to stay there until product demand justifies L4. The orchestrator routes user requests to specific specialists; specialists execute; outputs return through the orchestrator's response envelope. No task-bus, no per-agent containers, no async handoff queue between specialists.

### Why no task-bus (Decision 77)

The Hermes Control Room pattern uses a filesystem-backed task-bus (`/srv/agent-bus/{inbox,working,outbox,archive}`) with per-VPS containerized agents. That model solves problems STAFFD does not have at its current stage:

- **Per-agent isolation:** Vercel Functions already isolate invocations
- **Independent scaling:** Vercel auto-scales the single deploy
- **Separable secrets:** `packages/agents` runs in-process; no cross-process secret distribution needed
- **Long-running async work:** STAFFD intents are all sub-30-second; no need for a persistent work queue

Adopting a filesystem task-bus on Vercel would require backing it with PocketBase or Qdrant (since `/tmp` is ephemeral per-invocation), which defeats the architectural purpose. **The single-deploy in-process model is the right shape for STAFFD's current stage.**

### When L4 enters the picture

If/when STAFFD ships background autonomous workflows (e.g. "every Monday at 9am, the CEO Strategist runs a multi-dept brief and emails it"), that L4 work belongs in a separate worker tier — likely `/api/worker/*` cron handlers calling `runOrchestrator()` non-interactively. The orchestrator interface does not need to change; the L4 layer composes on top.

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

## 6.5 Test Infrastructure

STAFFD uses **Vitest** as the workspace-aware test runner. Installed
as a workspace dev-dependency at the root + per-package, so each
workspace can be tested in isolation or all together via Turbo.

### Conventions

- **File naming**: `*.test.ts` / `*.test.tsx` / `*.spec.ts` / `*.spec.tsx`
- **Directory pattern**: tests live either co-located with source under
  `src/**/*.test.ts` (packages/agents) or under `app/**/*.test.ts` +
  `__tests__/**/*.test.ts` (apps/web)
- **Environment**: `node` for `packages/agents`; `happy-dom` for
  `apps/web` (lighter than jsdom; supports React component tests in
  future tranches)

### Running tests

| Command | Effect |
|---|---|
| `pnpm test` (from repo root) | Runs all workspaces' test scripts through Turbo |
| `pnpm test:watch` | Watch mode across all workspaces |
| `pnpm --filter @staffd/agents test` | Single-package run |
| `pnpm --filter web test` | Single-package run |

### Standard #5 — Test Coverage Requirement

Every PR ships with at least one automated test that fails before the
change and passes after. This Test Infrastructure section is the
foundation that makes Standard #5 enforceable across all subsequent
implementation PRs (Tranche 1 onwards).

### Configuration files

| Path | Purpose |
|---|---|
| `vitest.config.ts` (root) | Workspace orchestration via `defineWorkspace` for direct `vitest` invocation. Normal flow goes through Turbo. |
| `packages/agents/vitest.config.ts` | Node-environment config; discovers tests under `src/` |
| `apps/web/vitest.config.ts` | happy-dom environment config; discovers tests under `app/` + `__tests__/` |

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
  The dense prompt is read for content and routed to the best Muapi model.
  Premium-only catalog (Decision 3); no *-fast-* or *-lite-* variants.
    IMAGE:
      - Heavy text-in-image (quoted text, lettering, headlines, logo
        lockups) → ideogram-v3-t2i
      - Cinematic / editorial / magazine-style → midjourney-v7-text-to-image
      - Default premium photoreal / illustration → flux-dev-image
    VIDEO:
      - Explicit Sora / "best" / "highest quality" → openai-sora-2-pro-text-to-video
      - Default premium cinematic → veo3-text-to-video
      - Named backup (Decision 3 graceful degradation) → runway-text-to-video
  Catalog snapshot: 2026-06-04 from Muapi reference. Refresh via
  docs/operator-runbooks/muapi-vendor-drift.md when generation fails.
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

Direct social publishing is being routed through Muapi's platform-publish layer when it ships. Tracking under W17. Specialist outputs include the media + per-platform tuned caption for immediate manual posting.

`/api/integrations/muapi/publish` currently returns HTTP 410 with a brand-voiced payload directing the operator to download + copy + post manually. UI publish buttons are gated on `PUBLISH_ENABLED` (`apps/web/lib/feature-flags.ts`) — flip to `true` when the reconnect PR ships.

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

### URL env var discipline (PR-Tranche-1.6 — Decision)

**The W8 footgun:** `process.env.X ?? "default"` does NOT fall back when the operator sets the env var to an empty string in Vercel. `??` only catches `null`/`undefined`. The empty string is then concatenated into a fetch URL, producing a relative path that crashes `fetch()` with "Failed to parse URL" (undici). This was the root cause of muapi image/video generation being 100% non-functional in production from commit `c7eed37` until PR-Tranche-1.6.

**Resolution:** All URL-shaped env vars resolve through `apps/web/lib/env.ts` (client-bundle-safe). Four resolvers, all sharing the same contract:

| Resolver | Env var | Default | Throws on missing scheme? |
|---|---|---|---|
| `resolveMuapiBase()` | `MUAPI_URL` | `https://api.muapi.ai` | ✓ |
| `resolveAppUrl(originHeader)` | `NEXT_PUBLIC_APP_URL` | `https://urstaffd.com` | ✓ |
| `resolvePocketbasePublicUrl()` | `NEXT_PUBLIC_POCKETBASE_URL` | `http://127.0.0.1:8090` | ✓ |
| `resolvePlausibleDomain()` | `NEXT_PUBLIC_PLAUSIBLE_DOMAIN` | `urstaffd.com` | ✗ (bare hostname) |

**Contract for all 4:**
1. `undefined` env value → default
2. `""` empty string → default (W8 footgun caught)
3. whitespace-only → default
4. Missing scheme → THROW at module load (`resolvePlausibleDomain` excepted)
5. Trailing slash → stripped
6. `http://` accepted alongside `https://`

`MUAPI_BASE_URL` is exported as an eagerly-resolved constant — importing it triggers `resolveMuapiBase()` at module load, so misconfigured deploys crash on first import rather than silently producing relative URLs at fetch time.

**Rule for future tranches:** Any new URL env var MUST go through a resolver in `apps/web/lib/env.ts`. Inline `process.env.X ?? "https://..."` is banned. See `docs/operator-runbooks/env-var-discipline.md`.

### Manifest

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
                             (resolved via lib/env.ts:resolveMuapiBase — empty
                              string falls back to default; missing scheme throws)

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

### ✅ Phase 3 — Foundation layer (corrected PR-Tranche-1.8)

> Earlier audits listed the central orchestrator + the Living Vault as ❌ MISSING. Both are built and live. Discovery PR-T2.0 (commit `a46c515`) corrected the orchestrator status; Discovery in PR-Tranche-1.8 ACTION 2 (`docs/architecture/memory-foundation-discovery.md`) corrected the vault status. The entries below reflect actual state.

- ✅ **Central orchestrator built and consolidating 4 ad-hoc Claude calls** behind `apps/web/app/api/_lib/orchestrator/` (1,814 LOC, 10 files). See §5 for full file structure, per-intent policies, and the 4 intent handlers. Hard rule §B1 prohibits direct Anthropic imports under `handlers/**`.
- ⚠ **Living Vault — pending re-classification per W21.** Discovery PR-Tranche-1.8 ACTION 2 indicates the vault library is built (12 files, 3,934 LOC; Qdrant + embeddings + ingest pipeline + retrieve + patterns all present). Final classification of "DONE vs PARTIAL vs polish required" lives in `docs/architecture/memory-foundation-discovery.md`. Until W21 closes, treat the historical "missing" framing as outdated; do not re-build what already exists.

### ✅ PR-Tranche-2 — Compliance + Polish + Intelligence (DONE)

Shipped together; full evidence in commit body. NO production code change to the brain or memory layers.

- ✅ **GDPR data export / deletion** (Decision 56 — legal compliance). `POST /api/account/export-data` emits a sanitized JSON archive of every row the user owns across PB; `POST /api/account/delete` cascades hard delete across all owned collections, cancels Stripe subscription, deletes PB user record. Super-admin self-delete refused (would orphan production). UI surface in `/dashboard/settings` — "Privacy & data" section with email-type-to-confirm pattern.
- ✅ **Smart aspect-ratio auto-selection** (Decision 8 — UX). `resolveAspectRatio(kind, explicit, prompt)` exported from `apps/web/app/api/integrations/muapi/route.ts`. Detects vertical-video platforms (TikTok / Reels / Shorts), landscape (YouTube long-form / hero banner), Pinterest/poster (2:3), Instagram feed (1:1), cinematic (21:9), magazine (4:5). Explicit operator-supplied valid ratio always wins.
- ✅ **Pattern UI badges** (visible intelligence). `apps/web/app/components/PatternBadge.tsx` — small chip + weight bar + tooltip per W14 ("keep visually quiet"). Reads from new `GET /api/vault/patterns/list` endpoint that aggregates the user's vault_patterns by signal and returns top-3 weighted. Rendered in DepartmentRoom output panel; silent fail-safe when no patterns yet.

### ❌ MISSING / BROKEN (in priority order — post-PR-Tranche-2)

**Revenue and product gaps:**

1. **Stripe top-up SKUs.** Plan/dept-addon prices exist. Image/video credit top-ups do NOT. Need 6 one-time Stripe products + checkout flow + webhook handler that credits the user.
4. **CEO add-on SKU.** $49/mo recurring subscription for Starter/Growth users. Needs Stripe product + checkout + webhook handler that unlocks CEO access without changing the user's plan. Acts as a soft Pro upsell.
5. **Credits widget on dashboard.** No visible balance or "Top up" CTA. Users discover their limit by hitting 402.
6. **Smart aspect ratio auto-selection.** Currently the user picks Square/Landscape/Portrait/4:3 manually. The system should detect the target platform from the prompt ("Instagram post" → 1:1, "TikTok video" → 9:16, "Facebook ad" → 1.91:1, etc.) and pre-select. User can still override.
7. **Intelligent cross-functional handoff.** Started but not shipped. Must route through the orchestrator (not be a standalone Claude call) and pull relevance from the Vault.
8. **Multi-turn conversation persistence.** Currently each turn creates a new document; full thread not preserved. Required precondition for the Vault's conversation history layer.
9. **3-Layer Briefing flow (UI).** Agents now ask intelligent questions (system prompts updated), but no structured "brief me" modal that walks users through a guided flow.
10. **Successful pattern tracking.** No system to mark + reuse prompts that produced extraordinary results.
11. **Smart Search UI for Pro+.** Semantic Vault search for power users. Requires Qdrant.
12. **White-label (Agency).** Per-client logos/branding on docs/booking pages.
13. **Studio Mode for Pro+.** Model picker + cost display toggle.

**Deferred / decided against:**

14. **Open-Generative-AI fork integration.** Decided against — Muapi backs everything (cleaner architecture).
15. **openreel-video.** Deferred — browser-based video editor, not generation. Future when video customers ask.
16. **MoneyPrinterTurbo.** Skipped — GPU infrastructure cost prohibitive vs. Muapi.
17. **Knowledge graph Vault (Phase 3).** After Qdrant is stable.
18. **Brand voice extraction (Phase 3).** Continuous extraction of voice patterns from kept work.
19. **The Demo Page.** Last by user's explicit rule. Demonstrates everything once everything works.

---

## 18. Key Decisions Log

This is the running record of locked product/architecture decisions. Anyone reading this should treat these as binding unless explicitly revisited.

1. **CEO is included in Pro and Agency by default. Also available as a $49/mo add-on for Starter and Growth users.** The add-on sits intentionally close to the gap to Pro — Growth ($79) + CEO add-on ($49) = $128/mo, only $21 less than Pro at $149/mo which includes CEO **plus** two additional full departments. Starter ($39) + CEO add-on ($49) = $88/mo similarly invites stepping up. The system surfaces this math at the moment of add-on purchase as a soft upsell to Pro. Anyone paying for CEO is a hot upgrade prospect.
2. **Annual interval is the default-selected toggle.** Pricing page lands with Annual highlighted with the "2 months free" badge. Monthly is the alternative the user can toggle to. **The headline price always shows the round monthly subscription number** ($39, $79, $149, $450). When Annual is selected, a "Billed annually at $X — save $Y" callout appears underneath. Never show the effective per-month price as the headline — it produces confusing decimals like $32.50 that break trust.
3. **All video is HD. All images use premium models. No tier-based quality split.** Porsche, not Volkswagen. STAFFD selects the best available Muapi model for the task type. Primary model selection is documented per use case with named backups for graceful degradation. Best tools, every time. The user does not pick or see model names; the system routes silently. **Model slugs refreshed 2026-06-04 per Muapi catalog. See routeImageModel/routeVideoModel for current set** (image: ideogram-v3-t2i, midjourney-v7-text-to-image, flux-dev-image; video: openai-sora-2-pro-text-to-video, veo3-text-to-video, runway-text-to-video).
4. **Default-to-action specialists.** Agents produce work on first response when vault provides enough context. Only ask one focused question when truly ambiguous.
5. **No competitor name leakage.** Never mention Midjourney, DALL-E, Stable Diffusion, etc. in user-facing copy or specialist outputs.
6. **STAFFD generates directly via Muapi.** Specialists don't tell users to paste into other tools. The Image Prompt Engineer's prompt goes straight to our generator.
7. **Universal distillation at the integration boundary.** Specialists produce whatever they normally produce. Muapi route handles extraction-to-prompt. No per-agent prompt engineering needed.
8. **Smart routing happens server-side and silently. Aspect ratio is platform-aware and auto-selected.** STAFFD detects the target platform from the user's request and pre-selects the right aspect ratio:
   - Instagram feed post → 1:1 or 4:5
   - Instagram Story / Reel → 9:16
   - TikTok → 9:16
   - Facebook feed → 1:1 or 1.91:1 (ad)
   - Facebook Story → 9:16
   - YouTube video → 16:9
   - YouTube Shorts → 9:16
   - YouTube thumbnail → 16:9
   - X/Twitter post → 16:9 or 1:1
   - LinkedIn post → 1.91:1 or 1:1
   - Pinterest pin → 2:3 (1000×1500)
   - Web hero image → 16:9 or 21:9
   The user can override via the ratio selector, but the smart default is pre-selected based on the prompt content. The user does not need to know the right ratio per platform — the application does. Model selection follows the same principle: the system silently picks the best Muapi model for the task content (text-in-image → Ideogram, cinematic → Kling Pro, photoreal default → Flux Pro). Studio Mode (Pro+) lets power users override both.
9. **Cross-functional handoff is intelligent.** System suggests next steps based on what was produced and the user's unlocked plan. Locked depts shown as upgrade triggers.
10. **Comp accounts use the same code path.** No special UI. They simply resolve as `plan: agency` with 100× credits. Easy to revoke.
11. **No tracked-changes amends to commits.** New commit on each meaningful change.
12. **Voice is non-negotiable.** "Staff", "specialists", "hire", "promote". Never "AI team", "agents", "subscribe", "upgrade".
13. **The Vault is living memory, not a profile.** Profile + work history + conversation history + successful patterns + brand voice corpus + decisions made. Every interaction adds to it. Every retrieval is semantic.
14. **Graphify is dev-time only.** It maps code, not business data. Wrong tool for the Vault. Used by the team building STAFFD, not by the user-facing runtime.
15. **Qdrant is the Vault's memory engine.** Right tool for semantic retrieval. One instance on Railway serves all users via per-user (or per-user-per-client) collection scoping.
16. **Brain and Memory are co-equal foundations.** Orchestrator without Vault is a smart router with no context. Vault without Orchestrator is a smart database with no decision-maker. Both must exist before further "smart" features.
17. **Every specialist has its own reference materials and quality standards. The Orchestrator's job is to gather the right context BEFORE the specialist runs — no specialist works blind.** Each agent definition in `packages/agents` includes a role, principles, output format, reference styles, and a quality bar. When the Orchestrator routes work to a specialist, it bundles: the user's task + relevant Vault excerpts + semantically relevant past wins from Qdrant + conversation history + peer-department output (when cross-functional). The specialist's job is to execute at the standard the references describe. The Orchestrator's job is to make sure they have everything they need to produce excellence.

18. ~~*(reserved — see below for 75/76 revocation context)*~~

19. ~~*(reserved — see below for 75/76 revocation context)*~~

20. **Decision 77 — `apps/api` split deferred indefinitely.** The original Hermes pattern called for the orchestrator to live in a separate `apps/api` Node/Hono service. Discovery PR-T2.0 (commit `a46c515`) confirmed the orchestrator already lives in-app at `apps/web/app/api/_lib/orchestrator/` as a server library + thin HTTP routes, and that the single-Vercel-deploy shape is correct for STAFFD's stage. The split solves problems (per-agent isolation, independent scaling, separable secrets) that STAFFD does not have. The Hermes per-VPS task-bus pattern is similarly skipped — `/tmp` is ephemeral on Vercel Functions; backing the bus with PB/Qdrant would defeat its purpose. **If/when STAFFD scales to the point that the orchestrator merits its own deploy or async work queue, revisit. Until then, the in-app location is canonical.**

21. **Decision 78 — Muapi Workflow API rejected as an orchestration substrate.** Muapi exposes Workflow API + Agent API (`getTemplateWorkflows`, `executeWorkflow`, `getUserAgents`, etc.). Surface looks similar to STAFFD's orchestrator; routing STAFFD's coordinator brain through it was evaluated and rejected per Discovery PR-T2.0 §7. Reasons: (a) two orchestrator semantics is worse than one — STAFFD's orchestrator owns the Decision 14 routing logic, the `packages/agents` system prompts, brand laws enforcement (Decision 71), `orchestrator_decisions` audit logging, and per-intent latency policies, none of which Muapi knows about; (b) vendor lock-in risk just bit us in PR-Tranche-1.7 — multiplying it across the brain is the wrong direction; (c) Decision 14 (Muapi-primary for media) locked the vendor scope; treating it as an orchestration vendor would expand surface area without authorization. **STAFFD orchestrator stays Claude-driven via the existing `_lib/orchestrator/llm.ts` wrapper. Muapi remains media-only.**

22. **Decision 79 — Standard #9: Pre-Strategy Verification Required.** Before any tranche-level strategic decision that reframes work as "build the X" or "rebuild the Y," verify whether X/Y already exists in the codebase. The Decision 75/76 cycle was triggered by ARCH §5 and §17 describing the orchestrator as "TO BUILD CORRECTLY" / "❌ MISSING" when 1,814 LOC of orchestrator code was already shipped (PRs B1-B5 in the project history). The same misread nearly happened on the Vault — caught only by running Discovery PR-T2.0 + ACTION 2 of PR-Tranche-1.8. **Standard #9 mandate:** any "build the foundation" PR spec MUST begin with a Discovery phase whose first task is `grep + file inventory + per-LOC audit` of the foundation in question. Strategic decisions ratified without Discovery are subject to revocation when Discovery surfaces the foundation already exists.

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
