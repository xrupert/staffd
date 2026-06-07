# Post-T2.6.2 Diagnostic — W27 empty-vault copy + W28 handoff render

**Purpose.** Operator UI smoke of PR-T2.6.2 confirmed Qdrant routing works (W26 closed) and CC scroll works (W29 closed). Two surfaces still misbehave: the "Working from limited context" copy fires on the normal empty-vault path (W27 follow-up), and W28's handoff buttons never render in the UI even though the wire-in shipped. NO production code. Diagnostic only.

---

## Investigation A — "Working from limited context" fires on empty vault

### The 4 sites that emit the copy

```
apps/web/app/api/_lib/orchestrator/fallbacks.ts:57-58   — routeFallback (LLM failure)
apps/web/app/api/agent/route.ts:149                      — CEO synthesize last-resort
apps/web/app/api/briefing/route.ts:50                    — morning brief last-resort
apps/web/app/api/_lib/orchestrator/fallbacks.ts:88-99    — briefFallback rationale
apps/web/app/api/_lib/orchestrator/fallbacks.ts:115-119  — synthesizeFallback rationale
```

### Per-site trigger analysis

| Site | When it fires | Is the copy correct? |
|---|---|---|
| `fallbacks.ts:57-58` (routeFallback) | `callLLM` returned `{ok:false}` for the route intent — actual LLM upstream error / deadline / budget | ✅ Correct — true degradation |
| `agent/route.ts:149` | CEO synthesize path produced empty `synth.degraded.task` | ⚠️ Ambiguous — could be LLM failure OR no activity to synthesize across (empty vault on new user) |
| `briefing/route.ts:50` | Morning brief generated empty content | ⚠️ Same ambiguity — could be LLM OR no recent activity to brief on |
| `fallbacks.ts:briefFallback` | callLLM failure for brief intent; falls back to `activitySamples` extractive snapshot | ⚠️ When `activitySamples = []` (new user with no PB documents), the rationale "working from limited context" is misleading — there's literally nothing to summarize, not a degradation |
| `fallbacks.ts:synthesizeFallback` | Same shape — empty `activitySamples` → "snapshot" with no entries | ⚠️ Same |

### Predicate that classifies as degraded

`retrieve.ts` returns `costFlag: "degraded"` in 3 cases:
1. **Line 133-134:** `!userId || !query.trim()` → input validation failure
2. **Line 138-139:** `opts.maxTokens < 100` → caller asked for sub-100-token budget
3. **Line 160-161:** `catch` block — embeddings or Qdrant threw

Successful retrieves that return `items: []` (empty vault, new user) get `costFlag: "ok"` per the normal flow (lines 159-189 score → filter → trim → `trimToCap([])` returns `{items:[], costFlag:"ok"}`). So retrieve correctly distinguishes "empty result" from "errored."

**The classification break is at the next tier:** the brief/synthesize handlers AND the routes that emit last-resort copy don't distinguish between "no work to brief on" (empty vault for new user) and "LLM failed to brief" (true degradation). Both produce empty `task` text → both fall into the same "Working from limited context" copy.

### Root cause (one sentence per Standard #4)

> **The brief / synthesize / morning-brief code paths treat "no activity to summarize" (a normal empty-vault state for new users) and "LLM/system failed to summarize available activity" (a true degradation) as the same condition, both producing empty task text that triggers the same "Working from limited context" fallback copy — misattributing a benign new-user state as a system failure.**

### Minimum-viable fix scope (Investigation A)

**Distinguish at the handler level, not the copy level.**

Files to touch (3):
1. `apps/web/app/api/_lib/orchestrator/handlers/brief.ts` — when activity rollup returns 0 documents AND LLM call wasn't attempted (or returned empty due to no input), set a distinct response field like `degraded.reason = "empty_vault"` instead of `"degraded"`.
2. `apps/web/app/api/_lib/orchestrator/handlers/synthesize.ts` — same shape.
3. `apps/web/app/api/_lib/orchestrator/fallbacks.ts` — extend `briefFallback` + `synthesizeFallback` to accept a `reason` argument; emit one of two copy variants:
   - `empty_vault`: "Your staff is on the floor — as work moves through them, your weekly brief lights up here. Run a few specialists and check back."
   - `degraded` (LLM/system failure — the current default): keep the current "Working from limited context" copy.

Also (4):
4. `apps/web/app/api/briefing/route.ts:50` + `apps/web/app/api/agent/route.ts:149` — last-resort guards inherit the new reason field and emit the correct variant.

LOC: ~40 production + ~6 tests. Test surface: assert that `briefFallback({reason: "empty_vault"})` returns the welcoming copy and `briefFallback({reason: "degraded"})` returns the degradation copy.

`routeFallback` is **NOT** changed — its trigger (callLLM failed) is genuinely a degradation; current copy is correct.

---

## Investigation B — W28 handoff buttons not rendering

### The chain

| Stage | Location | What it does |
|---|---|---|
| 1. Fetch trigger | `CommandCenter.tsx:368` | `if (completedOutput && completedOutput.length > 50)` then call `fetchHandoffSuggestions(...)` |
| 2. Capture site | `CommandCenter.tsx:357` | `const completedOutput = outputBuffer;` |
| 3. State setter | (inside stream loop, line ~340) | `setOutputBuffer(result)` updates React state every chunk |
| 4. Fetch | `CommandCenter.tsx:266` | `POST /api/handoff/suggest` with the captured body |
| 5. Server | `handlers/handoff.ts:142-152` | Returns `{ok:true, followUps:[...]}` on success or `{ok:false, degraded:{followUps:[...]}}` |
| 6. Setter | `CommandCenter.tsx:289-290` | `const suggestions = data.followUps ?? data.degraded?.followUps ?? []; setFollowUps(suggestions.slice(0, 3));` |
| 7. Render | `CommandCenter.tsx:604` | `{phase === "done" && followUps.length > 0 && lastCompleted && (...)}` |

### Root cause (one sentence per Standard #4)

> **`CommandCenter.tsx:357` reads `outputBuffer` from a stale React closure inside `runAgent`'s `finally` block — the `setOutputBuffer(result)` calls in the stream loop queue state updates for future renders but DON'T update the local `outputBuffer` variable inside the still-running `runAgent` function — so `completedOutput` evaluates to the empty initial value (or whatever it was before `runAgent` was invoked), the `completedOutput.length > 50` gate at line 368 fails, and `fetchHandoffSuggestions` never fires.**

This is the classic React closure-over-state bug. The streaming loop's local `result` variable holds the actual completed output — but `result` is scoped inside the `try` block and the `finally` block reads `outputBuffer` (the captured closure value) instead.

State (a) per the spec — **fetch never fires** because `completedOutput` is empty/short.

### Verification path

Quick mental probe:
- The render at line 604 gates on `followUps.length > 0`. `setFollowUps([])` runs at line 298 (start of runAgent) and `setFollowUps(suggestions.slice(0,3))` runs at line 290 (after fetch).
- If the fetch never fires, `setFollowUps` (with non-empty value) never runs → `followUps` stays `[]` → render gate fails → no buttons.
- Symptoms match perfectly: operator saw NO buttons even when the agent's own text mentioned handoff intent. The agent's output contains the handoff suggestion in PROSE, but the structured `/api/handoff/suggest` call to extract them never happened.

A temporary one-liner log at line 357 would prove this in 30 seconds:
```ts
console.log("[CC handoff trigger]", { outputBufferLen: outputBuffer.length, willFire: outputBuffer.length > 50 });
```

But the closure semantics make this near-certain without the probe — `outputBuffer` is captured at runAgent's call time, not at finally-block execution time.

### Minimum-viable fix scope (Investigation B)

**Hoist the streamed `result` to a function-scope variable that the finally block can read.**

Files to touch (1):
1. `apps/web/app/components/CommandCenter.tsx` — in `runAgent()`:
   - Declare `let streamedResult = "";` at function scope (before the try block)
   - Inside the stream loop, append to `streamedResult` alongside (or instead of) `result`
   - In `finally`, read `streamedResult` instead of `outputBuffer`

Alternative shape: use a `useRef` for the output instead of `useState`. Refs aren't subject to render-cycle staleness. But function-scope `let` is simpler + more local.

LOC: ~5 production. Test surface: assert that `runAgent()`'s finally captures the actual streamed text (mock the stream; assert the handoff fetch payload's `outputExcerpt` reflects the streamed content, not an empty string).

### Edge cases worth catching in the fix

1. Stream errors mid-flight → still want `finally` to attempt handoff with whatever was streamed (might be partial; still useful)
2. Empty stream (agent returned nothing) → length-50 gate correctly suppresses handoff
3. CEO synthesize path (line 163 in CC) → separate branch with its own streamed result; same hoisting fix may be needed there if the same pattern exists

---

## Combined fix scope estimate + priority

| # | Work | LOC | Tests | Priority |
|---|---|---|---|---|
| A | Distinguish empty-vault from degraded in brief/synthesize handlers + copy | ~40 | ~6 | **P0** — user-visible misattribution; affects every new user |
| B | Hoist `streamedResult` so `runAgent`'s finally has accurate output | ~5 | ~3 | **P0** — feature shipped but invisible; blocks W28 acceptance |

**Total: ~45 LOC + ~9 tests across 4 files.** Both ship together as one tight PR.

**Recommended PR: PR-Tranche-2.6.3-Empty-Vault-Copy-Plus-Handoff-Capture-Fix.** Either rename or split per Senior Architect preference; the work is small enough either way.

---

## Out of scope (per spec)

- W14 / W15 credit display (separate item; defer to T3 or dedicated UX pass)
- Production code changes (this is diagnostic only)
- New test additions (specified above as scope estimate, not actual code)

## Time used

~20 min of 45-min budget. Both root causes were unambiguous once the relevant code paths were read end-to-end. The W28 closure bug is a textbook React stale-state-in-finally pattern; the W27 copy bug is a missing intent-distinguish at the handler tier.
