# Orchestrator Consolidation Audit — W61 Phase A (canonical contract record)

> **Status:** SA-affirmed 2026-06-11 (W61 → W61′ scope-correction ruling).
> **What this is:** the complete inventory of every Claude call site in
> STAFFD, the contracts of the consolidated routes, and the SA-affirmed
> classification of the remaining direct callsites. W62–W65 build against
> this record. Mechanically enforced by
> `apps/web/__tests__/orchestrator/sdk-allowlist.test.ts`.

---

## 1. Verdict (Standard #9 / Decision 79)

The W61 brief's premise — "stand up `/api/orchestrator`, consolidate the
scattered Claude calls" — described work that was **already built and
shipped**:

- `/api/orchestrator/route.ts` exists: intent dispatch, 400 on unknown
  intent / invalid JSON, never-500 envelope guarantee, decision logging.
- `_lib/orchestrator/` (1,631 LOC, 11 files): `runOrchestrator()` dispatch,
  the `callLLM` guardrail wrapper (per-intent deadlines, retries, backoff,
  wall-clock budget, token trim ladder, cost accounting), four intent
  handlers (`route`, `handoff`, `brief`, `synthesize`), policies,
  fallbacks, logger, types.
- The consolidated front-door wrappers shipped in B2–B5:
  `/api/orchestrate` → `route`, `/api/briefing` → `brief`,
  `/api/handoff/suggest` → `handoff`, `/api/agent` CEO branch →
  `synthesize`.

The §17 line the brief quoted was the **pre-correction** text; current
ARCH §17 records the orchestrator as built (corrected in Discovery
PR-T2.0 / PR-Tranche-1.8 after the Decision 75/76 revocation cycle).

**SA ruling (W61′):** scope corrected to pin + allowlist + document. No
migration of any §5-exempt callsite. Tests freeze the existing behavior;
this document freezes the audit.

## 2. The SDK allowlist (the only files that may construct the Anthropic client)

| File | Why it's direct | Own guardrails |
|---|---|---|
| `app/api/_lib/orchestrator/llm.ts` | IS the guardrail wrapper | deadlines, retries, budget, trim ladder |
| `app/api/agent/route.ts` | Specialist execution tier (§5, by design) — the only **true token streaming** call (`messages.stream`) + Groq cost-routing via `pickModel`/`callGroq` | rate limit, trial gate, 8192 max_tokens |
| `app/api/integrations/muapi/route.ts` | Generation-tier prompt distillation (Decision 7 boundary) | credit pre-flight, 402 |
| `app/api/prefill/route.ts` | Onboarding extraction (Haiku, tiny scoped helper) | 8s site-fetch timeout |
| `app/api/webhooks/chatwoot/route.ts` | Inbound auto-reply draft (webhook, not user-initiated) | account-id validation; drafts post as Chatwoot private notes |
| `app/api/worker/scheduled/route.ts` | Scheduled content (cron) — own Groq path | CRON_SECRET/WORKER_SECRET; server-side documents persistence |
| `app/api/_lib/vault/morning-brief.ts` | Nightly per-section brief generation (input pipeline) | own deadlines; persists to `vault_briefs` |
| `app/api/_lib/vault/summarize.ts` | Vault ingest summary shards | Haiku, 4s deadline, 1 retry, **extractive fallback**, upstream rate-limiter |

(`lib/env.ts` mentions the constructor in a comment only — excluded by the
allowlist test's comment filter.)

**Adding a direct callsite requires explicit SA authorization (ARCH §5
hard rule) and a deliberate edit to the allowlist test.** Removing one
also fails the test until the allowlist is pruned — the list stays honest
in both directions.

## 3. Intent contracts (the consolidated envelope)

`POST /api/orchestrator` body: `{ intent, userId, pbToken, clientId?,
context }`. Response: `OrchestratorResponse` envelope — `ok:true` with
`decision` + token/latency/cost accounting, or `ok:false` with `fallback`
reason + `degraded` payload. Never 500s. Every dispatch logs one row to
`orchestrator_decisions` (fire-and-forget).

| Intent | systemAgentId | Model | Deadline / retries | Context in | Decision out |
|---|---|---|---|---|---|
| `route` | ceo-agents-orchestrator | haiku | 8s / 3 (W37) | `{message, messages}` | `{department, agentId, task, rationale}` + `lockedAlternative` in notes |
| `handoff` | ceo-agents-orchestrator | haiku | 6s / 0 | `{sourceDoc, query}` | `followUps[]` with `locked` flags |
| `brief` | ceo-chief-of-staff | sonnet | 25s / 1 | `{}` | `{task: briefText}`; W49: persists to documents (`ceo` / "Chief of Staff") on success only |
| `synthesize` | ceo-agents-orchestrator | sonnet | 30s / 1 | `{query, agentId?}` | `{task: synthesis}` |

Wrapper translation layers (pinned in
`__tests__/orchestrator/wrapper-route-pins.test.ts`):

- **`/api/orchestrate`**: `{messages[], userId, pbToken, clientId?}` →
  streams `text/plain`: rationale + `READY:{department, agentId, task,
  lockedAlternative}` line. Degraded envelopes still stream a usable
  READY line — never an empty body. 400 on empty messages.
- **`/api/briefing`**: `{userId, pbToken, clientId?}` → streams the brief
  in one chunk; 401 without auth; W49 server-side persistence on
  `ok:true` only.
- **`/api/handoff/suggest`**: `{documentId? | sourceDoc?, query?, userId,
  pbToken, clientId?}` → raw envelope JSON; 401/400 guards.
- **`/api/agent` (CEO branch)**: `department:"ceo"` short-circuits to
  `synthesize`, streams single chunk, persists conversation turns.

## 4. Middleware reality (per-handler, uniform since W58.2/W59)

Each intent handler: vault first (`fetchVault`) → `resolveDepartments`
with `vaultIndustry: bridgingIndustryFor(vault)` (D-19 precedence +
lazy migration, W59) → opportunistic Qdrant `retrieve` per policy →
`callLLM` → envelope. Auth is body-trust (`userId`/`pbToken` forwarded,
PB row rules enforce at read time) — same trust model as every internal
route; logged as a post-V1 hardening item if the endpoint ever gets
external exposure (W61′ ruling H4).

## 5. Explicitly deferred (SA rulings, W61′)

- **Agent-route migration into the envelope** (H2): NOT required for W62
  (output analysis hooks into the envelope post-generation for intents
  already inside it; client-side W49 persistence gives equivalent hooks
  for the agent path). If ever revisited: requires a streaming `callLLM`
  variant + Groq absorption, priced as its own HIGH-risk tranche.
- **Latency baseline** (H3): operator pulls p50/p95 from Vercel analytics
  if migration is ever considered.
- **Body-trust hardening** (H4): post-V1 ledger.
