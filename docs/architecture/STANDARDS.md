# STAFFD Engineering Standards

> Canonical, consolidated list of the numbered Standards that govern how work is
> done on STAFFD. Each: number + title, the statement, and why it exists.

> **Provenance note (Standard #9 discovery):** Standards #1, #2, #7, #8 are
> recovered verbatim-by-title from in-code citations (`row-rules.ts`,
> tranche comments). Standards #9 and #13–#28 are from the SA dispatches that
> introduced them. **#3, #4, #5, #6, #10, #11, #12 are NOT present anywhere in
> the repo** — they originate from an `SA_HANDOFF` document that isn't checked
> in. They're listed below as **(SA to supply)** placeholders so the numbering
> stays stable; SA should paste the originals.

---

### #1 — Setup Route Discipline
Every user-scoped collection setup route imports and calls the row-rule
enforcement helper after its schema operations, so a new collection can never
ship without its USER_OWNED (or correct) rules. *Why: a collection created
without rules is world-readable until someone notices.*

### #2 — Single Source of Truth
Each fact (row rules, intent fields, model prices, …) is defined in exactly one
registry; consumers import it, never re-declare it. *Why: parallel definitions
drift and silently disagree.*

### #3 — (SA to supply — not in repo)
### #4 — (SA to supply — not in repo)
### #5 — (SA to supply — not in repo)
### #6 — (SA to supply — not in repo)

### #7 — Audit-Before-Extend
Before extending a subsystem, read its current implementation end-to-end; do
not bolt on from assumptions. *Why: extensions built on a misread of the
existing code create subtle, expensive bugs.*

### #8 — Match Scope to Reality
Build to what the system actually is, not to an idealized description; verify
the live/real shape before coding against it. *Why: specs and reality diverge;
code must track reality.*

### #9 — Convention Discovery Precedes Authorship
Before authoring a spec or new module, grep for the existing pattern and follow
it (registries, drawer/modal components, test mocks, doc homes). See
[PARADIGM.md](./PARADIGM.md). *Why: duplicate patterns fragment the codebase.*

### #10 — (SA to supply — not in repo)
### #11 — (SA to supply — not in repo)
### #12 — (SA to supply — not in repo)

### #13 — Runtime Behavior Tests
Fix verification uses runtime behavior tests (invoke the unit with mocked deps,
assert state), not source-text assertions. *Why: source greps pass while
behavior is broken.*

### #14 — Production Bundle Verification
After a fix tranche, verify the production build, not just local dev. *Why: some
breakages (shared-chunk poisoning, edge bundling) only appear in `next build`.*

### #15 — Forensic Escalation
After two iterations on the same bug, stop guessing and gather evidence
(instrumentation across component boundaries) before a third attempt. *Why:
guess-and-check past two tries usually means a wrong mental model.*

### #16 — Convention Discovery Precedes Spec Authorship
The spec author runs discovery first and writes the spec against real
conventions and file paths. *Why: specs that cite wrong paths/patterns cost the
implementer a discovery pass anyway.*

### #17 — Operator Out of the Shell for Routine Ops
Routine operational tasks (migrations, toggles) get an in-app or one-paste path;
operators don't hand-run shell sequences. *Why: PowerShell/alias/escaping
footguns waste cycles and cause silent failures.*

### #18 — Discovery Prompts Ask, Build Prompts Specify
A discovery tranche asks questions and produces findings; a build tranche gives
a concrete spec. They are not mixed. *Why: conflating them yields half-built,
half-explored work.*

### #19 — Adjacent Critical Fixes Allowed (<30 min)
The implementer may take an adjacent infra fix mid-tranche only if it's
security/deprecation-critical AND under ~30 minutes; otherwise flag it. *Why:
keeps momentum without scope sprawl.*

### #20 — Substrate Reuse > Duplication
Converge on existing substrate (the W71 task bus, the worker/commit registries)
rather than building a parallel mechanism. *Why: one bus, one retry model, one
place to reason about.*

### #21 — Honest UI Gaps > Polished Omissions
Surface real empty/error/partial states truthfully rather than hiding gaps
behind polish. *Why: a fake-complete UI erodes trust and hides bugs.*

### #22 — Scoped Fallback Chains
A fallback (e.g. Groq→Anthropic, default-agent) is explicitly scoped to the
caller class it serves; no silent global fallbacks. *Why: an over-broad fallback
masks failures in unrelated call sites.*

### #23 — Platform-Specific Operator Commands
Operator-runnable commands are given as exact, platform-correct copy-paste
(Git Bash real `curl`, not PowerShell aliases). *Why: a "curl" that's an
`Invoke-WebRequest` alias silently mis-sends.*

### #24 — Never Weaken a Gate to Unblock
When blocked by an access constraint, report it and propose an alternate path;
never weaken a security gate to make progress. *Why: expedient gate-weakening is
how prod gets exposed.*

### #25 — Single Operator-Test Queue
Deferred operator-test items go to one tracked doc (`OPERATOR_TEST_QUEUE.md`),
appended — never scattered across reports or duplicated. *Why: one checklist the
operator can actually work through.*

### #26 — Heavy Serverless Deps: Dynamic-Import + Live Sweep
Heavy/node-coupled deps are dynamic-imported inside the consumer function (never
module-top), and every deploy that adds them is verified with a live curl sweep.
*Why: a node:fs-heavy dep in a shared chunk 500'd all `/api` while passing
locally (W91.5); build success ≠ runtime safety.*

### #27 — UX-Law Inversion on UI-Constraining Decisions
A product decision that constrains the UI must pass a UX-law check (Jakob's,
Fitts', Tesler's, Peak-End, Goal-Gradient) before shipping. *Why: count-only
cards with no drill-in dead-ended users (W95.4b inversion).*

### #28 — Registry-Extension Over New Dispatch
New features extend an existing registry (see [PARADIGM.md](./PARADIGM.md)); a
new dispatch pattern requires SA review. *Why: codified from the W95.x registry
work — divergent dispatch patterns are the main maintainability risk.*

### #29 — Canonical Docs Mirroring Code Need a Drift-Guard Test
When a canonical architecture doc reproduces in-code structure (a registry
table, a recipe map, an intent/worker list), ship a CI test that fails when the
doc and the code disagree. The test reads both sides and asserts they match, so
the doc cannot silently rot. *Why: origin example is `paradigm-recipes.test.ts`
(W95.6.y) guarding the PARADIGM.md recipe table against the `SECOND_WORKER`
map; W95.7's substrate health check generalizes the idea at runtime. (The
dispatch numbered this "#28"; #28 was already assigned to Registry-Extension,
so it lands here as #29 per the append convention — Standard #16.)*

### #30 — UI Hide/Remove Dispatches Must Clear Coupled State
When a UI surface is hidden or removed, the dispatch must also clear any
localStorage / sessionStorage / cookie / URL state that surface managed, AND
audit every other site in the app that reads or writes the same state. Leaving a
hidden writer with active readers produces silent-failure modes where stale
state continues routing the application through paths the UI was meant to
control. *Why: W95.7.1 hid the ClientSwitcher without clearing
`staffd_active_client` or auditing the 7 read sites; the entire operator
brand-voice flow broke until W95.7.3a closed the regression.*

### #31 — State-Coupling Audit on Every UI-Touching Dispatch
Any dispatch that touches a UI surface — adds, hides, removes, modifies — must
enumerate explicitly:
- Every localStorage / sessionStorage / cookie / URL param the surface reads or
  writes.
- Every other component, route, or library that reads or writes the same state.
- An explicit ruling on each coupled state element: preserve, clear, or migrate.

Standard #9 (pre-build discovery) gets the read sites; #31 makes the write-side
audit explicit and the coupling decisions explicit. *Why: complement to #30 —
both birthed from the W95.7.1 regression.*

### #32 — Adversarial Review of CC's Proposals Is Mandatory
Before ratifying any CC report, SA must run four explicit checks:
- **Drift**: did CC introduce scope CC wasn't asked for?
- **Conflation**: is CC blending distinct concerns under one label?
- **Bloat**: are abstractions, tests, or files growing faster than the feature
  surface justifies?
- **Assumption**: did CC act on something not explicitly ratified? Substitutions
  are surfaced for operator awareness even when defensible.

If any check fires, name it explicitly in the ratification turn. If none fire,
state so directly. No clean ratifications without the inversion pass surfaced.
*Why: SA had been ratifying CC reports too readily when work landed cleanly; the
operator demanded the Munger adversarial standard be applied to CC's reports the
same way it applies to user assumptions.*

### #33 — Cost exposure audit on every third-party API integration
When STAFFD pays a third party per API call and the customer is charged credits,
the dispatch must enumerate every failure mode and identify which party
(customer / STAFFD / third party) bears the cost. Failure modes where STAFFD
pays without delivering value to the customer must be either (a) prevented
architecturally, or (b) explicitly accepted with a documented rationale.
Charge-on-success-only is a customer-facing UX policy, NOT a margin protection
policy.

Origin: W95.7.2 forensic surfaced Muapi cost exposure (sync timeouts caused
multi-press and closed-tab margin leaks while customer-facing credits stayed at
zero). W95.7.3c investigated and codified the discipline.

### #34 — One dispatch in flight at a time
Sidebar discussions during CC's active work produce conceptual answers and notes
for the next dispatch cycle, never new prompts. SA does not author a new dispatch
until CC's current work returns. This discipline keeps work coherent and
prevents dispatch conflict.

### #36 — Periodic capability audit on third-party integrations.
As vendors evolve their APIs (new endpoints, MCP servers, pre-built
workflows, pricing changes, new models), STAFFD's integration may drift
from using the vendor's best surface to using a stale or limited one.
Capability audits surface this drift before it becomes a competitive
disadvantage or margin problem. Audit cadence: quarterly minimum, or on
operator-surfaced trigger. Audit output: updated capability inventory +
gap analysis + ratified adoption decisions.

### #37 — SA discovery before dispatch authoring.
Before authoring any dispatch involving cost, pricing, UX flow, or
architectural decisions, SA verifies the current architecture matches
SA's mental model by checking userMemories or asking the operator. SA
does not author dispatches based on assumed architecture. CC handles
codebase investigation; SA handles strategy/architecture, but the
strategy must be grounded in actual current state, not assumed state.

### #38 — Every generation trigger passes a tier gate (enforced, not conventional).
No surface may start a paid generation without first showing the customer the
tier picker and obtaining an explicit confirmation (the customer chooses quality
+ sees the credit cost before any submit). This is not left to convention: the
set of allowed `runGeneration` call sites is declared in a registry
(`_lib/generation/trigger-surfaces.ts`) and a CI guard
(`__tests__/generation/trigger-surfaces.test.ts`) fails if any call site under
`app/` or `lib/` is undeclared or stops referencing its paired tier-gate
component. Adding a new generation trigger (e.g. the L4 workflow planner)
therefore forces a conscious register-and-gate step — an ungated trigger can no
longer slip in unnoticed. *Why: the pre-Tranche-1 F5/F6 class (a specialist-driven
generation that submitted to Muapi with no tier confirmation) was closed by
wiring the picker, but nothing prevented a future ungated trigger from
reintroducing it; W95.7.3d-h2 converts the gate from a hope into a mechanical
invariant. Both customer-cost transparency (#27 UX-law) and margin protection
(#33 cost exposure) depend on it.*

---

*New Standards append here with the next free number. If SA supplies the missing
#3–#6 / #10–#12 originals, replace the placeholders in place.*
