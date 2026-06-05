# Brain Foundation Discovery — PR-T2.0

> **Senior Architect acknowledgment (PR-Tranche-1.8).** Decisions 75 and 76 are revoked. This Discovery report's central finding — that the orchestrator is built and shipping, not waiting to be built — was accepted. New Decisions 77, 78, and 79 supersede the 75/76 cycle and are documented in ARCHITECTURE.md §18. PR-T2.1 (Skeleton) is correspondingly down-scoped and absorbed into PR-Tranche-1.8 (ARCH Alignment); no separate Skeleton PR ships.

**Purpose.** Map the territory before PR-T2.1 (Skeleton) is specced. NO code shipped. Output is this document, committed to preserve discovery context for the next PR's pre-build verification.

**Major finding up front (read this first).** ARCH §5 and Decision 75/76's premise — *"the brain itself has not been built"* — is **stale**. The orchestrator skeleton + LLM wrapper + 4 intent handlers (route / handoff / brief / synthesize) + the 3 cutover routes are **already shipped** in `apps/web/app/api/_lib/orchestrator/` (1,814 LOC across 10 files). The work labelled B1-B5 in the project's PR history corresponds to these shipments. PR-T2.1's scope is materially smaller than the Decision 75/76 framing assumes. Sections 1-7 below detail the gap.

---

## §1 — apps/api skeleton inventory

```
$ ls apps/
.  ..  web
```

**`apps/api` does not exist.** It was never created. The Hermes-pattern reference in ARCH §5 anticipated splitting orchestrator into its own Node app on a separate Vercel deploy; that split never happened. **There is nothing to inventory.**

- pnpm-workspace.yaml globs `apps/*` + `packages/*` — wiring is generic; no orphan reference to `apps/api`
- turbo.json has no app-specific task references — single-app behavior holds
- No imports from `packages/agents` into a phantom apps/api — only `apps/web` consumes the agent catalog

**Verdict — remove from architectural plan.** The orchestrator already lives in `apps/web/app/api/_lib/orchestrator/` as a server library + 3 thin HTTP routes (`/api/orchestrate`, `/api/briefing`, `/api/handoff/suggest`). Splitting it back out to a separate Node app today would be deliberate fragmentation with no benefit: single Vercel deploy works fine, latency is bounded by intent policies, no separate scaling pressure exists. **Recommendation:** update ARCH §5 to reflect the in-app location.

**Gap from "what the orchestrator needs":** none — the in-app location is the better answer.

**PR-T2.1 scope:** SKIP this dimension entirely. Do not create `apps/api`.

---

## §2 — ceo-agents-orchestrator system prompt

**Location:** `packages/agents/src/departments/ceo.ts:115-151` — agent id `ceo-agents-orchestrator`.

**Verbatim:**

```
You are The Agents Orchestrator — STAFFD's meta-agent that coordinates
complex tasks across multiple departments.

HOW TO USE THE VAULT:
You have deep context on this business. Use it to coordinate the right
specialists for the right tasks, and to synthesize their outputs into a
coherent whole. Think with the vault, never quote it.

YOUR ROLE:
When a task requires expertise from multiple departments simultaneously,
you break it down into department-specific work streams, coordinate the
sequence, and synthesize the outputs. You're the air traffic controller
for complex business projects.

WHEN TO ORCHESTRATE:
- Product launch: Marketing (go-to-market) + Sales (outreach sequence) +
  Legal (terms) + Operations (launch checklist)
- Business health check: CEO strategy + Finance (numbers) + Operations
  (processes) + Sales (pipeline)
- Hiring: HR (job posting + interview) + Legal (contractor/employee
  contracts) + Operations (onboarding)
- Client acquisition: Marketing (content) + Sales (outreach) + Legal
  (contract) + Operations (onboarding)

ORCHESTRATION APPROACH:
1. Identify all departments this task touches
2. Map the sequence (what must happen before what)
3. Define the handoff between departments
4. Synthesize into a unified action plan

OUTPUT FORMAT:
- Task breakdown: department → specific deliverable → sequence → dependency
- Unified action plan: numbered steps across departments
- Synthesis of results when combining multiple outputs

OUTPUT RULES:
- Deliver immediately. No preamble.
- Be explicit about sequencing — show what depends on what.
- The final output should feel unified, not like a list of separate
  department reports.
```

**Usage status:** **Live in production.** `apps/web/app/api/_lib/orchestrator/handlers/route.ts:131-132` loads it:
```ts
const agent = getAgent(policy.systemAgentId);
const baseSystem = agent?.systemPrompt ?? "You are the STAFFD Command Center coordinator.";
```

`policies.ts` keys `systemAgentId: "ceo-agents-orchestrator"` per intent. The prompt is then augmented at runtime with the unlocked-departments + roster-of-specialists protocol block (Hotfix A1 — the SEMrush bug fix).

**Gap:** none for the routing intent. The brief / handoff / synthesize handlers load `ceo-chief-of-staff` and other agent prompts via the same `getAgent()` pattern. **Single source of truth honored** — all orchestrator system prompts come from `packages/agents`.

**PR-T2.1 scope:** SKIP. Already done. If PR-T2.1 adds new intents, follow the same `getAgent(policy.systemAgentId)` pattern.

---

## §3 — Existing ad-hoc Claude calls — full inventory

`apps/web/app/api/` has **9 files** that import `@anthropic-ai/sdk` or call `messages.create`. Categorized by consolidation status:

### Already consolidated through `runOrchestrator()` (4 routes)

| Route | LOC | Intent | Consolidation status |
|---|---|---|---|
| `/api/orchestrate` (Command Center routing) | 122 | `route` | ✅ Thin wrapper. Delegates to `runOrchestrator({intent:"route"})`. Comment block notes "B2 cutover" already shipped. |
| `/api/briefing` (CEO weekly brief) | 66 | `brief` | ✅ Thin wrapper. Delegates to `runOrchestrator({intent:"brief"})`. Comment block notes "B3 cutover" already shipped. |
| `/api/handoff/suggest` (cross-functional handoff) | 95 | `handoff` | ✅ Thin wrapper. Delegates to `runOrchestrator({intent:"handoff"})`. Comment notes "B5 spec" already shipped. |
| `/api/orchestrator` (direct call) | — | `route\|handoff\|brief\|synthesize` | ✅ The canonical surface. Both the public HTTP route and lib consumers go through `runOrchestrator()`. |

The orchestrator `_lib` directory:

```
apps/web/app/api/_lib/orchestrator/
├── index.ts (82 LOC)              runOrchestrator() entry + dispatch
├── llm.ts (250 LOC)               THE single Claude callsite for all
│                                  intents — owns retries, deadlines, soft
│                                  token budget, backoff, abort merging
├── logger.ts (36 LOC)             fire-and-forget orchestrator_decisions row
├── policies.ts (97 LOC)           per-intent max_tokens, deadline, retries,
│                                  vault topK + token cap, model selection
├── types.ts (94 LOC)              OrchestratorIntent / Request / Response /
│                                  Decision shape contracts
├── fallbacks.ts (114 LOC)         deterministic degraded outputs per intent
│                                  (deadline / budget / upstream error paths)
└── handlers/
    ├── route.ts (232 LOC)         intent="route" — Command Center routing
    ├── brief.ts (248 LOC)         intent="brief" — CEO weekly brief
    ├── handoff.ts (153 LOC)       intent="handoff" — cross-functional next steps
    └── synthesize.ts (225 LOC)    intent="synthesize" — CEO multi-dept synth
```

**This IS the brain.** It has retry policies, deadlines, soft-token budget enforcement, retrieval-aware system prompts, deterministic degraded fallbacks, and audit logging. The spec §B1 acceptance gate ("no file under `handlers/**` may import `@anthropic-ai/sdk`") is enforced — every handler calls `callLLM()` from `llm.ts`.

### Not orchestrator-eligible — domain pipelines, not user intelligence (5 callsites)

| File | Purpose | Why not consolidate |
|---|---|---|
| `_lib/vault/morning-brief.ts:167` | Generates user's morning brief content from vault snapshot | Internal vault pipeline; output feeds the brief intent already. Consolidating would double-wrap. |
| `_lib/vault/summarize.ts:146` | Compresses document text into vault summary shards | Internal vault pipeline; pre-orchestrator boundary. |
| `worker/scheduled/route.ts:64` | Generates scheduled content (drafts queued posts) | Worker job; runs without a user prompt. Different latency model. |
| `webhooks/chatwoot/route.ts:135` | Auto-replies to inbound Chatwoot conversations | Webhook surface; not user-initiated. Inbound automation, not user routing. |
| `prefill/route.ts:36` | Generates vault prefill suggestions during onboarding | Onboarding helper; tiny, scoped to a single business form. |
| `agent/route.ts` | The specialist execution route | ✅ Correctly outside the orchestrator — this is the specialist tier, not the coordinator. |
| `integrations/muapi/route.ts` | Image/video prompt enricher (Anthropic call) | Generation-side helper, not user intelligence. |

**These 5 are correctly separate.** Forcing them through `runOrchestrator` would be over-consolidation — they're scoped to specific pipelines with their own latency + retry profiles, and they don't compete with the orchestrator's job (routing + coordination + synthesis).

**Gap:** none. Consolidation is correctly bounded.

**PR-T2.1 scope:** SKIP further consolidation. If PR-T2.1 wants to consolidate any of these 5, it needs a separate justification — the current bounds are intentional.

---

## §4 — `orchestrator_decisions` PB collection state

**Setup route:** `apps/web/app/api/setup/orchestrator/route.ts` (109 LOC) — **exists and is idempotent.**

**Schema (verbatim from `REQUIRED_FIELDS`):**
```
user                (text)         user who triggered
intent              (text, req'd)  route | handoff | brief | synthesize
decision_json       (json)         the OrchestratorDecision or degraded payload
latency_ms          (number)       wall-clock duration
attempts            (number)       retry count
tokens_in           (number)       input tokens consumed
tokens_out          (number)       output tokens produced
fallback            (text)         null | deadline_exceeded |
                                    llm_budget_exceeded | upstream_error
vault_cost_flag     (text)         ok | trimmed | degraded
model               (text)         which Claude model handled it
estimated_cost_usd  (number)       Phase 3 cost logging
```

**Rules:** `USER_OWNED_RULES` via `ensureCollectionRulesWithFreshToken("orchestrator_decisions")` per Decision 69. Confirmed in `apps/web/app/api/_lib/security/row-rules.ts:EXPECTED_COLLECTIONS` — entry exists with the standard `user = @request.auth.id` pattern.

**Production status:** PR-Tranche-1 verify-row-rules verification (commit `9c495dc` smoke test) already confirmed `orchestrator_decisions` is in the 19-collection baseline with rules ✅. The setup route is idempotent and was bootstrapped during prior tranches.

**Writer:** `_lib/orchestrator/logger.ts:logDecision()` — called fire-and-forget from `runOrchestrator()` after every dispatch. Never blocks the response; never throws.

**Gap:** none.

**PR-T2.1 scope:** SKIP. Already exists, already wired, already verified.

---

## §5 — Vault read access — what the orchestrator already has

`apps/web/app/api/_lib/vault/` is a 12-file library (`budget`, `index`, `ingest`, `morning-brief`, `outcomes`, `patterns`, `queue`, `ratelimit`, `retrieve`, `summarize`, `versions`, `voice`). The orchestrator already pulls from it.

**Context-loading checklist (what the orchestrator can read today):**

| Capability | Function / location | Status |
|---|---|---|
| Unlocked departments | `resolveDepartments(userId)` in `_lib/trial.ts` — used 7+ places including `handlers/route.ts:91` | ✅ wired |
| Active client (Agency mode) | `clientId` flows through `OrchestratorRequest` and into `fetchVault(pbToken, userId, {clientId})` for client-scoped vault load | ✅ wired |
| Vault profile | `fetchVault(pbToken, userId, {clientId})` from `_lib/vault/index.ts` — `handlers/route.ts:90` | ✅ wired |
| Vault retrieval (semantic) | `retrieve(userId, query, {topK, maxTokens, clientId, intent})` from `_lib/vault/retrieve.ts` — `handlers/route.ts:121` + `handlers/brief.ts` | ✅ wired with per-intent budget controls |
| Voice profile (brand voice block) | `getVoiceBlock(userId)` from `_lib/vault/voice.ts` — used in `handlers/brief.ts` and `handlers/synthesize.ts` | ✅ wired |
| Recent decisions / outcomes | `fetchRecentDecisions(userId)` from `_lib/vault/outcomes.ts` — used in `handlers/brief.ts` | ✅ wired |
| Credit state | `getCreditState(pbUrl, userId)` from `_lib/credits.ts` — used in `agent/route.ts` and `muapi/route.ts` | ✅ exists |
| Active packs | Carried via `trialState.activePacks` — used in `handlers/route.ts:96` for roster filtering | ✅ wired |
| Recent work (last-30-days dept rollup) | Inlined inside `handlers/brief.ts` (B3 enrichment per file comment) | ✅ wired |
| Pattern signals (vault_patterns) | `_lib/vault/patterns.ts` exists; not yet pulled into orchestrator handlers | ⚠️ available but unused by orchestrator today |

**Gap:** the orchestrator has full read access for routing, briefing, handoff, and synthesis. The one un-wired surface is `vault_patterns` (Phase 6 PR-13 / PR #13 from project history) — orchestrator could enrich decisions with successful past patterns, but the patterns library exists.

**PR-T2.1 scope:** SKIP context-loading rewrite. If PR-T2.1 wants to add patterns-aware orchestration, that's a small additive enhancement: `handlers/brief.ts` + `handlers/synthesize.ts` already call `fetchVault` + `getVoiceBlock` + `fetchRecentDecisions` — adding a `fetchPatterns()` call follows the same pattern. ~30 LOC addition, no architectural change.

---

## §6 — Hermes-control-room conceptual blueprint applicability

**Web-fetch summary of [shannhk/hermes-agent-control-room](https://github.com/shannhk/hermes-agent-control-room):**

- L1→L4 progression: single agent → direct specialists → orchestrator + specialists → automated team
- Task-bus pattern: filesystem-backed `/srv/agent-bus/{inbox,working,outbox,archive}` for async handoff between orchestrator and specialists
- Deployment: per-agent containerization on a shared VPS, side-car control plane at `/root/agent-control-room`
- Each agent isolated under `/srv/<agent-name>/data` with own `.env`, memory, skills

**Applicability to STAFFD:**

| Hermes pattern | STAFFD architecture | Fit? |
|---|---|---|
| Per-agent VPS container | Single Vercel Functions deploy with shared Node runtime; `packages/agents` is in-process | ❌ NO — adopting would mean abandoning Vercel for VPS. Loses Vercel's edge / cold-start / auto-scale. Massive cost. |
| Filesystem task-bus | Serverless Functions have ephemeral `/tmp`; no shared filesystem across invocations | ❌ NO — would need to back it with PB or Qdrant, defeating the purpose |
| L1→L4 maturity model | STAFFD is already at L3 (orchestrator + specialists) with PR-T2.1 conceptually targeting deeper L3 polish | ✅ Conceptually useful framing for talking about maturity, not for code |
| Side-car control plane (operator console) | STAFFD has `/dashboard/admin` — operator-only surface already shipped (Tranche 1.5 Decision 74) | ✅ Same idea, already done |

**Verdict — SKIP the task-bus pattern.** STAFFD's single-deploy architecture is correct for its stage. The Hermes per-VPS model solves a problem (per-agent isolation, independent scaling, separable secrets) that STAFFD doesn't have at this product stage. Adopting it would be premature distribution.

The L1→L4 framing is useful as **documentation vocabulary** — ARCH could adopt "STAFFD is at L3" as a positioning line. But that's a doc edit, not a code change.

**PR-T2.1 scope:** SKIP. Do not introduce a filesystem task-bus or a per-agent container split. The existing `runOrchestrator` → `dispatch` → `handler` → `callLLM` pattern is the right shape for STAFFD's deployment model.

---

## §7 — Muapi Workflow API — does it intersect?

**Recommendation: NO (defer indefinitely).**

Per the PR-Tranche-1.7 vendor-reconnect work, Muapi exposes Workflow API + Agent API per their reference (`getTemplateWorkflows`, `executeWorkflow`, `getUserAgents`, `getUserConversations`, etc.). Surface area looks superficially similar to STAFFD's orchestrator.

**Why not integrate:**

1. **Two competing orchestrator semantics is worse than one good one.** STAFFD's orchestrator has Decision 14 logic baked in: routing to STAFFD-named departments, loading STAFFD agent system prompts from `packages/agents`, applying STAFFD brand laws (Decision 71), logging to STAFFD's `orchestrator_decisions`, enforcing STAFFD's per-intent latency policies. Muapi's Workflow API knows none of that.

2. **Vendor lock-in risk just bit us.** PR-Tranche-1.7 was a forced reconnect when Muapi removed the publish endpoints. Routing STAFFD's coordinator brain through Muapi's Workflow API would multiply this risk — every Muapi breaking change would cascade into the orchestrator.

3. **Latency + cost calculus doesn't favor it.** STAFFD's orchestrator is direct Anthropic calls with per-intent deadlines (4s route / 6s handoff / 25s brief / 30s synthesize). Routing through Muapi adds a network hop + their orchestration overhead. No latency win, definite cost markup.

4. **Decision 14 already locked: Muapi is the media-vendor.** It's image + video generation + (when re-enabled) social publishing. Treating it as also an orchestration vendor expands its surface in a direction Decision 14 doesn't authorize.

**What MIGHT be worth investigating later (W22 or beyond):** Muapi's `getNodeSchemas` for STAFFD's STUDIO MODE (Pro+) — when a power user wants to chain custom node graphs for an asset pipeline that we don't want to build natively. Not a brain integration; an asset-pipeline editor. **Out of scope for T2.x entirely.**

**PR-T2.1 scope:** SKIP. Document NO in ARCH or just leave it unspoken.

---

## Final consolidated recommendation

### PR-T2.1 — Skeleton — REVISED SCOPE

**The skeleton is already built and shipped (PRs B1-B5).** Decision 75/76's premise was that the orchestrator was unbuilt; reality is the opposite.

**Recommended PR-T2.1 actions (in priority order):**

1. **ARCHITECTURE.md §5 rewrite** — update the "TO BUILD CORRECTLY" framing to "BUILT — IN-APP AT `apps/web/app/api/_lib/orchestrator/`". Document the 4 intents, the per-intent policy table, the LLM wrapper contract, the degraded-fallback pattern, the audit-log integration. This is the single biggest gap surfaced by Discovery — the architecture doc lies about the brain's status. **~80-120 LOC of doc change.**

2. **ARCH §5.5 NEW section: maturity model** — add the L1→L4 vocabulary as STAFFD positioning ("STAFFD is at L3: orchestrator + specialists, with L4 automated workflows on the roadmap"). Reinforces Decision 75's framing without code. **~30 LOC.**

3. **Decision Log update** — add Decision 77 (or whatever sequence is next): "apps/api split deferred indefinitely; orchestrator stays in-app at apps/web/app/api/_lib/orchestrator/. Hermes per-VPS task-bus pattern reviewed and SKIPPED — wrong fit for our serverless model." **~10 LOC.**

4. **Decision Log update** — add: "Muapi Workflow API integration evaluated and REJECTED. STAFFD orchestrator stays Claude-driven; Muapi remains media-only per Decision 14." **~5 LOC.**

5. **(Optional, cheap)** — wire `vault_patterns` into `handlers/brief.ts` and `handlers/synthesize.ts` for patterns-aware coordination. Already has the read path (`_lib/vault/patterns.ts`); just need a fetch + rendering block. **~30 LOC.**

**Total estimated PR-T2.1 work: ~155-200 LOC of doc + 30 LOC of optional code = small.**

**Estimated complexity:** 2/10 (was 7-8/10 under the original framing).
**Estimated time:** 1-2 hours (was 4-8 hours).

### Pre-existing decisions that need revisiting

1. **Decision 75/76** — premise is materially wrong about the brain's status. Either:
   - α: Keep Decision 75/76 but reframe Tranche 2 as "Brain polish + ARCH alignment" rather than "Brain Foundation Build"
   - β: Revoke Decision 75/76 and let the orchestrator polish slot into a smaller Tranche 1.8 or merge into Tranche 2 alongside Vault work
   - **Recommendation: α.** Tranche 2 still has 3 PRs worth of meaningful work (ARCH alignment + patterns integration + any orchestrator polish like new intents). Just smaller than originally framed.

2. **ARCH §5** — already covered above. Will be rewritten in PR-T2.1.

3. **Decision 14 (Muapi-primary)** — strengthened, not revisited. §7 confirms it.

4. **State Document v1.1** — needs a §2.x note that the orchestrator already exists. PR-T2.1's commit message should call this out.

### Ambiguities surfaced (1)

- **A1 — Does Decision 75/76 still want the apps/api split?** The original framing in ARCH §5 implied the orchestrator should live in `apps/api` for clean separation. Discovery surfaced that it lives in `apps/web/app/api/_lib/orchestrator/` as a server library + thin HTTP routes. Functionally equivalent; structurally different. **My recommendation: SKIP the split (Option β in §1 above).** Surface to Senior Architect for explicit confirmation before PR-T2.1 ships an ARCH rewrite that codifies the in-app location.

No code written outside this report. Standing by for PR-T2.1 spec.
