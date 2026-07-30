# STAFFD — Harness / Loop / Graph Assessment & Rebuild Verdict

**Date:** 2026-07-29 · **Author:** Builder (Claude), ratified inputs from SA
**Question answered:** *If we started STAFFD over from scratch, knowing the
harness/loop/graph engineering discipline (Arch Specs #19 & #20) and having
Auto-Company as a candidate framework — what would we do differently? And
does the marketing-routing failure mean the system has an intelligence
problem that justifies a rebuild?*

---

## 1. What STAFFD actually is (verified against code, not docs)

Strip the branding and STAFFD is a **four-layer agentic system**:

1. **A harness** (the environment): Next.js on Vercel, PocketBase +
   Qdrant on Railway, 8 invisible vendor backends behind `forCustomer()`
   leak guards, a 41-collection row-rule security floor with automated
   verify/repair, per-intent LLM policies (deadlines, token budgets,
   retries, fallbacks) in `_lib/orchestrator/policies.ts`, registry-driven
   everything (PARADIGM.md), 39 numbered engineering standards, and a
   1,174-test gate. **This is textbook Harness Engineering and it is the
   strongest part of the system.**
2. **A cognition layer**: 146 specialists (83 generic + 63 pack) with
   brand laws applied at build time, capability declarations, and a
   business Vault (RAG + voice learning + outcome ingestion) that
   compounds per customer.
3. **A control-flow topology** (the graph): Command Center → `route`
   intent → specialist; L4 planner → dependency-ordered workflow → drain
   → review gate (StaffWorkQueue) → second workers (send/publish). Human
   gates sit exactly where Arch Spec #20 says they belong: external
   sends, publishing, signatures.
4. **A feedback layer** (the loop): …and here is the honest finding —
   **this layer barely exists.** Specialists produce one-shot outputs.
   Nothing grades a deliverable against objective evidence before it
   reaches the customer or the review queue. The router is a single
   cheap-model call whose failure path was, until today, a hard-coded
   edge to Marketing.

## 2. Post-mortem: the "marketing agent first" failure — and why it is
## NOT an intelligence problem

The symptom read as "the AI is dumb." The diagnosis (all file:line
verified, all fixed in `673fe7d`) says otherwise. Four **deterministic
engineering defects** compounded:

| Defect | Layer | Nature |
|---|---|---|
| Every degraded route hard-defaulted to `marketing` (`fallbacks.ts`), and the `lastUsedDept` escape hatch was never wired by any caller | **Graph** | A bad fallback EDGE, not a bad model |
| Router prompt listed Marketing first (Set insertion order) with marketing-only exemplars | **Loop** | Prompt-construction bias anchoring a cheap model |
| Keyword safety-net had zero dispute/claims vocabulary — "harassment claim" matched nothing | **Loop** | Missing evidence check |
| Pack specialists were structurally excluded: the vertical gate returned `[]` for the operator, dept rooms never requested the pack roster, category tabs contain no pack ids | **Graph** | Three broken edges between roster and UI |

The model never had a chance to be smart: the graph fed it a biased
roster, gave it no pack agents to choose, and routed every one of its
failures to the same node. **This is precisely Arch Spec #19's diagnostic
matrix**: "first attempt unrefined/hallucinatory → Loop layer;
specialists run out of order / unreachable → Graph layer." The failure
VALIDATES the harness/loop/graph framing — and a rebuilt system with the
same missing loop layer would exhibit the same class of failure with
prettier code.

## 3. The from-scratch thought experiment

If we started today with a blank repo and the two spec docs:

**What we would build the same (≈70% of the system):**
- The harness, almost exactly: Vercel + PB + Railway vendor fleet,
  Model B3 invisibility, row-rule floor, registries, standards, the test
  gate. Nothing in the specs argues against any of it; most of it is the
  specs' Layer 1 done well.
- The product laws (intent-first, no tool palette, bury the meter) — these
  are product decisions, orthogonal to architecture, and they are right.
- The human-gate placement (never-autopilot publish, review-gated sends).
- The L4 planner → approve → execute shape.

**What we would build differently (the ≈30% that matters):**

1. **Every model call becomes a Doer→Grader→Retry node.** The specialist
   drafts; a grader checks objective evidence (brand-law lint,
   Zero-Confusion four-element completeness, schema validation, artifact
   non-emptiness); bounded retries (2–3); stop on evidence, never on
   confidence. Today zero production calls have a grader.
2. **Routing becomes a graph node with typed edges, not a prompt.**
   Deterministic classifiers first (keywords, tags, vault industry), the
   LLM only for genuine ambiguity, an explicit `unroutable` edge that asks
   a clarifying question instead of guessing a department, and NO default
   department anywhere. (Today's fix moved us most of the way; the
   clarifying-question edge is still open.)
3. **The workflow drain becomes a real executor**: parallel fan-out on
   independent tasks (fake-edge pruning), per-workflow circuit breaker +
   cost cap, artifact-per-step convergence rule, and a diamond
   (fan-out → adversarial verify → merge) for CEO brief/synthesize.
4. **A critic node (the Munger)** pre-mortems every L4 plan before it is
   shown for approval — veto-only, customer-invisible.
5. **Observability on decisions, not just calls**: `orchestrator_decisions`
   already logs; a rebuilt system would score routing decisions against
   user corrections and feed that back (the Vault already has the
   outcome-ingestion rails for this).

Note what this list is: **it is items #2–#7 of the upgrade map we already
ratified.** The from-scratch design converges on the evolution plan.

## 4. Should Auto-Company become the framework?

**As a runtime: no.** Verified against its code: it cannot operate an
external repo (hard-coded `projects/` workspace, loop `cd`s into its own
root), runs `bypassPermissions`/`danger-full-access` with prose-only
guardrails, has no verification loop itself (its consensus validation
checks section headers, not work quality), is single-tenant, and its
file-based consensus baton would have to be reinvented on Vercel anyway
(same reason Decision 77 rejected the Hermes task-bus).

**As a pattern library: yes — and that decision is already made.** What
it contributes, mapped: Munger → the critic node (#3); forced-convergence
rules ("no discussion-only cycles", "stuck = pivot") → drain convergence
rules (#6); circuit breaker / rate-limit backoff / soft-timeout
keep-progress → workflow resilience (#7); consensus-baton-per-cycle →
recurring scheduled workflows reading/writing the Vault (#8); expert
mental-model prompting → specialist prompt enrichment, minus celebrity
names (#9). STAFFD's review-gate architecture is strictly safer than
Auto-Company's autonomy model for a production SaaS holding vendor keys.

## 5. Rebuild verdict

**Do not rebuild. Evolve — and specifically, build the loop layer.**

- The evidence for rebuild was one symptom, and its root causes were
  four deterministic bugs in ~200 lines, found and fixed in one session
  with nine pinning tests. That is not a foundation problem; that is a
  missing layer problem.
- A rebuild re-earns ~1,174 tests of survived production incidents (the
  4.5MB body cap, the IDOR class, the silent-no-op cancellation, the
  Vercel fs footguns) and re-derives the entire security floor — while
  the actual gap (no verification loop) would remain unbuilt in the new
  codebase too, because it is additive work either way.
- The SAD's companion doc already made the one rebuild case that holds:
  the **frontend** (Lovable against the existing API) is legitimately
  rebuildable without touching the hardened backend. That option stays
  open and is orthogonal to this assessment.

**The "intelligence" upgrade, concretely, is the ratified roadmap:**
(#2) grader loop in the drain + (#3) critic node — one tranche, the
verification layer; then (#4/#5) parallel drain + diamond synthesis;
then (#6/#7) convergence + breakers; then (#8) recurring staff. Each
lands behind the existing gate, each is testable, none risks the
substrate.

## 6. Scoreboard (2026-07-29)

| Layer | Grade | Evidence |
|---|---|---|
| Harness | **A−** | Policies, registries, security floor, gate. Minus: doc drift (ARCHITECTURE.md still says Stripe). |
| Cognition | **B+** | 146 agents, brand laws, Vault + voice learning. Minus: no mental-model depth, packs were unreachable (fixed). |
| Graph | **B−** | L4 planner + review gates exist and are correctly placed. Minus: router was a single node with a bad fallback edge (fixed); drain is serial; no diamond. |
| Loop | **D** | Per-intent budgets exist; graders do not. One-shot outputs everywhere. **This is the build priority.** |

*Related: PR-Paddle-A (billing live in sandbox, webhook verified 200 via
Paddle simulation), PR-Routing-Fix (`673fe7d`).*
