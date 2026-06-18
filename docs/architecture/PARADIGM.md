# STAFFD Architectural Paradigm

> Canonical. Standard #9 (convention discovery) and Standard #16 (convention
> discovery precedes spec authorship) cite this document: before adding a new
> dispatch pattern, read this and extend an existing registry.

## The paradigm in one line

**STAFFD is built on registry-driven plug-n-play with append-only event
sourcing for state-of-truth audit.** New behavior is added by appending one
entry to a registry; consequential state is recorded in append-only logs that
are never mutated (reversal is a flag, not a delete).

## Why this paradigm

- **Maintainability** — every change is local: one row in one registry, not a
  new branch threaded through a dispatcher. A new intent, worker, migration, or
  collection is a single append.
- **Auditability** — append-only logs make history reconstructable. An autopilot
  fire, a migration run, a vault decision — each is a durable row; "undo" sets
  `undone_at`, it doesn't erase the record.
- **Composability** — handlers and vendor clients are interchangeable behind a
  uniform interface (`WorkerHandler`, `CommitHandler`, `XClient.forCustomer`).
- **Onboarding** — a new engineer (or a future Claude session) finds the
  registry, copies the neighbouring entry, and is done. No cross-file grep to
  discover "how does dispatch work here."

## Current registries (canonical catalog)

| Registry | File | Keyed by → value |
|---|---|---|
| `WORKER_HANDLERS` | `apps/web/app/api/_lib/worker/handlers.ts` | `specialist_id` → task handler |
| `COMMIT_HANDLERS` | `apps/web/app/api/_lib/intent/commit-handlers.ts` | intent type → commit fn |
| `AUDITED_TARGET` | `apps/web/app/api/_lib/intent/commit-handlers.ts` | audited intent → primary collection (undo) |
| `INTENT_FIELDS` + `AUTOPILOT_TIER_THRESHOLD` | `apps/web/app/api/_lib/orchestrator/intent-policy.ts` | intent type → field spec + autopilot policy |
| `MIGRATION_REGISTRY` | `apps/web/app/api/_lib/admin/migrations.ts` | collection → migration spec (in-app trigger) |
| `EXPECTED_COLLECTIONS` + `*_RULES` | `apps/web/app/api/_lib/security/row-rules.ts` | collection → row-rule shape |
| `CASCADE_COLLECTIONS_USER` / `_AGENCY` | `apps/web/app/api/account/delete/route.ts` | collections wiped on account delete (GDPR) |
| `DEPARTMENT_DEFAULT_AGENT_IDS` | `packages/agents/src/index.ts` | department → default specialist |
| `POLICIES` | `apps/web/app/api/_lib/orchestrator/policies.ts` | orchestrator intent → policy |
| `PLAN_CREDITS` | `apps/web/app/api/_lib/credits.ts` | plan → credit allotment |
| `MODELS` / `MODEL_PRICES_USD_PER_MTOK` | `apps/web/app/api/_lib/llm-router.ts` | model id → config / price |
| `PATTERN_WEIGHTS` | `apps/web/app/api/_lib/vault/patterns.ts` | pattern signal → weight |

> Note: an earlier spec referenced `_lib/pb/row-rules.ts`, `_lib/pb/cascade.ts`,
> and `_lib/intent/intent-policy.ts`. The actual homes are
> `_lib/security/row-rules.ts`, `app/api/account/delete/route.ts`, and
> `_lib/orchestrator/intent-policy.ts` (this table is authoritative).

## Current append-only logs

Never modified after write; reversal/revoke is a flag field, not a row delete.

| Collection | Written by | Reversal flag |
|---|---|---|
| `super_admin_audit_log` | super-admin bypass / dashboard access | — |
| `super_admin_usage_log` | premium ops + intent commits | — |
| `vault_decisions` | every confirmed action / outcome | `dismissed` |
| `vault_patterns` | learned pattern signals | — |
| `admin_migration_log` | in-app migration runs (W95.3.4) | — |
| `autopilot_audit_log` | autopilot fires (W95.5) | `undone_at` |
| `orchestrator_decisions` | routing decisions | — |
| `orphan_decisions` | operator orphan-investigation | — |

## The architectural law

New features **extend a registry**; they do not introduce a new dispatch
pattern without SA review. If you find yourself writing a second `if
(type === …)` ladder or a parallel handler map, stop — append to the existing
registry, or consult SA before adding a new one.

## What this paradigm is NOT

- **Not blockchain** — no crypto chaining, consensus, or distributed ledger.
  But blockchain-*like* in append-only audit discipline.
- **Not a graph database** — no Neo4j. But graph-*like* at the workflow layer
  (`workflow_tasks.depends_on` chains form a DAG the drain reconciles, W71/W72).
- **Not microservices** — single Next.js deploy, single PocketBase instance.
  But microservice-*like* in handler interchangeability behind the registry.

## When to break the paradigm

No standing exceptions in V1. The known tensions are documented where they live
(e.g. the dynamic-import rule for heavy serverless deps — Standard #26 — is a
*bundling* concession, not a dispatch-pattern exception). Anything that would
add a new dispatch mechanism is an SA decision.
