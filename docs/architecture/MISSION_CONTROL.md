# STAFFD Mission Control

STAFFD accepts outcome-oriented requests from non-technical customers and turns them into governed, observable work.

## Control flow

```text
customer request
  -> Chief Orchestrator
  -> mission plan
  -> dependency graph
  -> capability handlers
  -> integration harnesses
  -> review and repair loop
  -> approval or completion
```

## Chief Orchestrator

The Chief Orchestrator owns coordination, not specialist work. It:

- clarifies the requested business outcome;
- identifies the required capabilities;
- creates a dependency graph;
- assigns success criteria, budgets, and attempt limits;
- prevents dependent work from running early;
- escalates missing handlers, approvals, repeated failures, and exhausted attempts.

It does not call vendors directly. Vendor access remains behind worker and integration boundaries.

## Missions

A mission is a durable business outcome with:

- requester and customer ownership;
- goal and success criteria;
- constraints and deadline;
- credit budget;
- risk classification;
- dependency-linked steps;
- approval requirements;
- execution attempts and outcomes.

Existing one-step intents remain valid. They become leaf operations that mission capability handlers may invoke.

## Harness engineering

Every capability execution receives a harness policy:

- timeout;
- maximum attempts;
- tool allow-list;
- approval requirement;
- maximum credit spend.

Production adapters must additionally provide correlation IDs, structured logs, secret isolation, rate-limit handling, idempotency keys, and normalized vendor errors.

## Loop engineering

A failed result does not automatically become a completed mission. The bounded loop decides among:

- complete;
- repair and retry;
- escalate for approval;
- escalate after repeated identical failure;
- escalate after the attempt limit.

Loops must never be unbounded and must never retry high-risk side effects without an idempotency guarantee.

## Graph engineering

Mission steps form a directed acyclic graph. The graph validator blocks:

- missing dependencies;
- self-dependencies;
- cycles.

Future persistence should add `missions`, `mission_steps`, `mission_attempts`, and `mission_events` collections. Existing `workflows` and `workflow_tasks` may remain the execution substrate during migration, with mission IDs added as correlation fields.

## Capability adapters

The first production adapters should map capabilities to existing STAFFD surfaces:

| Capability | Existing STAFFD surface |
|---|---|
| business architecture | orchestrator policies and Vault context |
| marketing/content | Studio, Postiz, Listmonk, montage generation |
| sales | contacts, leads, Twenty, outreach workflows |
| customer support | Chatwoot workers |
| legal | Legal specialist and Docuseal review flow |
| analytics | Plausible and mission outcome collection |
| operations | workflows, schedules, task bus |
| finance | expenses, billing, Paddle |

## Delivery sequence

1. Land the pure control plane and CI.
2. Add PocketBase mission collections and typed repositories.
3. Add adapters that translate mission steps into existing workflows/tasks.
4. Add integration harnesses for Chatwoot, Listmonk, Plausible, Qdrant, PocketBase, Postiz, Twenty, Docuseal, Paddle, and model providers.
5. Add mission persistence, resumability, and Vercel observability.
6. Add Mission Control UI with plain-language templates and conversational approvals.
7. Migrate complex intents to missions while preserving simple intent compatibility.

## Product rule

Customers describe outcomes, not implementation. STAFFD may ask only the minimum questions needed to execute safely. Internal concepts such as workers, registries, retries, models, and vendors should remain behind human language such as “working,” “needs your approval,” and “completed.”
