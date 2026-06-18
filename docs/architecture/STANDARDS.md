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

---

*New Standards append here with the next free number. If SA supplies the missing
#3–#6 / #10–#12 originals, replace the placeholders in place.*
