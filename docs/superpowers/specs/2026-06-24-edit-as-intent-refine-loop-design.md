# Edit-as-Intent Refine Loop — Design

> Spec for roadmap item #3 (`project_staffd_roadmap_gaps`): the edit-as-intent
> refine loop. Closes the "no background + outline" failure where following up on
> a finished visual orphans the artifact and produces something generic.
> Date: 2026-06-24. Status: design (pre-implementation).

## 1. Problem

A finished visual renders inline in the Command Center / Department Room as a
`media: { kind, urls }` message. There is **no affordance to edit it** and **no
handle to "edit THIS one."** When the user follows up with "no background +
black outline" or "give me variations", that text goes through the normal
orchestrator as a *fresh task* → it produces generic text or a brand-new generic
image. The previous artifact is orphaned. That is the failure this spec fixes.

Today's generation is **text-to-X only**: `POST /api/integrations/muapi` takes
`{ kind, prompt, tier, department, seed }`, enriches the prompt, routes to a
text-to-image / text-to-video slug, submits, polls. The image-input (i2v) slugs
were deliberately removed because the conversational flow never supplied a
source image. Editing an existing artifact is a fundamentally different request:
it has a **source artifact** as input and an **edit operation** to apply.

## 2. Product framing (laws this obeys)

- **Intent-first, never a tool palette.** Editing = *directing changes*
  ("remove the background", "make it blue"), routed to the right backend — not
  operating an editor. No model pickers, no vendor names. Smart affordance chips
  are allowed and used here.
- **Model B3 — invisible operator-shared backends.** The edit endpoints
  (muapi) are resolved server-side; their slugs never reach the client.
- **Bury the meter.** Image edits are unmetered (same as image generation,
  ~pennies). Only video edits carry the tier credit weight.

## 3. Resolved decisions (SA-ratified 2026-06-24)

1. **Surfacing:** BOTH smart edit chips under each visual AND free-text refine
   detection (a follow-up typed while the last message is a visual).
2. **Scope:** image AND video edits in this tranche. Video edits = recombine /
   trim via `video-combiner` and captions via `motion-graphics-edit`. The
   `video-combiner` submit plumbing is built so the separate #2 multi-shot
   stitch work **reuses** it rather than forking it.
3. **Compound image instructions** ("no background + black outline" = two
   operations) resolve as a **single `instruct_edit` pass** to the
   instruction-edit model (`nano-banana-pro-edit`), which handles compound
   instructions in one render. No op-chaining in v1; each video edit is a single
   op too.
4. **Explicit, visible active-artifact selection** (Laws-of-UX refinement,
   2026-06-24). The edit target is *declared by the user and shown by the UI*,
   not inferred from conversation state. Grounded in Law of Common Region
   (controls inside the artifact's boundary read as "this one"), Jakob's Law
   (select-then-act is the learned mental model), Fitts's Law (controls sit where
   attention already is), and Tesler's Law (the user resolves the "which
   artifact?" ambiguity with one cheap click instead of the system guessing
   wrong). Free-text refines apply only when an artifact is visibly active.

## 4. Architecture

Mirrors the existing generation spine (auth, job ledger, webhook/poll, inline
render) rather than inventing a parallel one.

### 4.1 New sibling route — `POST /api/generation/edit`

Separate from `/api/integrations/muapi` (text-to-X) because the request shape and
routing model differ. **Reuses the same spine:** `whoAmI` auth (Standard #39 —
never trust a body `userId`), credit pre-flight gate, `createJob` / `completeJob`
ledger, completion webhook + client poll, and the inline-render contract.

Request body:

```
{ kind: "image" | "video", sourceUrl: string, instruction: string, tier?, department? }
```

Rejected alternative: overloading the muapi route with an `editOf` field —
tangles two routing models in one handler.

### 4.2 Edit-op classifier — `app/api/_lib/generation/edit-ops.ts`

Maps the instruction words → an **operation** (the intent vocabulary, NOT a
model). v1 operations:

| Op                 | Triggers (examples)                              | Backend (resolved server-side) |
| ------------------ | ------------------------------------------------ | ------------------------------ |
| `remove_background`| "no background", "transparent", "cut it out"     | background-removal slug        |
| `instruct_edit`    | "make it blue", "add a black outline", "remove the text" — the catch-all instructional refine, incl. compound | `nano-banana-pro-edit` |
| `variations`       | "give me options", "more like this", "variations"| re-run source prompt, new seeds (reuses existing `generateImageOptions` path; needs no source image) |
| `recombine` (video)| "reorder", "stitch these", "combine"             | `video-combiner`               |
| `trim` (video)     | "make it shorter", "cut to N seconds"            | `video-combiner`               |
| `add_captions` (video) | "add captions", "add subtitles"              | `motion-graphics-edit`         |

Classification: a **deterministic keyword pass first** (free, covers the obvious
cases such as "background" → `remove_background`); fall back to a small
`callLLM` classifier for ambiguous instructions (reuses the existing LLM call
allowlist — no new call site pattern). Returns `{ op, editPrompt }`, where
`editPrompt` is the instruction text passed to the backend for `instruct_edit`.
Returns `null` when the text is not an edit instruction (so free-text detection
can fall through to normal routing).

### 4.3 Edit-model routing — extend `app/api/_lib/generation/routing.ts`

Add an edit band alongside the existing text-to-X bands:

```
EDIT_MODELS: Record<EditOp, string[]>   // ordered slug preference per op
```

Same swappable-registry pattern and the same `validateRoutingSlugs` catalog
check (edit slugs included in `allRoutingSlugs`). Each op also carries an
`EditOpSpec` that owns the per-endpoint **body shape** (`image_url` + `prompt`
for `nano-banana-pro-edit`; `image_url` only for background removal;
`videos_list` for `video-combiner`) via `buildBody(sourceUrl, editPrompt)`.
`submitPrediction` is already body-generic — no change there. Slugs and body
field names are verified against the live muapi OpenAPI during implementation
and are the single place that knowledge lives.

### 4.4 Active-artifact selection (client) — explicit + visible

The edit target is **declared by the user and shown by the UI**, not inferred.
Each inline `media` message carries a stable source identity and renders an
**on-artifact edit bar** within the image/video container (Law of Common Region
— controls inside the boundary read as "for this artifact"; Fitts's Law — they
sit where attention already is). Bar contents:
- image: `Remove background` / `Variations` / `Refine…`
- video: `Reorder` / `Trim` / `Add captions`

Selection rules:
- **Single result** — clicking any chip both *selects and acts* (no separate
  "hold" step; Occam's Razor). The acted-on artifact becomes the active target.
- **3-option image grid** — the user first **picks one** (it gets a selected
  ring; Von Restorff). Refines target that option. "Remove the background" on an
  un-picked grid is ambiguous, so a pick is required before a grid refine.
- The currently-active artifact is the most recently generated/edited visual, or
  the one the user explicitly selected — whichever is later.

**Composer feedback pill.** Whenever an artifact is the active target, a small
`Editing your visual ↑` pill renders above the input — the system's visible
confirmation of the target. It closes the loop both directions: the user sees
what a typed instruction will edit, and the "specialist" is told what to edit. A
dismiss (×) on the pill clears the active target → the next message is a fresh
task, not an edit.

### 4.5 Free-text detection in the `send` path

Before the normal orchestrator route in `CommandCenter.send` (and the
DepartmentRoom equivalent): a typed message is treated as an edit **only when an
artifact is the visibly-active target** (the composer pill is showing) AND the
edit-ops classifier returns a non-null op. Then route to `/api/generation/edit`
with the active artifact's `sourceUrl`. Otherwise, normal route.

Because the target is now **explicit and visible** (§4.4), the earlier
"infer the last visual" guess is gone — and with it the over-capture risk. The
remaining guards are cheap: an explicit "new image of X" / "another" cue, or
dismissing the pill, forces fresh generation even with an active target; and a
`null` classifier result always falls through to normal routing.

### 4.6 Tier gate (Standard #38)

The edit route is a new generation trigger → registered in
`app/api/_lib/generation/trigger-surfaces.ts`, and the CI guard test
(`__tests__/generation/trigger-surfaces.test.ts`) gets the new surface entry.
Images (incl. edits) are unmetered (credit weight 0, consistent with image
generation). Video edits are metered at the tier credit weight and must pass the
inline tier gate (`GenerationTierInline`), same as video generation. A chip or
free-text refine that can start a **video** edit routes through the tier gate; an
image edit submits directly (weight 0).

### 4.7 The loop

An edit result completes → renders as a NEW inline `media` message → which
carries its own edit affordances and becomes the new active artifact. The user
refines N times.

## 5. Data flow

```
visual rendered inline (on-artifact edit bar; a 3-up grid needs a pick first)
  → user clicks an edit chip  OR  selects an artifact then types "no background + black outline"
  → active target set → composer shows "Editing your visual ↑"
  → client resolves the active artifact sourceUrl
  → (video → inline tier gate)
  → POST /api/generation/edit { kind, sourceUrl, instruction, tier, department }
  → server: whoAmI (#39)
          → classify op (edit-ops: keyword, then LLM fallback)
          → route slug (routing EDIT_MODELS)
          → buildBody(op, sourceUrl, editPrompt)
          → submitPrediction → createJob (image weight 0 / video tier weight)
  → completion webhook (primary) or client poll → completeJob (charge once)
  → result url → new inline media message (re-editable) → loop
```

## 6. Error handling

- **No source artifact resolvable** → 400 `source_required`; client keeps the
  message as normal text (does not silently drop).
- **Classifier returns `null`** (not an edit) → free-text falls through to the
  normal orchestrator route; chips never produce `null` (their op is fixed).
- **`routing_unresolved`** for an op (no slug registered) → structured 500, same
  shape as the gen route.
- **muapi submit error / drift** → surfaced via the same path as generation; the
  hourly catalog-drift signal flags a drifted edit slug.
- **Out of credits (video edit)** → 402 with the same tier-aware message as video
  generation.

## 7. Testing (TDD, RED → GREEN)

- `edit-ops.test.ts` — instruction → op classification (keyword path + mocked
  LLM fallback). Pins the named failure: "no background + black outline" →
  `instruct_edit` with the full compound instruction preserved; "give me
  options" → `variations`; non-edit text → `null`.
- routing test — every `EditOp` resolves to a registered slug;
  `validateRoutingSlugs` covers the edit slugs; each `EditOpSpec.buildBody`
  produces the verified muapi body shape.
- edit-route test — #39 auth (401 on no session, identity from token not body);
  #38 video tier weight charged, image weight 0; `source_required` on missing
  `sourceUrl`; op routed; job created; inline result returned.
- `trigger-surfaces.test.ts` — the edit route is registered and gated.
- component test — the on-artifact edit bar renders within a media message; a
  3-up grid requires selecting one option before a grid refine; selecting/acting
  shows the `Editing your visual ↑` composer pill; a free-text refine WITH an
  active target hits the edit path; the SAME text with NO active target (pill
  dismissed) goes to the orchestrator; a "new image of X" cue forces fresh
  generation even with an active target.

## 8. Files touched

```
NEW  app/api/generation/edit/route.ts            the edit submit route (sibling of muapi route)
NEW  app/api/_lib/generation/edit-ops.ts         instruction → EditOp classifier + EditOpSpec.buildBody
EDIT app/api/_lib/generation/routing.ts          EDIT_MODELS band + edit slugs in allRoutingSlugs/validate
EDIT app/api/_lib/generation/trigger-surfaces.ts register the edit route as a gated trigger
EDIT lib/generation-client.ts                    runEdit() client driver (submit → poll), sibling of runGeneration
NEW  app/components/EditAffordances.tsx          on-artifact edit bar + 3-up grid selected-state + "Editing your visual ↑" composer pill
EDIT app/components/CommandCenter.tsx            active-artifact selection/state + composer pill + free-text refine detection
EDIT app/components/DepartmentRoom.tsx           same active-artifact selection + edit bar on its inline media
NEW  __tests__/generation/edit-ops.test.ts       + route, routing, trigger-surface, component tests
```

## 9. Out of scope (v1)

- Op-chaining / multi-step sequential edits (compound = single pass).
- Multi-shot stitch as a *product feature* (#2) — but its `video-combiner`
  submit plumbing is built here for reuse.
- Visual-style learning from edit signals (#5) — pairs with this work later;
  edit signals (kept / re-edited) are a future input to `getStyleBlock`.
