# Upload-to-Edit — Design

> Closes the gap surfaced in production 2026-06-24: a user asked to "upload an
> image and edit it" / "remove the background of my image" and hit a dead-end —
> the orchestrator routed it to a specialist that asked redundant clarifying
> questions, because there is no way to upload an image and no edit target. The
> shipped edit-as-intent loop only works on STAFFD-*generated* artifacts.
> Builds on `2026-06-24-edit-as-intent-refine-loop-design.md`. Status: design.

## 1. Problem

Edit-as-intent only operates on an **active artifact** that carries a
`sourceUrl` — and the only thing that sets one today is a STAFFD generation. A
user's own image (a logo, a photo) has no entry point: there's no upload
affordance in the Command Center, and "remove the background of my image" with
no active artifact falls through to the orchestrator → a generic clarifying
loop (the screenshot dead-end).

## 2. Approach

The downstream edit machinery already exists and is live. The entire fix is:
**(a) get an uploaded image to a muapi-fetchable URL, (b) mark it the active
artifact.** Then the existing edit bar / free-text gate / `runEdit` / muapi
edit endpoints handle "remove the background" unchanged.

**Hosting — why public PocketBase works (verified, not assumed):** brand logos
already render cross-origin from the Railway PB host via
`<img src="${pb}/api/files/<collection>/<id>/<file>">` with **no token**
(`DepartmentRoom.tsx:239`, `vault/page.tsx:81`). Cross-origin `<img>` sends no
PB auth, so that collection is **public-read** — which means muapi (a server)
can fetch those URLs too. A similarly public `uploaded_assets` collection
therefore yields muapi-fetchable URLs. No base64, no new storage vendor.
(Contrast: the `documents` collection is token-protected — `handlers.ts:101` —
so it is NOT a model for this.)

## 3. Decisions (SA-ratified 2026-06-24)

1. **Both surfaces:** Command Center AND DepartmentRoom get the attach
   affordance + active-artifact wiring.
2. **Orchestrator nudge:** an "edit my existing image" request with no active
   artifact replies with an upload nudge instead of routing to a specialist.
3. **Public PB hosting:** a new public-read `uploaded_assets` collection; the
   route returns the public `/api/files/...` URL.
4. **Images only (v1):** PNG / JPG / WebP. Video upload-to-edit is out of scope.

## 4. Architecture

### 4.1 `uploaded_assets` PB collection (public-read files)

A new collection created idempotently by an `app/api/setup/**` route (operator-
run, same pattern as existing setup). Fields: `user` (relation/text, owner),
`file` (file), `kind` (text, "image"), `created`. **View rule on files must be
public** (empty/public view rule) so the `/api/files/...` URL is fetchable by
muapi without a token — mirroring the business/logo collection. Rows are
user-scoped for listing, but the file bytes are public (an unguessable PB record
id + filename is the capability, same as generated/logo assets today).

### 4.2 `POST /api/upload/image`

Multipart `file` (one image). `whoAmI` auth (Standard #39 — identity from token,
never a body userId). Validates: extension/mime in {png, jpg, jpeg, webp},
size ≤ 10 MB. Creates an `uploaded_assets` row (multipart, binary in `file`),
then returns:
```
{ ok: true, url: "<pbUrl>/api/files/uploaded_assets/<id>/<filename>", kind: "image" }
```
Errors: 401 unauthorized, 400 `no_file` / `unsupported_type`, 413 `too_large`,
503 `pb_unconfigured`, 502 `save_failed`.

### 4.3 Client upload helper — `lib/generation-client.ts` `uploadImage`

```
uploadImage(file: File): Promise<{ url?: string; error?: string }>
```
POSTs the multipart form to `/api/upload/image` with the PB auth token; returns
the public url or a friendly error. Sits beside `runGeneration`/`runEdit` (the
media client surface).

### 4.4 Composer attach button + active-artifact wiring (both surfaces)

A small **attach** button (`📎`) in each composer, with a hidden
`<input type="file" accept="image/png,image/jpeg,image/webp">`. On select:
- guard the existing busy ref; show the existing `GenerationProgress` while
  uploading;
- `uploadImage(file)` → on `url`:
  - **CommandCenter:** push an inline `media` message `{ kind:"image", urls:[url] }`
    and `setActiveArtifact({ kind:"image", sourceUrl:url })` → the "Editing your
    visual ↑" pill shows; the edit bar renders under the image; the user clicks
    a chip or types "remove the background".
  - **DepartmentRoom:** `setImageUrl(url)` (its single-slot model) so the image
    renders with its `EditAffordances` bar (the chip path from the edit-as-intent
    work applies).
  - on error: a friendly inline message.

No tier gate — image edits are unmetered, and the upload itself is free.

### 4.5 Orchestrator upload nudge (client intercept in `send()`)

In `CommandCenter.send()`, BEFORE the edit gate and orchestrator routing: if
there is **no active artifact** AND the message expresses *editing an image the
user already has* (e.g. matches an "upload / edit my image|photo|logo / remove
the background / edit this picture" pattern) AND is NOT a *generate* request
(make/create/generate/design me a …), then short-circuit with an assistant
message:
> "Upload your image with the 📎 button below, then tell me what to change —
> e.g. 'remove the background'."
…and return (no routing). This closes the screenshot dead-end. The detection is
a small keyword/regex helper (pure, testable) — no LLM call. When an artifact IS
active, this never fires (the edit gate handles it); when it's a genuine
generation request, it never fires (falls through to normal routing).

## 5. Data flow

```
attach image → POST /api/upload/image (auth #39, validate) → public PB url
  → CommandCenter: inline media message + setActiveArtifact (pill shows)
     DepartmentRoom: setImageUrl (renders with edit bar)
  → "remove the background" (chip or text) → EXISTING edit gate → runEdit(sourceUrl = uploaded url)
  → muapi fetches the public url → edited PNG renders → becomes new active target (loop)

[no artifact + "edit my image" text] → upload nudge (no routing)
```

## 6. Error handling

- Non-image / oversize → 400/413 with a friendly message; nothing stored.
- Upload network failure → inline "Couldn't upload that image — try again."
- A muapi edit on an uploaded url that muapi cannot fetch (public-URL
  misconfig) → the edit route surfaces a brand-voiced failure (already scrubbed
  of vendor detail); the operator validates muapi-can-fetch on first real run.
- `whoAmI` null → 401 (no anonymous uploads).

## 7. Testing (TDD, RED → GREEN)

- upload-route test: 401 no session; 400 on non-image and missing file; 413
  oversize; success path creates a row and returns a `/api/files/uploaded_assets/…`
  url (PB create mocked).
- setup-route test: `uploaded_assets` collection created idempotently with a
  **public** file view rule.
- nudge-helper test (pure): "remove the background of my image" / "edit my
  photo" / "i need to upload an image and edit it" → nudge; "make me a logo" /
  "write an invoice" → no nudge; (with active artifact present, caller skips it).
- component test: selecting an image file calls `uploadImage`, and on success
  sets the active artifact (CommandCenter) / imageUrl (DepartmentRoom) and shows
  the pill/edit bar.

## 8. Files

```
NEW  app/api/upload/image/route.ts            POST multipart → public uploaded_assets row → public url
EDIT app/api/setup/**                         idempotent uploaded_assets collection (public file rule)
EDIT lib/generation-client.ts                 uploadImage(file) helper
NEW  app/api/_lib/generation/upload-intent.ts pure detectUploadEditIntent(text) for the nudge
EDIT app/components/CommandCenter.tsx          attach button + upload → active artifact; send() upload nudge
EDIT app/components/DepartmentRoom.tsx         attach button + upload → setImageUrl
NEW  __tests__/.../upload-image-route.test.ts
NEW  __tests__/.../upload-intent.test.ts
EDIT __tests__/.../setup … (uploaded_assets public rule)
```

## 9. Out of scope (v1)

- Video upload-to-edit (the upload route is image-only; a later tranche adds
  video once video edit-as-intent UX is proven).
- Multi-file / drag-and-drop bulk upload.
- Re-using uploads as a brand-asset library (the Vault already owns logo/brand
  assets; this is a transient edit source, though a later pass could promote a
  kept upload into the Vault).
