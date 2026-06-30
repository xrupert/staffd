# Direct-to-PocketBase Upload — Design

> Fixes the production bug confirmed 2026-06-24: a 9.4MB document upload failed
> with a generic "Something went wrong" error. Root cause: Vercel serverless
> functions enforce a hard ~4.5MB request-body cap at the platform level —
> before our route code, and before our own 25MB app-level check, ever run.
> See `docs/forensics/W95.7.3d-INV1-findings.md` (addendum) for the original
> diagnosis. Status: design, approved by SA.

## 1. Problem

`POST /api/upload/documents` and `POST /api/upload/image` both route the raw
file bytes through a Vercel serverless function before storing them in
PocketBase. Vercel's platform-level request-body cap (~4.5MB) sits below our
own intended limits (25MB/file for documents, 10MB for images) and is **not
configurable** via `next.config.js` or any route-level setting. A request over
that cap is rejected by the platform itself, before our route ever executes,
with a non-JSON response — which the client's `res.json()` then fails to
parse, collapsing into a generic, undiagnosable error (the exact symptom
reported tonight).

A stopgap (a client-side 4MB pre-flight gate, shipped in commit `83908a3`) is
already live — it turns the crash into an honest "too large" message. This
spec is the real fix: remove the cap entirely by never routing file bytes
through a Vercel function.

## 2. Key insight (de-risks the whole design)

The browser already holds a genuine PocketBase user session
(`pb.authStore.token`, via the PocketBase JS SDK already loaded everywhere —
`lib/pb.ts`), and this exact pattern — the browser writing a file directly to
PocketBase using its own session, no Vercel route in the file path — is
**already in production**: the Vault page's logo upload does
`pb.collection("businesses").update(vault.id, formData)` directly.

`documents` and `uploaded_assets` already carry `USER_OWNED_RULES`
(`create: "user = @request.auth.id"`, etc.) from existing convention — meaning
a customer's own PocketBase session can already legally create/write records
scoped to themselves. **No new token-issuance system is needed.** PocketBase's
row-level rules already provide the scoping guarantee a custom presigned-token
system would provide, with zero new code.

## 3. Decisions (SA-ratified 2026-06-24)

1. **Scope: both** `documents` and `uploaded_assets` (images). The image route
   hasn't shipped to production yet — fixing it now avoids ever hitting this
   bug there.
2. **Orphan handling: accepted as a rare edge case.** If the browser closes
   between the PocketBase write succeeding and the finalize call (documents
   only) completing, the file is stored but unprocessed (no extraction, no
   Vault decision). No reconciliation job built now; revisit only if this
   proves common in practice.

## 4. Architecture

### 4.1 Documents — direct write + lightweight finalize

The browser creates the **full** `documents` record — including the file —
directly against PocketBase in one `pb.collection("documents").create(formData)`
call per file (multi-file batches loop this client-side; the existing UI
already operates per-file). No Vercel route touches the file bytes.

The browser then calls **`POST /api/upload/documents/finalize`** with just the
new document id(s) — a tiny JSON payload (`{ documentIds: string[] }`), never
size-constrained regardless of how large the original file was. Finalize
performs exactly what today's single-shot route does *after* storage,
unchanged in substance:
- re-fetch the document row, **verify `doc.user === me.id`** (a new check —
  the old route didn't need it since it created the records itself; now the
  client created them, so finalize must confirm ownership before acting, per
  Standard #39's spirit — never trust a client-asserted relationship);
- determine `extraction_status` from the file extension;
- decode TXT/MD inline (`extraction_status: "extracted"`);
- enqueue the existing async `document_extraction_worker` task for PDF/DOCX
  (unchanged — same `workflow_tasks` row shape as today);
- record the Vault decision (`recordDecision`) and the upload-session summary
  (`recordUploadSession`) — unchanged, admin-token-mediated as today (these
  stay server/admin-only; the client never writes directly to `workflow_tasks`
  or the Vault).

### 4.2 Images (`uploaded_assets`) — direct write, no finalize at all

Simpler: there is no extraction or Vault step for an uploaded edit-source
image. The browser creates the full `uploaded_assets` record (with file)
directly against PocketBase and computes the public file URL client-side
immediately (`${pbUrl}/api/files/uploaded_assets/<id>/<filename>` — the same
construction the not-yet-shipped server route already used). **No finalize
call at all.** The existing `POST /api/upload/image` Vercel route's
file-handling becomes dead code and is removed before it ever ships; the
`uploadImage()` client helper is rewritten to call PocketBase directly instead
of that route.

### 4.3 Validation

Client-side pre-flight checks move from "~4MB" (the artificial Vercel
stopgap) to the actual intended limits: 25MB/file + 100MB/session for
documents, 10MB for images — matching the existing `MAX_DOC_BYTES` /
`MAX_SESSION_BYTES` / image `MAX_BYTES` constants. PocketBase enforces the
same limits at the field level (`maxSize`, `mimeTypes` — already configured on
both collections) as defense-in-depth: even if a client-side check is bypassed
or stale, PocketBase itself rejects an oversized or wrong-type file.

### 4.4 Failure handling

- PocketBase create fails (bad type, oversized per field constraint, network)
  → the client shows the same honest, brand-voiced message pattern already
  built tonight (commit `83908a3`), now attached to the new call site.
- Finalize fails after a successful PocketBase write (documents only — rare:
  network blip, not a crashed tab) → the file is already safely stored; the
  client retries finalize up to 2 times with a short backoff before surfacing
  a clear message. This is a strict improvement over today even in the worst
  case (today, total failure means nothing is stored at all).
- Finalize re-fetches the document and finds `doc.user !== me.id` (a
  document id that doesn't belong to the caller — should not occur in normal
  use, defends against a malformed/tampered request) → 403, no processing.

## 5. Data flow

```
DOCUMENTS:
  browser → pb.collection("documents").create(file + fields)  [direct to PB, no Vercel]
    → record exists, file stored, extraction_status unset
  browser → POST /api/upload/documents/finalize { documentIds }  [tiny JSON]
    → whoAmI auth, verify ownership per id
    → TXT/MD: decode inline, extraction_status="extracted"
    → PDF/DOCX: enqueue document_extraction_worker task (unchanged worker path)
    → recordDecision + recordUploadSession (unchanged)
    → client polls existing /api/documents/<id> for status (unchanged poll, already widened tonight)

IMAGES:
  browser → pb.collection("uploaded_assets").create(file + fields)  [direct to PB, no Vercel]
    → compute public url client-side from the returned record
    → done (no finalize)
```

## 6. Testing (TDD, RED → GREEN)

- `finalize` route test: 401 no session; 400 missing/empty `documentIds`; 403
  when a document doesn't belong to the caller; TXT/MD path sets
  `extracted` + decoded output; PDF/DOCX path enqueues the worker task
  (mocked); multi-id batch processes each independently and reports partial
  success/failure per id (one bad id shouldn't fail the whole batch).
- Client helper test (`uploadImage`, documents-equivalent): mocks the PB SDK
  `create` call — success returns the expected shape; a PB validation error
  (wrong mime/oversized) surfaces a friendly message; verifies NO Vercel
  `/api/upload/image` fetch occurs anymore for the image path.
- Upload page test (if a harness exists / is reasonable to add): selecting an
  oversized-for-our-limits-but-fine-for-Vercel-cap file (e.g. a 20MB PDF, under
  our 25MB limit but over the old 4.5MB Vercel cap) succeeds end-to-end against
  a mocked PB client — proves the cap is actually gone, not just relocated.

## 7. Files

```
NEW  apps/web/app/api/upload/documents/finalize/route.ts   POST { documentIds } → ownership check + existing post-storage logic
EDIT apps/web/app/dashboard/upload/page.tsx                 documents: direct pb.collection("documents").create per file + finalize call; raise client size limits to 25MB/100MB
EDIT apps/web/lib/generation-client.ts                      uploadImage(file): direct pb.collection("uploaded_assets").create, no /api/upload/image fetch; raise limit to 10MB
EDIT apps/web/app/api/upload/image/route.ts                 remove (file-handling no longer needed; route deleted or left as a documented no-op if anything external still references it — confirm during implementation)
DEPRECATE apps/web/app/api/upload/documents/route.ts        the old single-shot multipart route — superseded by direct-write + finalize; confirm nothing else calls it before removing
NEW  apps/web/__tests__/api/upload-documents-finalize.test.ts
EDIT apps/web/__tests__/api/upload-image-route.test.ts      update or retire to match the new direct-write client helper
```

## 8. Out of scope (this pass)

- Orphan reconciliation (accepted as rare edge case per §3.2).
- Contacts CSV upload — already small, not at risk, untouched.
- Any change to the extraction worker itself (already fixed tonight in
  `2e801ea`/`83908a3`) — finalize calls the same unchanged worker enqueue path.
