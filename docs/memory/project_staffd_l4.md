---
name: project_staffd_l4
description: "STAFFD L4 (automated team) — the workflow planner; execution substrate pre-existed, planner is the brain on top"
metadata: 
  node_type: memory
  type: project
  originSessionId: 2937f992-0e99-4d3f-ab14-59d1d9a56b02
---

L4 = "automated team" (the L3→L4 jump): a planner that decomposes a high-level goal into a multi-step, multi-department workflow that runs autonomously.

**Critical architecture fact (don't re-derive):** the EXECUTION substrate already exists and is tested — `_lib/workflow.ts`: `drainTasks` runs a DAG of `workflow_tasks` honoring `depends_on` (task ids) + 3-attempt retries; `reconcileWorkflow` derives the parent `workflows` status + runs the aggregate hook; W95.6.x adds `review_required`/`awaiting_review` gates. The per-minute `workflow-drain` cron wires it to PB + `/api/agent`. So **L4 is purely "goal → workflows row + workflow_tasks DAG"** — it reuses all execution unchanged.

**Tranche 1 SHIPPED (commit 5b9726b):** `_lib/orchestrator/planner.ts` (pure, tested — `parsePlan` is the trust boundary validating LLM JSON into a sound DAG: routable depts via the now-exported canonical `ALL_DEPTS` in orchestrator/handlers/route.ts, dependsOn references earlier steps only ⇒ acyclic, ≤MAX_PLAN_STEPS=12) + `POST /api/workflow/plan` (owner-authed → LLM decompose → parsePlan → create workflow + tasks → existing drain runs it).

**Tranche 2 (next):** (a) dedicated `plan` orchestrator intent + policy (Tranche-1 piggybacks "synthesize" — telemetry/cost-attribution debt, Standard #33; adding a new OrchestratorIntent ripples across `Record<OrchestratorIntent,…>` maps — tsc catches all); (b) a CommandCenter "turn this into a workflow" UI trigger + plan preview/approve; (c) stronger planner model. Live decomposition quality + the drain E2E are operator-verified (OPERATOR_TEST_QUEUE #36), not unit-coverable. Relates to [[project_staffd]], [[project_staffd_model_b3]].
