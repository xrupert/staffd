# Filename-as-Identity + Duplicate-Name Check — Design

> Answers a real gap surfaced 2026-06-24: uploading the same document twice
> silently creates two separate records (no uniqueness anywhere in the
> schema, no dedup check anywhere in the flow, confirmed by direct code
> inspection). SA's ratified answer: the file's own name IS its identity —
> no separate naming step — and re-using a name should ask before uploading,
> not silently duplicate or silently block. Applies uniformly to documents
> AND images (images currently have no name field at all). Status: approved
> by SA, ready to build.

## 1. Problem

- `documents`: every upload creates a brand-new record unconditionally. No
  uniqueness constraint in the schema, no pre-flight check anywhere in the
  client or the `finalize` route (verified by direct grep tonight).
- `uploaded_assets` (images, from the still-unmerged
  `feat/upload-to-edit-and-transparency` branch): has **no name field at
  all** — just `user`, `kind`, `file`. There is also **no browsing view**
  anywhere in the app for uploaded images (`/dashboard/library` only reads
  `documents`).

## 2. Decisions (SA-ratified 2026-06-24)

1. **The filename IS the identity.** No separate "name your upload" step for
   either documents or images — the name is always `file.name`, exactly as
   selected from the user's device. (This is already how `documents.prompt`
   works today; `uploaded_assets` gets an equivalent `name` field.)
2. **Duplicate check = same name (case-insensitive), scoped to that user.**
   Not content-hashing — simpler, and matches how the SA actually thinks
   about "the same file" (by what it's called, not its bytes).
3. **On a match: ask before uploading, don't upload-then-notify.** A confirm
   dialog appears BEFORE any create call — "You already have a file named
   'X' — upload anyway?" — Continue / Cancel. Nothing is written until the
   user decides.
4. **Batch-aware, per-file independent.** In a multi-file selection, a
   collision on one file does not block the others — non-colliding files
   proceed immediately with no dialog. If multiple files in the same batch
   collide, ONE dialog lists all of them together (not N sequential
   pop-ups). Continue re-attempts create for the confirmed files only;
   Cancel drops just those from the batch.
5. **Images get named** (a real, independent gap — needed regardless of
   dedup) **and get a minimal browsing view**, folded into the existing
   `/dashboard/library` page as a second content type (a Documents/Images
   filter, reusing the search/filter UI already there) rather than a new
   page.
6. **Branch reality:** the images side of this work lands on the still-
   unmerged `feat/upload-to-edit-and-transparency` branch (where
   `uploaded_assets`/the upload route/`uploadImage()` already live) — not on
   `main`. It is fully built and tested there, but is NOT independently
   deployable until that whole feature (still mid-flight — the
   CommandCenter/DepartmentRoom attach-button wiring from earlier tonight
   isn't built yet) is finished and merged. The documents side ships to
   `main`/production tonight; the images side does not, and that's reported
   plainly, not silently glossed over.

## 3. Architecture

### 3.1 Documents (on `main` — ships tonight)

No schema change (`documents.prompt` already IS `file.name`). PocketBase's
`~` filter operator is a case-insensitive **contains** match (SQLite `LIKE`
semantics) — NOT an exact match, so `prompt ~ "invoice.pdf"` would
false-positive against `"old_invoice.pdf"`. Instead: before create, fetch
the user's existing document names ONCE per submit
(`pb.collection("documents").getList(1, 500, { filter: 'user = "${userId}"', fields: "prompt" })`
— realistic per-user counts are in the hundreds, not a scale concern), then
compare each selected file's name against that list client-side with exact
case-insensitive equality (`existing.toLowerCase() === selected.toLowerCase()`).

Files with a match are set aside (not created yet); files with no match
proceed to create immediately, exactly as today. If any files were set
aside, ONE confirm dialog lists them: "You already have: 'X', 'Y' — upload
these again?" Confirm → those files proceed to create (existing flow, now
with `clientErrors`/`createdIds`/`finalize` unchanged downstream). Cancel →
those files are dropped from the batch (excluded from `createdIds`,
reflected in the result as skipped, not an error).

### 3.2 Images (on `feat/upload-to-edit-and-transparency`)

- Add `name` (text) field to `uploaded_assets` via the existing idempotent
  setup-route pattern (same as every other collection change tonight).
- `uploadImage(file)` in `lib/generation-client.ts` sets `name: file.name` on
  create, and exposes a duplicate check using the SAME exact-match-via-
  fetched-list mechanism as documents (§3.1) — the caller, not `uploadImage`
  itself, owns the confirm dialog; `uploadImage` (or a small sibling helper)
  exposes the check as a primitive both surfaces can call.
- **New minimal browsing view:** extend `/dashboard/library/page.tsx` with a
  content-type filter (Documents / Images) alongside its existing
  department filter chips. The Images view reads `uploaded_assets`
  (`user`-scoped, same as documents today), shows a simple thumbnail grid
  (name + image), with delete (mirrors the existing document delete
  affordance). No edit-as-intent wiring here — that's the separate,
  already-scoped B4–C3 work on the same branch.

## 4. Data flow

```
DOCUMENTS (main):
  select files → for each: query documents for user+name match
    no match  → create immediately (existing flow, unchanged downstream)
    match     → set aside
  if any set aside → ONE confirm dialog listing them
    Continue → those proceed to create
    Cancel   → those are dropped, reported as skipped
  → existing finalize call with all successfully-created ids (unchanged)

IMAGES (feat/upload-to-edit-and-transparency):
  select image → query uploaded_assets for user+name match
    no match → create directly (name: file.name) → public url
    match    → confirm dialog → Continue creates, Cancel aborts that upload
  (separately, already-scoped B4 work wires this into the CC/DeptRoom attach flow)

LIBRARY (feat/upload-to-edit-and-transparency):
  /dashboard/library gains a Documents/Images filter; Images reads
  uploaded_assets, shows name + thumbnail + delete
```

## 5. Error handling

- The pre-flight PocketBase query itself failing (network) → fail OPEN, not
  closed: proceed to create as if no duplicate was found, rather than
  blocking the upload on a dedup-check outage. Duplicate detection is a
  courtesy, not a security boundary — never let it become a new way uploads
  can fail.
- Cancelling a duplicate confirms doesn't error — those files are simply
  excluded from the batch, reflected honestly in the result summary (e.g.
  "2 of 3 uploaded, 1 skipped").

## 6. Testing (TDD, RED → GREEN)

- Documents: a pure `hasNameCollision`-style check function (query-shape
  testable via a mocked `pb.collection`), a client integration test-by-
  reasoning (no harness exists for this page, consistent with tonight's
  precedent — verified by tsc + the full suite as established all night).
- Images (on the feature branch): the `uploaded_assets` setup route's `name`
  field addition (mirrors the pattern already tested for the collection's
  other fields), `uploadImage()`'s duplicate-check + `name` population
  (extends the existing `uploadImage` test file), and the new library
  filter/Images view (a lightweight component test if the effort is small,
  otherwise tsc + full-suite as the gate, consistent with tonight's
  precedent for this exact page).

## 7. Files

```
DOCUMENTS (branch off main):
NEW  apps/web/lib/upload-name-check.ts                  client helper: fetch a user's existing names from a collection, exact-match check (testable in isolation)
EDIT apps/web/app/dashboard/upload/page.tsx             DocumentsCard: pre-flight check + confirm dialog + set-aside/proceed split

IMAGES (feat/upload-to-edit-and-transparency):
EDIT apps/web/app/api/setup/uploaded-assets/route.ts    add `name` field
EDIT apps/web/lib/generation-client.ts                  uploadImage(): name population + duplicate check (same mechanism as lib/upload-name-check.ts, reimplemented locally on this branch — see note below)
EDIT apps/web/app/dashboard/library/page.tsx             Documents/Images filter + minimal image grid + delete
```

Note: `lib/upload-name-check.ts` is built fresh on the documents branch and
does not yet exist on `feat/upload-to-edit-and-transparency` (an unrelated,
unmerged branch). Rather than force a shared file across two branches that
aren't merged into each other, the images side reimplements the same small,
simple mechanism locally. This is deliberate, accepted duplication (same
class of call already made tonight for the file-token-fetch logic shared
between the extraction worker and the `finalize` route) — worth
consolidating in a future cleanup once both branches are merged, not before.

## 8. Out of scope

- Content-hash-based dedup (explicitly rejected — name-based per SA
  decision).
- Renaming an existing upload after the fact (not asked for; the name is
  fixed at upload time to whatever the file was called).
- Finishing the rest of the paused edit-as-intent-images feature (B4–C3) —
  unrelated to this spec, not touched here.
