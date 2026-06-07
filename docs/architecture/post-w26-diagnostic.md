# Post-W26 Diagnostic — W27 / W28 / W29

**Purpose.** Diagnose three issues surfaced during operator UI smoke of PR-T2.5 (commit `e526198`):
- **W27** — orchestrator falling back to deterministic mode in production UI
- **W28** — media-intent requests producing scripts (not media) with no follow-up path
- **W29** — CommandCenter container constraints causing cramped reading

NO production code. Single output: this report. Standard #9 / Decision 71 protocol.

---

## W27 — Orchestrator degraded-mode trigger

### Where the message comes from

```
apps/web/app/api/_lib/orchestrator/fallbacks.ts:51-52
  ? `Routing to your most recently used department while the coordinator is unavailable.`
  : `Routing to a sensible default while the coordinator is unavailable.`,
```

This is the `routeFallback()` deterministic output. It fires when `callLLM()` returns `{ok: false, fallback: …}` and `handlers/route.ts` invokes `degradedFor("route", …)`.

### Why it fired (THE ROOT CAUSE)

**`callLLM()`'s catch block at `apps/web/app/api/_lib/orchestrator/llm.ts:213-232` silently swallows the actual Anthropic SDK error — the resulting production logs cannot distinguish auth failure, rate limit, deadline timeout, or any other trigger.**

Trace:
```ts
// llm.ts:213-232
} catch (err) {
  lastErr = err;                                      // ← captured...
  const aborted = err instanceof Error && err.name === "AbortError";
  const retryable = isRetryable(err);
  if (attempts >= maxAttempts || (!aborted && !retryable)) {
    const fallback: FallbackReason = aborted
      ? "deadline_exceeded"
      : "upstream_error";
    return { ok: false, fallback, ... };             // ← returned with classification
  }
  // ...retry path
}
// at line 249, the function ends with:
//   void lastErr;                                    // ← but lastErr is NEVER LOGGED
```

`lastErr` is captured but never `console.error`'d. The only signal that reaches production logs is the fallback string — which buckets *every* failure mode into `upstream_error` or `deadline_exceeded` without the underlying message.

For the operator's "tik tok video for earthly matters" request, the orchestrator's `route` handler invoked `callLLM()` which trapped some Anthropic SDK exception, mapped it to `upstream_error`, and routed through `degradedFor("route", ...)` → produced the "sensible default" message. **The actual exception (auth / rate-limit / 5xx / timeout) is unrecoverable from logs.**

### Other findings in the search

| # | Finding | Severity |
|---|---|---|
| 1 | `ANTHROPIC_API_KEY` is NOT in `apps/web/lib/env.ts` W8-resolver — relies on Anthropic SDK's automatic env-read (`new Anthropic()` with no args at `llm.ts:24`). If Vercel env is set to empty string (the W8-class pattern), SDK init succeeds but every `messages.create()` throws — caught silently per above. | High — W8-class latent footgun |
| 2 | `routeFallback()` in fallbacks.ts has **NO semantic awareness of intent**. It picks `lastUsedDept` OR `marketing` regardless of what the user requested. "I need a tik tok video" → routed to last-used dept (or marketing) → a content/copy specialist → wrote a script. This is the upstream cause of W28's symptom when the orchestrator degrades. | Medium — design gap in fallback logic |
| 3 | The W28 symptom can occur even with a SUCCESSFUL orchestrator path if the orchestrator's `ceo-agents-orchestrator` system prompt + runtime roster fail to identify "video" as a media-generation request — it would still route to a marketing/content specialist who writes scripts not videos. | Medium — separate routing-intelligence gap |

### Why Claude Code's earlier smoke succeeded but operator's didn't

Claude Code's 2-turn smoke (commit `e526198` smoke at task `b8p8n2bt6`) used userId `9c158wy9631p6k6` (super-admin) with prompt `"I need help writing a quick LinkedIn post about a product launch"`. The orchestrator routed cleanly to `marketing-linkedin-creator`. The operator's request was "tik tok video for earthly matters about interior painting" — different prompt, possibly different user.

Without the swallowed error, we can't tell which of these is the actual trigger:
- (a) Anthropic SDK rate-limit / 429 during operator's request (transient)
- (b) ANTHROPIC_API_KEY env-var state changed between Claude Code's smoke and operator's smoke
- (c) Deadline-exceeded (4s for `route` intent — operator's prompt is shorter; unlikely)
- (d) LLM output didn't parse as valid `OrchestratorDecision` JSON — falls through to `degraded` in handlers/route.ts:191-204

The first concrete fix is to log the error. THEN we can identify the trigger from logs and apply the correct upstream remediation.

### Named root cause (one sentence — per Standard #4)

> **`apps/web/app/api/_lib/orchestrator/llm.ts:249` discards `lastErr` via `void lastErr` without ever console-logging it, so every Anthropic SDK exception (auth failure, rate limit, timeout, parse failure) collapses into an opaque "upstream_error" fallback and the production logs cannot distinguish which condition actually fired.**

### Fix scope (W27)

**Minimum viable (P0):**
1. `apps/web/app/api/_lib/orchestrator/llm.ts` — `console.error("[orchestrator.llm] attempt failed", { intent, model, attempts, err: ...serialize(lastErr) })` inside the catch's failure branch (line 217-231) AND on the final unreachable-return path (line 240). Serialize `err.message` + `err.status` + `err.name` + first line of stack.
2. Add ANTHROPIC_API_KEY to `apps/web/lib/env.ts` as `resolveAnthropicKey()` with the same defensive contract (empty / whitespace → throw at module load, never silently degrade). Anthropic SDK doesn't accept a key constructor arg in the current usage; either pass `{ apiKey: resolveAnthropicKey() }` to `new Anthropic({...})` or just call the resolver at module load so misconfigured deploys crash fast.

LOC estimate: ~25 (logging) + ~30 (resolver) + ~6 tests = ~60 LOC.

**Followup (after logs surface the real trigger):**
- If trigger = auth failure → fix env config + ensure resolver catches it next time
- If trigger = rate limit → consider higher retry budget for route intent OR upstream backoff
- If trigger = output parse failure → tighten the system prompt's ROUTE: line format or relax the parser
- Improve `routeFallback()` semantic-awareness so degraded routing for media intent reaches `design` not `marketing` (separate fix from the logging one)

---

## W28 — Media-intent doesn't chain to media generation

### Current state

`CommandCenter.tsx` only invokes `/api/orchestrate` (intent="route"). Once the agent finishes, the output panel renders the generated text and **nothing else fires.**

Verification:
- `grep "handoff" CommandCenter.tsx` → **zero hits** (CC does not call `/api/handoff/suggest`)
- `grep "next_action|Generate.*video|Generate.*image" CommandCenter.tsx` → **zero hits**
- `/api/agent` response shape (streaming text body) has no metadata channel for downstream actions

The orchestrator's `intent="handoff"` IS shipped (per Discovery PR-T2.0 + commit `f939bec` diagnostic §6) and IS wired from DepartmentRoom.tsx via `<HandoffPanel>`. CommandCenter has never been wired to it — Phase 9 work shipped handoff for DepartmentRoom only.

### Gap vs Decision 9

Decision 9: *"Cross-functional handoff is intelligent. System suggests next steps based on what was produced and the user's unlocked plan."*

For a media request that lands on a script specialist, the intended behavior is: agent produces script → handoff intent fires → orchestrator identifies "user wanted media; script is a step" → returns `followUps: [{department: "design", task: "Generate the TikTok video for this script", rationale: "..."}]` → UI renders a "Generate the video" affordance.

Today, **no such chain fires in CommandCenter.** The user gets the script and a dead end.

### Two minimum-viable fix paths

**(a) UI-side affordance — CC fires handoff intent after every generation.**

After `runAgent()` completes in CommandCenter.tsx, fire-and-forget `POST /api/handoff/suggest` with `{userId, pbToken, sourceDoc: {department, prompt: task, outputExcerpt: result}, query: original-user-message}`. Render the returned `followUps[]` as buttons below the generated output panel. Clicking a button calls `send()` with the suggested task pre-filled (which re-routes through the orchestrator and lands on the suggested department).

- Pros: ~60 LOC; reuses existing `/api/handoff/suggest` route + orchestrator handoff handler; no agent/system-prompt changes
- Cons: extra orchestrator call per generation (handoff intent budget = 6s deadline, max_tokens 1024 — cheap); follow-ups quality dependent on handoff intent's output

**(b) Agent-side handoff metadata — agents emit structured next_actions.**

Update `/api/agent` to optionally stream a `NEXT_ACTIONS:[...]` trailer (mirror the `READY:{...}` pattern from orchestrate). Update relevant agent system prompts to emit this for media-adjacent tasks. UI renders them generically below output.

- Pros: agent-aware (the specialist who just produced the work proposes the next step in context); zero extra LLM calls
- Cons: ~200 LOC + per-agent system-prompt updates; requires defining a canonical NEXT_ACTIONS schema; agent prompts are already complex

### Recommendation

**(a) is the right first fix.** It's strictly additive infrastructure that ships in one PR with one new route call, reuses the already-shipped orchestrator handoff intent, and matches the DepartmentRoom handoff pattern (consistency across surfaces). After it ships and operator validates the followUps quality, (b) can be considered as a depth improvement.

Important corollary: even with (a), the upstream W27 routing-quality issue still matters. The handoff intent will only propose "Generate the video" if the orchestrator correctly identified the original request as media. If the orchestrator routed to a marketing specialist (because the system prompt didn't recognize "tik tok video" as media intent), the handoff suggestions may also not include design. **The W27 routing-intelligence improvement and the W28 handoff wiring are complementary, not redundant.**

### Fix scope (W28)

Path (a):
- `apps/web/app/components/CommandCenter.tsx` — after runAgent() completes, fire `POST /api/handoff/suggest`; new state for `followUps[]`; render below output panel
- ~60 LOC + ~4 tests
- Depends on W27 fix (no point firing handoff if the orchestrator routed wrong dept; the handoff suggestions will mirror the routing bug)

---

## W29 — CommandCenter scroll constraint

### Where it lives

```
apps/web/app/components/CommandCenter.tsx:394
  <div className="px-5 py-4 flex flex-col gap-3 max-h-96 overflow-y-auto">
```

Tailwind `max-h-96` = 24rem = 384px. Once the message thread exceeds 384px, the inner div scrolls while the page-level container has unused space below the card.

### DepartmentRoom comparison

DepartmentRoom.tsx has `max-h` only on its drawer side-panel (line 837 — `max-w-md h-full overflow-y-auto` for the side drawer). The **main message thread in DepartmentRoom has no max-h** — content flows naturally and the page scrolls.

### Rewrite approach

Remove `max-h-96 overflow-y-auto` from the CommandCenter message thread div. Let the card grow with content; let the page scroll. Keeps the chrome (header / input) sticky in their existing positions; the thread becomes a normal flowing list.

**Counter-option:** if "infinite growth" is undesirable (concerns about losing context on very long conversations), change to `max-h-[70vh] overflow-y-auto` — same scroll behavior but uses 70% of the viewport height instead of 384px. Either is ~5 LOC.

**Recommendation:** **remove the constraint entirely** (match DepartmentRoom semantics) for consistency. If long-conversation friction surfaces post-fix, add a viewport-height constraint later. Standard #8 (match scope to reality) — don't pre-build a constraint we don't have evidence for.

### Fix scope (W29)

- `apps/web/app/components/CommandCenter.tsx:394` — single-line edit
- ~3 LOC
- Optional new test asserting the thread div doesn't carry `max-h-96`

---

## Combined fix scope estimate + priority

| # | Work | LOC | Tests | Priority | Notes |
|---|---|---|---|---|---|
| W27.1 | Log `lastErr` in `callLLM()` catch + final return | ~25 | 2 | **P0** | Unblocks diagnosis of every future fallback trigger; ships standalone |
| W27.2 | `resolveAnthropicKey()` in `lib/env.ts` + wire at module load | ~30 | 4 | **P0** | W8-class hardening; prevents the latent footgun the operator may be hitting |
| W27.3 | `routeFallback()` semantic-awareness (media intent → design) | ~40 | 3 | P1 | Improves degraded-path quality; less critical once W27.1/2 reduce degradation frequency |
| W28 | CC fires handoff intent after generation; renders followUps | ~60 | 4 | P1 | Closes the media-chain gap per Decision 9 |
| W29 | Remove `max-h-96` from CC message thread | ~3 | 1 | P2 | Cosmetic; immediately fixable |

**Total: ~158 LOC + ~14 tests across 3-4 files.**

**Recommended PR sequencing:**

- **PR-Tranche-2.6-W27-Logging-Hardening** (P0 — W27.1 + W27.2): ship first, then operator triggers a degraded path; logs reveal the real trigger; SA decides whether W27.3 follow-up is warranted.
- **PR-Tranche-2.7-CC-Handoff-Chain** (P1 — W28 path (a)) + the W29 max-h removal as a piggyback: small enough to ride along with W28.
- **PR-Tranche-2.8** if needed for W27.3 routeFallback semantic-awareness after W27 logging reveals the trigger and SA judges fallback quality matters.

Standard #9 satisfied — every fix scope is grounded in evidence above, no speculative work.

NO production code shipped in this diagnostic.

---

## Time used

~25 min of 60-min budget. W27 root cause was unambiguous in <15 min once `lastErr` discard at line 249 was located.
