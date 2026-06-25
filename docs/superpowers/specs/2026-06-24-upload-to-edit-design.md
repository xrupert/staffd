# Upload-to-Edit, True Transparency & Download — Design

> Three related fixes triggered by a production session 2026-06-24: a user asked
> to "upload an image and edit it" / "remove the background of my image", hit a
> clarifying-loop dead-end, AND the logo STAFFD had generated earlier carried a
> **fake painted checkerboard** instead of true transparency, forcing the user
> to fix it themselves. Builds on `2026-06-24-edit-as-intent-refine-loop-design.md`.
> Status: design.

## 1. Problems

1. **No own-image entry point.** Edit-as-intent only operates on an *active
   artifact* with a `sourceUrl`, and only a STAFFD generation sets one. A user's
   own image has no upload affordance, so "remove the background of my image"
   falls through to the orchestrator → a generic clarifying loop.
2. **Fake transparency (the checkerboard bug).** The image enricher prompts the
   text-to-image model for a "transparent background" (`enricher-prompt.ts:18`).
   Text-to-image models output **flat RGB with no alpha channel** — they cannot
   create transparency, so they paint the gray/white **checkerboard** that image
   editors display behind transparent areas. The customer gets a *picture of*
   transparency, not transparency.
3. **Download inconsistency.** Download exists on some rendered media but not
   uniformly across uploaded / edited / grid-option images.

## 2. Approach

All three reuse infrastructure the edit-as-intent work already shipped — chiefly
the background-removal edit op (`remove_background` → `remove-background` /
`birefnet`), which is the ONLY way to produce a true-alpha PNG.

**Hosting (verified, not assumed):** brand logos render cross-origin from the
Railway PB host via `<img src="${pb}/api/files/<collection>/<id>/<file>">` with
**no token** (`DepartmentRoom.tsx:239`, `vault/page.tsx:81`) — that collection
is public-read, so muapi (a server) can fetch those URLs too. A public-read
`uploaded_assets` collection therefore yields muapi-fetchable URLs. No base64.
(The `documents` collection is token-protected — `handlers.ts:101` — NOT a model
for this.)

## 3. Decisions (SA-ratified 2026-06-24)

1. **Both surfaces** get the upload affordance: Command Center AND DepartmentRoom.
2. **Orchestrator nudge:** an "edit my existing image" request with no active
   artifact replies with an upload nudge instead of routing to a specialist.
3. **Public PB hosting:** new public-read `uploaded_assets` collection.
4. **Images only (v1):** PNG / JPG / WebP. No video upload-to-edit.
5. **True-transparency auto-pipeline:** a transparency-intent request generates
   on a SOLID removable background, then **automatically** runs background-removal
   and delivers a true-alpha PNG (no extra step, no checkerboard). The enricher
   fix (never prompt "transparent") is unconditional.
6. **Download everywhere:** a clear Download on every rendered image — uploaded,
   generated, edited, and each grid option.

## 4. Architecture

### 4.1 `uploaded_assets` PB collection (public-read files)

New collection created idempotently by an `app/api/setup/**` route (operator-run,
existing pattern). Fields: `user` (owner), `file` (file), `kind` (text "image"),
`created`. **File view rule must be public** (so the `/api/files/...` URL is
muapi-fetchable without a token — mirrors the business/logo collection). Rows are
user-scoped for listing; the file bytes are public (unguessable record id +
filename is the capability, same as generated/logo assets).

### 4.2 `POST /api/upload/image`

Multipart `file` (one image). `whoAmI` auth (#39). Validates mime/ext in
{png,jpg,jpeg,webp}, size ≤ 10 MB. Creates an `uploaded_assets` row, returns
`{ ok:true, url:"<pb>/api/files/uploaded_assets/<id>/<file>", kind:"image" }`.
Errors: 401, 400 `no_file`/`unsupported_type`, 413 `too_large`, 503/502.

### 4.3 Client helpers — `lib/generation-client.ts`

- `uploadImage(file): Promise<{ url?; error? }>` — POSTs the multipart form with
  the PB token; returns the public url or a friendly error.

### 4.4 Composer attach + active-artifact wiring (both surfaces)

A small **attach** (`📎`) button in each composer with a hidden
`<input type="file" accept="image/png,image/jpeg,image/webp">`. On select: guard
the busy ref, show the existing `GenerationProgress`, `uploadImage(file)` →
- **CommandCenter:** push inline `media` `{kind:"image",urls:[url]}` +
  `setActiveArtifact({kind:"image",sourceUrl:url})` → pill + edit bar appear.
- **DepartmentRoom:** `setImageUrl(url)` → renders with its `EditAffordances` bar.
No tier gate (image edits + upload are unmetered).

### 4.5 Orchestrator upload nudge (client intercept in `send()`)

In `CommandCenter.send()`, before the edit gate and routing: if there is **no
active artifact** AND the message matches *edit-an-image-I-already-have* (upload /
edit my image|photo|logo / remove the background / edit this picture) AND is NOT
a *generate* request (make/create/generate/design me a …) → reply with an
assistant message ("Upload your image with the 📎 button below, then tell me what
to change — e.g. 'remove the background'.") and return (no routing). Detection is
a pure helper (§4.8). Never fires when an artifact is active or for genuine
generation requests.

### 4.6 True-transparency pipeline (the checkerboard fix)

**(a) Enricher fix — unconditional, the root cause.** In `enricher-prompt.ts:18`,
replace "centered on a plain or transparent background" with a SOLID, cleanly-
removable background instruction and an explicit ban: e.g. "centered on a plain
**solid** background (clean, even, easily removable — e.g. plain white), crisp
edges. NEVER a transparent or checkerboard background." (Text-to-image paints a
checkerboard when told "transparent"; real transparency comes from step (c).)

**(b) Transparency-intent detection** — pure helper `wantsTransparency(text)`
(§4.8): logo / "transparent" / "no background" / "cut out"/"cutout" / "sticker" /
"die cut" / PNG-with-transparency cues. (A logo defaults to wanting transparency.)

**(c) Client auto-pipeline.** In the image generation flow (`generateImageOptions`
and the single-image generation path): after `runGeneration` returns the solid-bg
url, if `wantsTransparency(prompt)` then auto-run
`runEdit({kind:"image", sourceUrl:<generated url>, instruction:"remove the background"})`
→ true-alpha url → render THAT (per option for the 3-up grid). The generated
solid-bg image is the intermediate; only the alpha result is shown. Uses the
existing `remove_background` op (alpha-producing model). Background-removal is
cheap and unmetered, consistent with images.

### 4.7 Download consistency

Ensure a Download affordance on every rendered image: single generated, single
edited, single uploaded, and **each grid option** (restore the per-option
Download inside `EditAffordances`' grid cells, lost when the grid moved into the
component). Edited/uploaded single images already render through the media block
with Download; confirm and keep. A true-alpha result downloads as a real
transparent PNG (the file carries the alpha channel — no extra work once (4.6) is
in place).

### 4.8 Pure detection helpers — `app/api/_lib/generation/intent-cues.ts`

Client-safe, llm-free (imports nothing server-only): `wantsTransparency(text)`
and `detectUploadEditIntent(text)`. Co-located because both are small keyword
classifiers used by the client, mirroring the `edit-ops.ts` keyword pattern.

## 5. Data flow

```
UPLOAD:  attach image → POST /api/upload/image (auth #39, validate) → public PB url
   → CC: inline media + setActiveArtifact (pill)   DeptRoom: setImageUrl
   → "remove the background" (chip/text) → existing edit gate → runEdit(uploaded url)
   → muapi fetches public url → true-alpha PNG → renders + new active target

GENERATE (transparency-intent):  "make me a logo" → runGeneration (enricher: SOLID bg, no checkerboard)
   → solid-bg url → wantsTransparency? → auto runEdit(remove_background, solid-bg url)
   → true-alpha PNG rendered (per option)

NUDGE:  [no artifact + "edit my image" text] → upload nudge (no routing)
DOWNLOAD: every rendered image carries a Download → alpha result saves as a true transparent PNG
```

## 6. Error handling

- Non-image / oversize upload → 400/413 friendly message; nothing stored.
- Upload network failure → inline "Couldn't upload that image — try again."
- Auto bg-removal in the transparency pipeline fails → fall back to delivering
  the solid-bg generated image (better than nothing) with a note; the user can
  still click "Remove background". Never block the whole generation on the
  second step.
- muapi cannot fetch an uploaded url (public-URL misconfig) → the edit route
  surfaces a brand-voiced failure (vendor detail already scrubbed); operator
  validates muapi-can-fetch on first real run.
- `whoAmI` null → 401 (no anonymous uploads).

## 7. Testing (TDD, RED → GREEN)

- upload-route: 401 no session; 400 non-image / missing file; 413 oversize;
  success creates a row + returns a `/api/files/uploaded_assets/…` url (PB mocked).
- setup-route: `uploaded_assets` created idempotently with a **public** file rule.
- `intent-cues` (pure): `wantsTransparency` → true for "logo", "transparent",
  "no background", "cutout", "sticker"; false for "a sunset photo", "an invoice".
  `detectUploadEditIntent` → true for "remove the background of my image", "edit
  my photo", "i need to upload an image and edit it"; false for "make me a logo",
  "write an invoice".
- enricher: the IMAGE system prompt no longer contains "transparent background"
  and DOES forbid checkerboard/transparency-pattern backgrounds (assert on the
  built string).
- transparency auto-pipeline (client): a generation with `wantsTransparency` true
  triggers a follow-up bg-removal call on the generated url and renders the alpha
  result; with it false, no second call.
- component: selecting an image file calls `uploadImage` and sets active artifact
  (CC) / imageUrl (DeptRoom) + shows pill/edit bar; every rendered image (incl.
  grid options) exposes a Download.

## 8. Files

```
NEW  app/api/upload/image/route.ts             POST multipart → public uploaded_assets row → public url
EDIT app/api/setup/**                          idempotent uploaded_assets collection (public file rule)
EDIT app/api/_lib/generation/enricher-prompt.ts  solid removable bg, ban checkerboard (root-cause fix)
NEW  app/api/_lib/generation/intent-cues.ts    pure wantsTransparency + detectUploadEditIntent
EDIT lib/generation-client.ts                  uploadImage(file) helper
EDIT app/components/CommandCenter.tsx           attach button + upload→active artifact; send() nudge; transparency auto-pipeline in image gen; per-option Download
EDIT app/components/DepartmentRoom.tsx          attach button + upload→setImageUrl; transparency auto-pipeline in its image gen
EDIT app/components/EditAffordances.tsx         restore per-option Download in grid cells
NEW  __tests__/.../upload-image-route.test.ts
NEW  __tests__/.../intent-cues.test.ts
EDIT __tests__/.../enricher-prompt (no-checkerboard assertion) + setup (uploaded_assets rule)
```

## 9. Out of scope (v1)

- Video upload-to-edit (route is image-only); video transparency (n/a for video).
- Multi-file / drag-and-drop bulk upload.
- Promoting a kept upload into the Vault brand-asset library (later pass).
- Server-side job-chaining for the transparency pipeline — v1 chains client-side
  (generate → auto bg-removal) reusing runGeneration + runEdit; a server-side
  multi-step job is deferred (it pairs with the #3 stitch multi-step work).
