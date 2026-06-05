# Command Center Handoff — Diagnostic (W26)

**Purpose.** Surface the root cause of the W26 Command Center handoff failure surfaced during PR-Tranche-2 operator smoke. NO production code shipped — diagnostic only. Decision 66 + Standard #9 apply.

**Symptom (operator report):** *"User consents to a suggested transfer with 'yes', system fails to interpret it, UI loses input affordance, conversation stalls."*

**Root cause (one sentence per Standard #4):** **The Command Center's `phase` state machine treats `"done"` as terminal — after the FIRST runAgent completes, the input textarea is hidden by `{phase !== "done" && …}` at line 483 of `apps/web/app/components/CommandCenter.tsx`, leaving the user with only a `+ New request` link that wipes the entire conversation; no mechanism exists for follow-up refinement or for the orchestrator to interpret a new instruction within the same thread.**

The user's "yes" was almost certainly interpreted correctly on the first turn (the `CONFIRM_WORDS` regex match + `runAgent()` execution path is sound). What they perceived as "fails to interpret" was the post-generation `phase === "done"` lockout — once the input disappears, any further consent / refinement / follow-up has nowhere to go.

---

## §1 — Command Center call graph

**UI entry point:** `apps/web/app/components/CommandCenter.tsx` (553 LOC). Imported on the dashboard.

**Submit handler:** `send(text?)` at line 112. On every submit:
1. Push `{role: "user", content}` to messages
2. Set `phase = "routing"`
3. **Branch A (pendingAction + CONFIRM_WORDS match):** execute via `runAgent()` → `/api/agent`
4. **Branch B (everything else):** POST to `/api/orchestrate` → stream rationale + `READY:{...}` payload

**Routes consolidated through orchestrator:** ✅ `/api/orchestrate` calls `runOrchestrator({intent: "route"})` per Discovery PR-T2.0. Cross-check with `apps/web/app/api/orchestrate/route.ts` lines 95-122 — payload shape confirmed (`READY:{department, agentId, task, lockedAlternative}`).

**`runAgent()`** (line 200): POSTs to `/api/agent` with `{task, department, agentId, userId, pbToken, clientId, threadId}` and streams the response.

---

## §2 — Recommendation render path

The orchestrator's `route` handler returns a structured `OrchestratorDecision`. The `/api/orchestrate` thin wrapper composes the stream as:

```
{rationale text}\n\nREADY:{"department":"...","agentId":"...","task":"...","lockedAlternative":"..."}
```

The rationale is the LLM-generated explanation (e.g. *"Your SEO Specialist on the Marketing team is the right fit"*). The `READY:` line is appended unconditionally — the protocol contract the UI parses.

**UI render:**
- Line 176-184: `readyMatch = assistantText.match(/READY:(\{.+?\})/s)` — parses the trailing payload, calls `setPendingAction(action)`, drops `phase` to `"idle"`.
- Line 282: `cleanContent()` strips the `READY:{…}` line from display.
- Line 455-471: When the assistant message contains `"READY:"` AND `!isWorking`, render the **"Yes, run it →"** + **"Cancel"** button pair.

**Consent capture mechanism:**
- Click "Yes, run it →" button: `onClick={() => void send("yes")}` (line 458)
- Type "yes" (or any `CONFIRM_WORDS` match) in textarea: `send()` is dispatched on Enter, content matches the regex at line 110

Both paths converge at the `send("yes")` entry → Branch A → `runAgent()`.

---

## §3 — Consent handler — analysis vs the "likely bug"

The consent handler **does exist and does fire correctly** (state (a) per the spec). Verbatim trace:

```ts
// CommandCenter.tsx:126-140
if (pendingAction && CONFIRM_WORDS.test(content)) {
  setPhase("generating");
  const confirmMessages = [...newMessages, { role: "assistant", content: `EXECUTE:${JSON.stringify(pendingAction)}` }];
  setMessages(confirmMessages);
  setLastLockedAlt(pendingAction.lockedAlternative?.trim() ? pendingAction.lockedAlternative : null);
  await runAgent(pendingAction.department, pendingAction.task, userId, pbToken, pendingAction.agentId);
  return;
}
```

`CONFIRM_WORDS` regex (line 110) accepts: `yes | confirm | confirmed | approved | approve | go | do it | go ahead | sure | yep | yup | ok | okay | sounds good | make it | run it | let's go`. Anchored at `^` only — leading "yes" anywhere wins (intentionally permissive).

**State checks:**
- (a) Handler exists and fires: ✅ proven by code trace
- (b) Read-only UI after recommendation: ❌ false — buttons render; input accepts
- (c) Handler target misconfigured: ❌ false — `runAgent()` correctly receives `department + task + agentId` from the pendingAction object. `agentId` is validated by the orchestrator's Hotfix A4 path (handlers/route.ts:205-220) before being included in READY, so a malformed id is unlikely.

**Verdict:** consent handler is fine. The bug is elsewhere.

---

## §4 — Input affordance after recommendation — THE BUG

**Critical site:** `CommandCenter.tsx` line 483:

```tsx
{/* Input */}
{phase !== "done" && (
  <div style={{ borderTop: messages.length > 0 ? "1px solid #1E1E2A" : "none" }}>
    <textarea … />
  </div>
)}
```

The entire input section is **gated on `phase !== "done"`**. State machine:

```
idle
 └── send() called → "routing"
      ├── Branch A (CONFIRM_WORDS match) → "generating"
      │    └── runAgent() finally → "done"   ← INPUT DISAPPEARS
      └── Branch B (orchestrator route)
           ├── READY: in response → setPhase("idle") + pendingAction set
           └── no READY: → setPhase("idle"), pendingAction = null
```

**`runAgent()`'s finally block** (line 251):

```ts
} finally {
  setPhase("done");
  setPendingAction(null);
  setTimeout(scrollToBottom, 100);
}
```

`done` is reached on BOTH success and failure paths. From the user's perspective:
- Output rendered (or "Something went wrong" line) → input vanishes → only the **"+ New request"** link remains (line 535-548)
- Clicking **"+ New request"** calls `reset()` (line 258), which clears all messages, rotates the thread id, and re-creates the storage key

**There is no `done → idle` transition triggered by user input.** The only escape from `done` is the destructive `reset()`.

This matches the operator's "nowhere left to reply / conversation stalls" report verbatim.

---

## §5 — Direct-department flow comparison (works)

Direct dept flow (e.g. `/dashboard/design`) uses `DepartmentRoom.tsx`, **not** `CommandCenter.tsx`. DepartmentRoom is a long-lived multi-turn surface — every `generate()` invocation adds to the existing thread and the input stays visible throughout. No `phase === "done"` lockout exists because DepartmentRoom's state model treats every generation as "one step in an ongoing conversation," not as a terminal event.

**Delta (single-line summary):** CommandCenter is single-shot by design (route → confirm → generate → done). DepartmentRoom is multi-turn by design (route is implicit; every send is a generation; input always available).

The W26 failure is the natural consequence of routing a multi-turn use-case through a single-shot UI. The orchestrator + agent layer behaves identically for both surfaces; the UX gap is purely in the CommandCenter component.

---

## §6 — Cross-check ARCH §5 + Discovery PR-T2.0

Discovery PR-T2.0 (commit `a46c515`) named 4 routes consolidated through `runOrchestrator()`:
- `/api/orchestrate` (route intent) — **VERIFIED LIVE** at line 144 of CommandCenter.tsx
- `/api/briefing` (brief intent)
- `/api/handoff/suggest` (handoff intent)
- `/api/orchestrator` (direct)

**Discovery audit accuracy:** Discovery was correct that `/api/orchestrate` is consolidated. What Discovery did NOT audit is whether the **calling UI** correctly consumes a follow-up turn after the first generation. That UI-layer behavior is the W26 surface.

This is not a Discovery bug — it was out of scope. Discovery audited orchestrator surface area, not UI state-machine completeness. Adding "consumer UI state-machine correctness" to a future Discovery dimension is a small Standard #9 enhancement, but not retroactively required.

---

## ROOT CAUSE (one sentence — per Standard #4)

> **CommandCenter.tsx hides the input textarea on `phase === "done"` (line 483) after every completed generation, leaving the user with only a destructive `+ New request` reset link and no path to refine, follow up, or continue the conversation — matching the operator's reported "nowhere left to reply" symptom.**

The consent handler, orchestrator routing, agentId validation, and runAgent execution all work correctly. The bug is a UI state-machine gap, not a logic failure.

---

## Minimum-viable fix scope (PR-Tranche-2.5-Command-Center-Handoff-Fix)

**Files to touch (2):**
1. `apps/web/app/components/CommandCenter.tsx` — primary fix
2. `apps/web/__tests__/components/command-center.test.tsx` — NEW test file

**LOC estimate:** ~25 LOC of code change + ~80 LOC of tests.

### Code change (CommandCenter.tsx)

**Change 1 — make input always-visible while messages exist.** Remove the `phase !== "done"` outer guard at line 483. Keep the existing `disabled={isWorking}` inner disable so the input correctly greys out during routing/generation but remains visible.

**Change 2 — auto-transition `done → idle` on new send.** First lines of `send()` (line 112):

```ts
if (phase === "done") setPhase("idle");
```

This lets `send()` re-route a new user message through the orchestrator OR (if they typed a follow-up that's NOT a confirmation) treat it as a new request in the same thread — `threadId` is preserved across this transition, so the conversation row in PB stitches together server-side.

**Change 3 — replace the `+ New request` link with `+ Start fresh`** (or similar) and surface a quieter follow-up affordance. The destructive reset still has its place (user really wants a clean slate), but the dominant action should be "continue talking."

**Change 4 — phase-name cleanup.** Rename `"done"` → `"idle_after_generation"` OR just drop it entirely (collapse into `"idle"`). The `"done"` semantic is what created the trap. Once input stays visible, there's no functional difference between "idle, no recent generation" and "idle, just finished one."

### Tests (NEW)

1. After successful runAgent → phase becomes idle (not done); textarea is visible
2. Typing a follow-up message after generation → orchestrator is called with full message history including the prior generation context
3. "+ Start fresh" / reset button still wipes correctly and rotates threadId
4. Disable behavior during isWorking still applies (input visible but disabled)
5. Confirmation flow still works on first-turn READY: payload (regression guard)

### Out of scope for the fix

- Restructuring DepartmentRoom + CommandCenter into a shared component (real refactor — defer)
- Mid-conversation re-routing (orchestrator interpreting a topic shift and suggesting transfer to a different dept) — this is a feature, not a bug fix
- Threading metadata UI (current thread name, etc.) — already covered by ThreadPickerDrawer

### Estimated complexity: 2/10

Single state-machine fix + 5 tests + one operator smoke. ~30 min from spec lock to deploy.

---

## Time used

~25 min of 45-min budget. Root cause was unambiguous in <20 min once the CommandCenter source was read end-to-end; remaining time spent on cross-checks (orchestrator validation, /api/agent gates, Discovery audit reconciliation) to rule out the consent-handler-broken hypothesis.

No code written. Diagnostic locked. Standing by for PR-Tranche-2.5-Command-Center-Handoff-Fix spec.
