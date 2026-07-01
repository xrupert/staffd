# Filename-as-Identity + Duplicate-Name Check Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Uploading a document/image is identified by its own filename (no separate naming step), and re-using a name asks before uploading instead of silently duplicating or silently blocking — applied consistently to documents (ships to `main` tonight) and images (lands on the still-unmerged `feat/upload-to-edit-and-transparency` branch, where `uploaded_assets` already lives).

**Architecture:** Before any create call, the client fetches the user's existing names for that collection (a lightweight list query — realistic per-user counts are hundreds, not a scale concern) and does an exact, case-insensitive comparison client-side — NOT PocketBase's `~` operator, which is a contains-match and would false-positive. On a match, ONE confirm dialog lists the colliding names before anything uploads; non-colliding files in the same batch proceed immediately. Images additionally get a `name` field (currently absent) and a minimal browsing view folded into the existing Library page.

**Tech Stack:** TypeScript, Next.js App Router, PocketBase JS SDK, vitest.

**Spec:** `docs/superpowers/specs/2026-06-24-filename-identity-duplicate-check-design.md`

**The gate (from `apps/web`):** `npx tsc --noEmit` (0) · `npx vitest run` (green) · `npx next build` at tranche boundaries. Commit footer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## TRANCHE A — Documents (branch off `main`, ships to production tonight)

### Task A1: `lib/upload-name-check.ts` — the exact-match check primitive

**Files:**
- Create: `apps/web/lib/upload-name-check.ts`
- Test: `apps/web/__tests__/lib/upload-name-check.test.ts`

A small, collection-agnostic client helper: given a PocketBase collection name, a user id, and a name-bearing field, fetch that user's existing values for that field and return the ones (case-insensitively) matching any name in a candidate list.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/lib/upload-name-check.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getList = vi.fn();
vi.mock("../../lib/pb", () => ({ default: { collection: () => ({ getList }) } }));

import { findCollidingNames } from "../../lib/upload-name-check";

beforeEach(() => getList.mockReset());

describe("findCollidingNames", () => {
  it("returns the candidate names that already exist for the user (case-insensitive, exact match)", async () => {
    getList.mockResolvedValue({ items: [{ prompt: "Invoice.pdf" }, { prompt: "notes.txt" }] });
    const result = await findCollidingNames("documents", "u1", "prompt", ["invoice.pdf", "new-file.pdf", "NOTES.TXT"]);
    expect(result.sort()).toEqual(["invoice.pdf", "NOTES.TXT"].sort());
  });

  it("does NOT false-positive on a substring (unlike a contains-match)", async () => {
    getList.mockResolvedValue({ items: [{ prompt: "old_invoice.pdf" }] });
    const result = await findCollidingNames("documents", "u1", "prompt", ["invoice.pdf"]);
    expect(result).toEqual([]);
  });

  it("returns empty when there are no candidates or no existing names", async () => {
    getList.mockResolvedValue({ items: [] });
    expect(await findCollidingNames("documents", "u1", "prompt", ["a.pdf"])).toEqual([]);
    expect(await findCollidingNames("documents", "u1", "prompt", [])).toEqual([]);
  });

  it("fails OPEN — a query error returns no collisions rather than throwing", async () => {
    getList.mockRejectedValue(new Error("network"));
    const result = await findCollidingNames("documents", "u1", "prompt", ["a.pdf"]);
    expect(result).toEqual([]);
  });

  it("queries with the user filter and a generous page size", async () => {
    getList.mockResolvedValue({ items: [] });
    await findCollidingNames("documents", "u1", "prompt", ["a.pdf"]);
    expect(getList).toHaveBeenCalledWith(1, 500, expect.objectContaining({ filter: expect.stringContaining("u1") }));
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd /c/Users/xrupe/staffd/apps/web && npx vitest run __tests__/lib/upload-name-check.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/lib/upload-name-check.ts
import pb from "./pb";

/**
 * Duplicate-name check (filename-as-identity, W: naming/dedup 2026-06-24).
 * PocketBase's `~` filter is a case-insensitive CONTAINS match (SQLite LIKE
 * semantics) — NOT exact, so `prompt ~ "invoice.pdf"` would false-positive
 * against "old_invoice.pdf". Instead: fetch the user's existing names for a
 * collection ONCE, then compare candidates client-side with exact
 * case-insensitive equality. Fails OPEN on any query error — duplicate
 * detection is a courtesy, never a new way an upload can fail.
 */
export async function findCollidingNames(
  collection: string,
  userId: string,
  nameField: string,
  candidates: string[],
): Promise<string[]> {
  if (candidates.length === 0) return [];
  try {
    const res = await pb.collection(collection).getList(1, 500, {
      filter: `user = "${userId}"`,
      fields: nameField,
    }) as { items: Record<string, unknown>[] };
    const existing = new Set(
      res.items.map((item) => String(item[nameField] ?? "").toLowerCase()).filter(Boolean),
    );
    return candidates.filter((c) => existing.has(c.toLowerCase()));
  } catch {
    return [];
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/lib/upload-name-check.test.ts`
Expected: ALL 5 cases PASS. Confirm case #2 specifically proves the exact-match behavior (no false positive on `old_invoice.pdf`).

- [ ] **Step 5: `npx tsc --noEmit`** (exit 0), then commit:

```bash
git add apps/web/lib/upload-name-check.ts apps/web/__tests__/lib/upload-name-check.test.ts
git commit -m "feat(upload): findCollidingNames — exact-match duplicate-name check (fails open)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A2: Wire the duplicate check + confirm dialog into `DocumentsCard.submit()`

**Files:**
- Modify: `apps/web/app/dashboard/upload/page.tsx`

Read the file first — `DocumentsCard` currently has `submit()` doing: per-file extension validation → `pb.collection("documents").create(fd)` directly → collect `createdIds` (with `row`) → call `/api/upload/documents/finalize` → merge errors → update `statuses`/`pollDoc`. This task inserts a pre-flight duplicate check BEFORE the create loop, splitting files into "proceed immediately" and "set aside pending confirmation."

- [ ] **Step 1: Read the current file fully** to confirm the exact current `submit()` body, the `DocumentsCard` component's existing `useState` declarations, and the JSX render (so the new confirm dialog fits the existing visual style — dark cards, `#111118`/`#2A2A38`/`#A07BFF` palette, consistent with every other dialog/warning in this file).

- [ ] **Step 2: Add the import + a confirmation-state hook** near `DocumentsCard`'s other `useState` declarations:

```tsx
import { findCollidingNames } from "../../../lib/upload-name-check";
```
```tsx
  // W: naming/dedup 2026-06-24 — files awaiting a duplicate-name confirmation,
  // and a resolver so submit() can pause/resume around the confirm dialog.
  const [pendingDupes, setPendingDupes] = useState<{ files: File[]; resolve: (proceed: boolean) => void } | null>(null);
```

- [ ] **Step 3: Add a helper that asks for confirmation and returns a promise**, near `submit`:

```tsx
  function confirmDuplicates(files: File[]): Promise<boolean> {
    return new Promise((resolve) => setPendingDupes({ files, resolve }));
  }
```

- [ ] **Step 4: Insert the pre-flight check at the START of `submit()`**, before the existing create loop. Read the CURRENT `submit()` body carefully (it begins `if (files.length === 0 || tooLargeToSend) return; setBusy(true); ...`) and insert this block immediately after the `setBusy`/`setResult`/`setStatuses` reset lines, BEFORE the existing `for (const file of files)` create loop:

```tsx
    const userId = pb.authStore.record?.id ?? "";
    const candidateNames = files.map((f) => f.name);
    const colliding = await findCollidingNames("documents", userId, "prompt", candidateNames);
    let filesToUpload = files;
    if (colliding.length > 0) {
      const collidingSet = new Set(colliding.map((n) => n.toLowerCase()));
      const dupeFiles = files.filter((f) => collidingSet.has(f.name.toLowerCase()));
      const proceed = await confirmDuplicates(dupeFiles);
      filesToUpload = proceed ? files : files.filter((f) => !collidingSet.has(f.name.toLowerCase()));
      if (filesToUpload.length === 0) {
        setResult({ ok: true, total: files.length, succeeded: 0, failed: 0, errors: [], documents: [] });
        setBusy(false);
        return;
      }
    }
```

Then change the existing create loop from `for (const file of files)` to `for (const file of filesToUpload)` — this is the ONLY change to the existing loop; everything inside it (extension validation, `pb.collection("documents").create(fd)`, `createdIds.push`, `clientErrors.push`) stays exactly as-is.

- [ ] **Step 5: Render the confirm dialog.** Add near the end of `DocumentsCard`'s JSX (as a sibling to the existing `<ResultBanner>`, so it overlays regardless of scroll position — follow whatever modal/overlay pattern already exists elsewhere in this codebase if `DocumentsCard` doesn't have one; otherwise use this self-contained inline version matching the file's existing dark palette):

```tsx
      {pendingDupes && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="rounded-2xl p-6 max-w-sm mx-4" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
            <p className="text-sm font-medium mb-2" style={{ color: "#F0F0F8" }}>
              You already have {pendingDupes.files.length === 1 ? "a file named" : "files named"}:
            </p>
            <ul className="text-xs mb-4" style={{ color: "#9090A8" }}>
              {pendingDupes.files.map((f, i) => <li key={i}>• {f.name}</li>)}
            </ul>
            <p className="text-xs mb-4" style={{ color: "#5A5A70" }}>Upload {pendingDupes.files.length === 1 ? "it" : "them"} again anyway?</p>
            <div className="flex gap-2">
              <button
                onClick={() => { pendingDupes.resolve(true); setPendingDupes(null); }}
                className="text-sm px-4 py-2 rounded-xl btn-primary text-white font-semibold"
              >
                Upload anyway
              </button>
              <button
                onClick={() => { pendingDupes.resolve(false); setPendingDupes(null); }}
                className="text-sm px-4 py-2 rounded-xl"
                style={{ background: "transparent", border: "1px solid #2A2A38", color: "#7070A0" }}
              >
                Skip {pendingDupes.files.length === 1 ? "it" : "them"}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: `npx tsc --noEmit`** — fix any type errors by reading the real existing types (`UploadResult`, `DocStatus`) rather than changing them. Then `npx vitest run` (full suite) — confirm green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/dashboard/upload/page.tsx
git commit -m "feat(upload): ask before re-uploading a document with a name already in use

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 8: Tranche A gate**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully".

---

## TRANCHE B — Images (on `feat/upload-to-edit-and-transparency` — built + tested, NOT independently deployable tonight)

> Before starting: `git checkout feat/upload-to-edit-and-transparency` (this branch already has the `uploaded_assets` collection, `/api/setup/uploaded-assets`, and `uploadImage()` from earlier work). Confirm you are on THIS branch, not `main`, before touching these files — `uploaded_assets` does not exist on `main`.

### Task B1: Add `name` field to `uploaded_assets`

**Files:**
- Modify (on the feature branch): `apps/web/app/api/setup/uploaded-assets/route.ts`

- [ ] **Step 1: Read the current `FIELDS` array** in this file (it currently has `user`, `kind`, `file` — no name field).

- [ ] **Step 2: Add the field**

```ts
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "kind", type: "text", required: false }, // "image"
  { name: "name", type: "text", required: false },  // W: naming/dedup 2026-06-24 — file.name, the display identity
  { name: "file", type: "file", required: false, maxSelect: 1, maxSize: MAX_BYTES, mimeTypes: MIME, protected: false },
];
```
(Insert `name` before `file` — `ensureBaseCollection` diffs against existing fields and adds only what's missing, so this is a safe additive migration, same pattern as every other collection change this week.)

- [ ] **Step 3: `npx tsc --noEmit`** (exit 0). No test exists for this specific setup route beyond what's already there — if a row-rules/migration-registry test enumerates `uploaded_assets`'s fields explicitly, run it and update ONLY if it asserts exact field lists (do not weaken any assertion). Otherwise this is a schema-only change verified by tsc + the collection actually getting the field when `/api/setup/uploaded-assets` is next run in an environment with PB configured.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/api/setup/uploaded-assets/route.ts
git commit -m "feat(upload): uploaded_assets gets a name field (filename-as-identity)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task B2: `uploadImage()` — name population + duplicate check

**Files:**
- Modify (on the feature branch): `apps/web/lib/generation-client.ts`
- Test: `apps/web/__tests__/lib/upload-image-dedup.test.ts`

Read the current `uploadImage()` on this branch first (it creates directly against `pb.collection("uploaded_assets")`, per last night's work — confirm the exact current body before editing). This task adds `name: file.name` to the create call, and exports a small duplicate-check helper the caller uses BEFORE calling `uploadImage` (mirroring Task A1's pattern — collection-agnostic where possible, but this branch does not have `lib/upload-name-check.ts` from Tranche A since the two branches are unmerged; reimplement the same small mechanism locally here per the spec's accepted-duplication note).

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/lib/upload-image-dedup.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const getList = vi.fn();
const create = vi.fn();
vi.mock("../../lib/pb", () => ({
  default: { authStore: { record: { id: "u1" } }, baseURL: "http://pb", collection: () => ({ getList, create }) },
}));

import { findCollidingImageNames, uploadImage } from "../../lib/generation-client";

beforeEach(() => { getList.mockReset(); create.mockReset(); });

function img(name: string, type = "image/png", bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("findCollidingImageNames", () => {
  it("exact match, case-insensitive, fails open on error", async () => {
    getList.mockResolvedValue({ items: [{ name: "Logo.png" }] });
    expect(await findCollidingImageNames("u1", ["logo.png", "new.png"])).toEqual(["logo.png"]);
    getList.mockRejectedValue(new Error("x"));
    expect(await findCollidingImageNames("u1", ["a.png"])).toEqual([]);
  });
});

describe("uploadImage — includes name on create", () => {
  it("sets name from file.name on the created record", async () => {
    getList.mockResolvedValue({ items: [] });
    create.mockResolvedValue({ id: "rec1", file: "iris_abc.png" });
    const r = await uploadImage(img("iris.png"));
    expect(r.url).toBe("http://pb/api/files/uploaded_assets/rec1/iris_abc.png");
    const fd = create.mock.calls[0][0] as FormData;
    expect(fd.get("name")).toBe("iris.png");
  });
});
```

- [ ] **Step 2: Run, verify FAIL** (`findCollidingImageNames` doesn't exist yet).

- [ ] **Step 3: Read `uploadImage()`'s current body on this branch**, then add BOTH `findCollidingImageNames` and the `name` field. Add near the top of `generation-client.ts` (or immediately above `uploadImage`):

```ts
/** Duplicate-name check for uploaded_assets, same mechanism/rationale as
 * lib/upload-name-check.ts on the documents branch (unmerged — reimplemented
 * here per spec §7's accepted-duplication note). */
export async function findCollidingImageNames(userId: string, candidates: string[]): Promise<string[]> {
  if (candidates.length === 0) return [];
  try {
    const res = await pb.collection("uploaded_assets").getList(1, 500, {
      filter: `user = "${userId}"`,
      fields: "name",
    }) as { items: Record<string, unknown>[] };
    const existing = new Set(res.items.map((i) => String(i.name ?? "").toLowerCase()).filter(Boolean));
    return candidates.filter((c) => existing.has(c.toLowerCase()));
  } catch {
    return [];
  }
}
```

Then in `uploadImage()`, add `fd.append("name", file.name);` to the `FormData` construction (alongside the existing `user`/`kind`/`file` appends — read the exact current lines to place this correctly).

- [ ] **Step 4: Run, verify PASS.** `npx tsc --noEmit`. Commit:

```bash
git add apps/web/lib/generation-client.ts apps/web/__tests__/lib/upload-image-dedup.test.ts
git commit -m "feat(upload): uploadImage sets name + exposes findCollidingImageNames

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

> Note: wiring `findCollidingImageNames` into an actual confirm-dialog UI at the attach-button call site is part of the already-scoped, not-yet-built B4 task (CommandCenter attach button) on this same branch — this task only builds and tests the primitive, consistent with how B1–B3 shipped the upload mechanism before B4 wires the UI.

---

### Task B3: Minimal image browsing view in the Library page

**Files:**
- Modify (on the feature branch): `apps/web/app/dashboard/library/page.tsx`

Add a Documents/Images content-type toggle above the existing department filter chips. Images mode reads `uploaded_assets` (user-scoped) and renders a simple thumbnail grid with delete — no edit-as-intent wiring (that's separate, already-scoped work).

- [ ] **Step 1: Read the current file fully** (already done during planning — `LibraryPage` holds `docs`/`filter`/`search`/`expanded`/`deleting` state, loads via `loadDocs()`, renders a department-filtered list).

- [ ] **Step 2: Add image state + loader**, near the existing `docs`/`loading` state:

```tsx
  const [contentType, setContentType] = useState<"documents" | "images">("documents");
  const [images, setImages] = useState<{ id: string; name: string; url: string }[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [deletingImage, setDeletingImage] = useState<string | null>(null);
```

Add a loader function near `loadDocs`:

```tsx
  async function loadImages() {
    setImagesLoading(true);
    try {
      const userId = pb.authStore.record?.id ?? "";
      const res = await pb.collection("uploaded_assets").getList(1, 200, { filter: `user = '${userId}'`, sort: "-created" });
      const items = (res.items as unknown as { id: string; name?: string; file: string; collectionId: string }[]).map((r) => ({
        id: r.id,
        name: r.name || r.file,
        url: `${pb.baseURL}/api/files/uploaded_assets/${r.id}/${encodeURIComponent(r.file)}`,
      }));
      setImages(items);
    } catch {
      setImages([]);
    } finally {
      setImagesLoading(false);
    }
  }

  async function deleteImage(id: string) {
    setDeletingImage(id);
    try {
      await pb.collection("uploaded_assets").delete(id);
      setImages((prev) => prev.filter((i) => i.id !== id));
    } catch { /* ignore */ } finally {
      setDeletingImage(null);
    }
  }
```

- [ ] **Step 3: Load images when the toggle switches to "images"** — extend the existing mount `useEffect`, or add a new one:

```tsx
  useEffect(() => {
    if (contentType === "images" && images.length === 0 && !imagesLoading) void loadImages();
  }, [contentType]);
```

- [ ] **Step 4: Add the toggle + conditional render.** Insert the toggle immediately above the existing "Filter chips" block (`{DEPARTMENTS.map(...)}`):

```tsx
        {/* Content type toggle */}
        <div className="flex gap-2 mb-4">
          {(["documents", "images"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setContentType(t)}
              className="px-4 py-2 rounded-xl text-sm font-medium capitalize transition-all"
              style={{
                background: contentType === t ? "rgba(91,33,232,0.2)" : "#111118",
                border: contentType === t ? "1px solid rgba(91,33,232,0.45)" : "1px solid #2A2A38",
                color: contentType === t ? "#A07BFF" : "#5A5A70",
              }}
            >
              {t}
            </button>
          ))}
        </div>
```

Then wrap the EXISTING "Filter chips" + "Document list" blocks (from `{/* Filter chips */}` through the closing of the document-list conditional) in `{contentType === "documents" && (...)}`, and add a sibling `{contentType === "images" && (...)}` block right after it:

```tsx
        {contentType === "images" && (
          imagesLoading ? (
            <div className="flex items-center gap-2 py-12" style={{ color: "#5A5A70" }}>
              <span className="inline-block w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: "#5B21E8" }} />
              <span className="text-sm">Loading…</span>
            </div>
          ) : images.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-sm" style={{ color: "#5A5A70" }}>No images yet — upload one to edit from any department.</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {images.map((img) => (
                <div key={img.id} className="rounded-xl overflow-hidden" style={{ background: "#111118", border: "1px solid #2A2A38" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.url} alt={img.name} style={{ display: "block", width: "100%", height: "140px", objectFit: "cover", background: "#0D0D14" }} />
                  <div className="px-2 py-2 flex items-center justify-between gap-2">
                    <span className="text-xs truncate" style={{ color: "#9090A8" }}>{img.name}</span>
                    <button
                      onClick={() => void deleteImage(img.id)}
                      disabled={deletingImage === img.id}
                      className="text-xs flex-shrink-0 transition-colors hover:text-red-400"
                      style={{ color: "#3A3A50" }}
                    >
                      {deletingImage === img.id ? "…" : "Delete"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
```

- [ ] **Step 5: `npx tsc --noEmit`** — fix any type errors against the real `pb` SDK return shapes. Then `npx vitest run` (full suite) — confirm green. No dedicated test file exists for this page (consistent with the documents upload page precedent all night) — tsc + full suite is the gate.

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/dashboard/library/page.tsx
git commit -m "feat(library): minimal image browsing view (Documents/Images toggle)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 7: Tranche B gate**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully". This branch remains unmerged/unpushed to `main` — report this plainly (it is NOT independently deployable; the still-pending B4–C3 attach-button wiring is what would actually surface any of this to a user).

---

## Self-Review

**Spec coverage:** §2 decision 1 (filename = identity, no naming step) → A2/B2 (name set directly from `file.name`, no new input UI). §2 decision 2 (exact case-insensitive match, not content-hash) → A1/B2's `findCollidingNames`/`findCollidingImageNames`. §2 decision 3 (ask before uploading) → A2's confirm dialog gating the create loop. §2 decision 4 (batch-aware, per-file independent) → A2's `filesToUpload` split (non-colliding files proceed; only colliding ones pause). §2 decision 5 (images named + browsable) → B1 (name field) + B3 (library view). §2 decision 6 (branch reality) → Tranche B header note + Task B3 Step 7's explicit non-deployability note. §3.1/§3.2 mechanism (fetch-list + client compare, not PB `~`) → A1/B2 both use `getList` + client-side `.toLowerCase()` comparison. §5 error handling (fail open on query error) → A1/B2's `catch { return [] }`. §7 files → A1 (new lib file), A2 (page.tsx), B1 (setup route), B2 (generation-client.ts), B3 (library page.tsx) all present.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The two "read the current file first" steps (A2 Step 1, B2/B3 preambles) are explicit verification instructions with a stated reason (branch/file state may have shifted), not vague placeholders.

**Type consistency:** `findCollidingNames(collection, userId, nameField, candidates): Promise<string[]>` (A1) and `findCollidingImageNames(userId, candidates): Promise<string[]>` (B2) are deliberately not unified into one call signature across branches (per the spec's accepted-duplication note) but share the identical return type and fail-open contract. `pendingDupes`'s shape (`{files, resolve}`) in A2 is used consistently between the state declaration, `confirmDuplicates`, and the dialog JSX. `uploadedAssets`'s `name` field (B1) is read consistently by B2 (write) and B3 (read for display).
