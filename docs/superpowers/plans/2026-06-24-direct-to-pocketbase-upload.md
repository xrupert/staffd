# Direct-to-PocketBase Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the Vercel 4.5MB request-body cap on document uploads (the live, reported bug) by writing files directly from the browser to PocketBase, with a lightweight server-side "finalize" call handling the post-storage processing (extraction, Vault recording) that previously ran inline.

**Architecture:** The browser already holds a real PocketBase session (`pb.authStore.token`) and `documents`/`uploaded_assets` already carry `USER_OWNED` create rules — so the browser creates the full record (file included) directly against PocketBase via the JS SDK, no Vercel route in the file path. A new `POST /api/upload/documents/finalize` (tiny JSON body, no size concern) then performs the same extraction-kickoff + Vault-decision + upload-session logic the old single-shot route did, reusing the already-tested `extractKindFor`/`extractText` helpers and the existing `document_extraction_worker` enqueue path unchanged.

**Tech Stack:** TypeScript, Next.js App Router, vitest (no jest-dom — use `el.textContent`+`.toMatch`), PocketBase JS SDK (client) + REST (server admin).

**Spec:** `docs/superpowers/specs/2026-06-24-direct-to-pocketbase-upload-design.md`

**Branch note (read before starting):** `app/api/upload/image/route.ts`, the `uploaded_assets` collection, and `uploadImage()` exist ONLY on the unmerged `feat/upload-to-edit-and-transparency` branch — not on `main`. **Tranche A (documents) executes on `main`** (or a fresh branch off it) — this is the live bug. **Tranche B (images) is NOT executed tonight** — it's written here for completeness per the spec, but should be applied as a modification to the `feat/upload-to-edit-and-transparency` branch's still-pending B2/B3 work when that feature resumes, not built twice. Do not start Tranche B unless explicitly told the other branch is checked out and ready.

**The gate (from `apps/web`):** `npx tsc --noEmit` (0) · `npx vitest run` (green) · `npx next build` ("Compiled successfully", at tranche boundary). Commit footer: `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`.

---

## TRANCHE A — Documents (execute now, on `main`)

### Task A1: `finalize` route — ownership check + TEXT inline extraction

**Files:**
- Create: `apps/web/app/api/upload/documents/finalize/route.ts`
- Test: `apps/web/__tests__/api/upload-documents-finalize.test.ts`

This route receives document ids the CLIENT already created directly in PocketBase (with `extraction_status: "pending"` for every file, regardless of type — the client no longer decides text-vs-binary, finalize is the single authority). For each id: verify ownership, determine kind from the filename extension (reusing `extractKindFor`), and for TEXT files, fetch the stored file bytes and decode them inline (reusing `extractText`) — mirroring exactly what the worker already does for binary files, asynchronously, just done synchronously here since text decode is fast.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/api/upload-documents-finalize.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const whoAmI = vi.fn();
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...a: unknown[]) => whoAmI(...a) }));
vi.mock("../../app/api/_lib/pb", () => ({
  getAdminToken: async () => "admin-token",
  pbUrl: () => "http://pb",
  adminHeaders: (token: string) => ({ Authorization: token, "Content-Type": "application/json" }),
}));
const recordDecision = vi.fn();
vi.mock("../../app/api/_lib/vault/outcomes", () => ({ recordDecision: (...a: unknown[]) => recordDecision(...a) }));
const recordUploadSession = vi.fn();
vi.mock("../../app/api/_lib/upload/session", () => ({ recordUploadSession: (...a: unknown[]) => recordUploadSession(...a) }));

const fetchMock = vi.fn();

function docRecord(id: string, user: string, file: string, status = "pending") {
  return { id, user, file, extraction_status: status };
}

beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "u1", email: "u@x.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
});

import { POST } from "../../app/api/upload/documents/finalize/route";

function req(body: unknown) {
  return new Request("http://localhost/api/upload/documents/finalize", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "t" }, body: JSON.stringify(body),
  });
}

describe("POST /api/upload/documents/finalize", () => {
  it("401 without a session", async () => {
    whoAmI.mockResolvedValue(null);
    expect((await POST(req({ documentIds: ["d1"] }))).status).toBe(401);
  });

  it("400 with no documentIds", async () => {
    expect((await POST(req({ documentIds: [] }))).status).toBe(400);
  });

  it("text file: fetches bytes, decodes inline, patches extracted, records decision", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d1") && (!init || init.method === "GET" || !init.method)) {
        return { ok: true, json: async () => docRecord("d1", "u1", "notes.txt") };
      }
      if (u.includes("/api/files/token")) return { ok: true, json: async () => ({ token: "ftok" }) };
      if (u.includes("/api/files/documents/d1/")) return { ok: true, arrayBuffer: async () => new TextEncoder().encode("hello world").buffer };
      if (u.includes("/documents/records/d1") && init?.method === "PATCH") return { ok: true, json: async () => ({}) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d1"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results).toContainEqual({ document_id: "d1", name: "notes.txt", status: "extracted" });
    const patchCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("d1") && c[1]?.method === "PATCH");
    expect(JSON.parse(patchCall![1].body)).toMatchObject({ extraction_status: "extracted", output: "hello world" });
    expect(recordDecision).toHaveBeenCalledWith(expect.objectContaining({ userId: "u1", document_id: "d1", decision_kind: "document_uploaded" }));
    expect(recordUploadSession).toHaveBeenCalledWith("u1", "documents", expect.objectContaining({ succeeded: 1, failed: 0 }));
  });

  it("binary file: enqueues the existing extraction worker task, does not patch status itself", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d2") && (!init || !init.method || init.method === "GET")) {
        return { ok: true, json: async () => docRecord("d2", "u1", "report.pdf") };
      }
      if (u.includes("/workflow_tasks/records")) return { ok: true, json: async () => ({ id: "wt1" }) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d2"] }));
    const data = await res.json();
    expect(data.results).toContainEqual({ document_id: "d2", name: "report.pdf", status: "extraction_pending" });
    const taskCall = fetchMock.mock.calls.find((c) => String(c[0]).includes("/workflow_tasks/records"));
    expect(taskCall).toBeTruthy();
    const taskBody = JSON.parse(taskCall![1].body);
    expect(taskBody).toMatchObject({ specialist_id: "document_extraction_worker", input_payload: { document_id: "d2", ext: "pdf" } });
  });

  it("a document not owned by the caller is reported as an error, other ids in the batch still process", async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/documents/records/d3")) return { ok: true, json: async () => docRecord("d3", "OTHER_USER", "x.txt") };
      if (u.includes("/documents/records/d4")) return { ok: true, json: async () => docRecord("d4", "u1", "y.pdf") };
      if (u.includes("/workflow_tasks/records")) return { ok: true, json: async () => ({ id: "wt2" }) };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["d3", "d4"] }));
    const data = await res.json();
    expect(data.errors).toContainEqual({ document_id: "d3", reason: "not_owned" });
    expect(data.results).toContainEqual({ document_id: "d4", name: "y.pdf", status: "extraction_pending" });
    expect(data.succeeded).toBe(1);
    expect(data.failed).toBe(1);
  });

  it("a missing document id is reported as not_found, does not throw", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).includes("/documents/records/missing")) return { ok: false, status: 404 };
      return { ok: true, json: async () => ({}) };
    });
    const res = await POST(req({ documentIds: ["missing"] }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.errors).toContainEqual({ document_id: "missing", reason: "not_found" });
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd /c/Users/xrupe/staffd/apps/web && npx vitest run __tests__/api/upload-documents-finalize.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/upload/documents/finalize/route.ts
/**
 * POST /api/upload/documents/finalize — the post-storage half of document
 * upload (W: direct-to-PocketBase upload). The browser already created the
 * document record (with file) directly against PocketBase, bypassing the
 * Vercel function for the file bytes — this is the ONLY thing that still
 * runs server-side: determine TEXT vs BINARY, decode TEXT inline (reusing
 * the same extractKindFor/extractText the async worker uses for binaries),
 * enqueue the EXISTING document_extraction_worker task for binaries
 * unchanged, and record the Vault decision + upload-session summary
 * (admin-token-mediated — the client never writes these directly).
 *
 * Body: { documentIds: string[] }. Tiny JSON — never size-constrained,
 * regardless of how large the original file was.
 */

import { getAdminToken, pbUrl, adminHeaders } from "../../../_lib/pb";
import { whoAmI } from "../../../_lib/integrations/identity";
import { recordDecision } from "../../../_lib/vault/outcomes";
import { recordUploadSession } from "../../../_lib/upload/session";
import { extractKindFor, extractText } from "../../../_lib/upload/extract";

type DocRow = { id: string; user: string; file: string; extraction_status?: string };
type ResultRow = { document_id: string; name: string; status: "extracted" | "extraction_pending" };
type ErrorRow = { document_id: string; reason: string };

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { documentIds?: string[] };
  try { body = await req.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const ids = (body.documentIds ?? []).filter((id) => typeof id === "string" && id.trim());
  if (ids.length === 0) return Response.json({ error: "no_document_ids" }, { status: 400 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const results: ResultRow[] = [];
  const errors: ErrorRow[] = [];

  for (const id of ids) {
    const docRes = await fetch(`${pb}/api/collections/documents/records/${id}`, { headers: { Authorization: token } });
    if (!docRes.ok) { errors.push({ document_id: id, reason: "not_found" }); continue; }
    const doc = (await docRes.json()) as DocRow;
    if (doc.user !== me.id) { errors.push({ document_id: id, reason: "not_owned" }); continue; }

    const ext = (doc.file?.split(".").pop() ?? "").toLowerCase();
    const kind = extractKindFor(ext);
    if (!kind) {
      await fetch(`${pb}/api/collections/documents/records/${id}`, {
        method: "PATCH", headers: adminHeaders(token),
        body: JSON.stringify({ extraction_status: "error", output: "[No extractable text for this file type.]" }),
      });
      errors.push({ document_id: id, reason: "unsupported_type" });
      void recordDecision({ userId: me.id, decision_kind: "document_uploaded", title: `Uploaded "${doc.file}"`, source_kind: "manual", source_id: id, document_id: id });
      continue;
    }

    if (kind === "text") {
      let fileToken = "";
      try {
        const tk = await fetch(`${pb}/api/files/token`, { method: "POST", headers: adminHeaders(token) });
        if (tk.ok) fileToken = ((await tk.json()) as { token?: string }).token ?? "";
      } catch { /* try without token */ }
      const fileUrl = `${pb}/api/files/documents/${id}/${encodeURIComponent(doc.file)}${fileToken ? `?token=${fileToken}` : ""}`;
      const blobRes = await fetch(fileUrl, { headers: { Authorization: token } });
      if (blobRes.ok) {
        const buf = new Uint8Array(await blobRes.arrayBuffer());
        const extracted = await extractText(buf, "text");
        await fetch(`${pb}/api/collections/documents/records/${id}`, {
          method: "PATCH", headers: adminHeaders(token),
          body: JSON.stringify({ output: extracted.text || "[Document uploaded — no readable text found.]", extraction_status: "extracted" }),
        });
        results.push({ document_id: id, name: doc.file, status: "extracted" });
      } else {
        errors.push({ document_id: id, reason: "file_fetch_failed" });
      }
    } else {
      // PDF/DOCX — unchanged async path: enqueue the existing worker task.
      void fetch(`${pb}/api/collections/workflow_tasks/records`, {
        method: "POST", headers: adminHeaders(token),
        body: JSON.stringify({
          workflow_id: "", user: me.id, specialist_id: "document_extraction_worker", department_id: "system",
          input_payload: { document_id: id, ext }, output_payload: null, status: "pending", depends_on: [],
          retry_count: 0, error: "", started_at: "", completed_at: "", cost_estimate_tokens: 0, cost_actual_tokens: 0,
        }),
      }).catch(() => {});
      results.push({ document_id: id, name: doc.file, status: "extraction_pending" });
    }

    void recordDecision({ userId: me.id, decision_kind: "document_uploaded", title: `Uploaded "${doc.file}"`, source_kind: "manual", source_id: id, document_id: id });
  }

  const total = ids.length;
  const succeeded = results.length;
  const failed = errors.length;
  void recordUploadSession(me.id, "documents", {
    fileCount: total, rowCount: total, succeeded, failed,
    summary: `Uploaded ${succeeded} document${succeeded === 1 ? "" : "s"}${failed ? `, ${failed} skipped` : ""}`,
  });

  return Response.json({ ok: true, total, succeeded, failed, results, errors }, { status: 200 });
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/api/upload-documents-finalize.test.ts`
Expected: ALL 6 cases PASS.

- [ ] **Step 5: Verify `adminHeaders` is actually exported from `_lib/pb.ts`**

Run: `grep -n "export.*adminHeaders" app/api/_lib/pb.ts`
Expected: a match. If the signature differs (e.g., takes extra args), adapt the route's calls to match the real signature and re-run Step 4.

- [ ] **Step 6: `npx tsc --noEmit`** (exit 0), then commit:

```bash
git add apps/web/app/api/upload/documents/finalize/route.ts apps/web/__tests__/api/upload-documents-finalize.test.ts
git commit -m "feat(upload): finalize route — post-storage processing for direct-to-PB uploads

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A2: Client — direct PocketBase create + finalize call

**Files:**
- Modify: `apps/web/app/dashboard/upload/page.tsx`

Replace `submit()`'s single multipart-to-Vercel-route fetch with: per-file `pb.collection("documents").create(fd)` directly against PocketBase, collecting successful ids; then ONE call to `/api/upload/documents/finalize` with those ids; then feed the existing (already-built-tonight) `statuses`/`pollDoc` machinery from finalize's response instead of the old route's response. Raise the client-side size gate from the Vercel-cap workaround (4MB) to the real intended limits (25MB/file, 100MB/session) since the cap no longer applies.

- [ ] **Step 1: Read the current `submit()` and the `PLATFORM_BODY_LIMIT_BYTES` gate to confirm exact current text before editing**

Run: `grep -n "PLATFORM_BODY_LIMIT_BYTES\|const submit = async\|tooLargeToSend\|oversizedFiles\|totalBytes" app/dashboard/upload/page.tsx`

- [ ] **Step 2: Replace the size constant and gate**

Replace:
```tsx
// Vercel Serverless Functions enforce a hard ~4.5MB request-body cap at the
// PLATFORM level — before our route code (and our own 25MB-per-file check)
// ever runs. A request over this silently gets the platform's own (non-JSON)
// error page, which used to surface as an opaque "Something went wrong."
// 4MB gives safe headroom under that cap for multipart boundary overhead.
const PLATFORM_BODY_LIMIT_BYTES = 4 * 1024 * 1024;
```
with:
```tsx
// Documents now upload DIRECTLY to PocketBase (the browser's own session, the
// same pattern already used by the Vault logo upload) — the Vercel 4.5MB body
// cap no longer applies, since file bytes never pass through a Vercel
// function. These are our actual intended limits (PocketBase enforces the
// same at the field level as defense-in-depth).
const MAX_DOC_BYTES = 25 * 1024 * 1024;       // 25 MB / file
const MAX_SESSION_BYTES = 100 * 1024 * 1024;  // 100 MB / batch
const TEXT_EXT = new Set(["txt", "md"]);
const BINARY_EXT = new Set(["pdf", "docx"]);
```

Update every other reference to `PLATFORM_BODY_LIMIT_BYTES` in the file (the file-list size warning, the `oversizedFiles`/`tooLargeToSend` computation) to use `MAX_DOC_BYTES` for the per-file check and `MAX_SESSION_BYTES` for the total-batch check (previously both used the same single constant — now split, matching the real two-tier limit the old server route enforced).

- [ ] **Step 3: Replace `submit()`**

```tsx
  const submit = async () => {
    if (files.length === 0 || tooLargeToSend) return;
    setBusy(true); setResult(null); setStatuses({});
    const clientErrors: { row: number; reason: string }[] = [];
    const createdIds: { id: string; name: string }[] = [];

    let idx = 0;
    for (const file of files) {
      idx++;
      const e = file.name.toLowerCase().split(".").pop() ?? "";
      if (!TEXT_EXT.has(e) && !BINARY_EXT.has(e)) {
        clientErrors.push({ row: idx, reason: `unsupported type ".${e}" (allowed: PDF, DOCX, TXT, MD)` });
        continue;
      }
      try {
        const fd = new FormData();
        fd.append("user", pb.authStore.record?.id ?? "");
        fd.append("client", "");
        fd.append("department", "library");
        fd.append("agent_name", "Uploaded document");
        fd.append("prompt", file.name);
        fd.append("source", "upload");
        fd.append("extraction_status", "pending"); // finalize decides the real outcome
        fd.append("output", "[Reading this document… your specialist will have it shortly.]");
        fd.append("file", file, file.name);
        // Direct to PocketBase — no Vercel function in the file path, so the
        // platform's ~4.5MB body cap never applies (only our own 25MB limit,
        // already gated client-side and enforced at the PB field level).
        const rec = await pb.collection("documents").create(fd);
        createdIds.push({ id: (rec as { id: string }).id, name: file.name });
      } catch (e) {
        clientErrors.push({ row: idx, reason: e instanceof Error ? e.message : "upload_failed" });
      }
    }

    if (createdIds.length === 0) {
      setResult({ error: clientErrors[0]?.reason ?? "upload_failed" });
      setBusy(false);
      return;
    }

    try {
      const token = pb.authStore.token;
      const finRes = await fetch("/api/upload/documents/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: token } : {}) },
        body: JSON.stringify({ documentIds: createdIds.map((d) => d.id) }),
      });
      const finData = await finRes.json().catch(() => null) as
        | { ok: boolean; total: number; succeeded: number; failed: number; results: { document_id: string; name: string; status: "extracted" | "extraction_pending" }[]; errors: { document_id: string; reason: string }[] }
        | null;

      if (!finRes.ok || !finData) {
        setResult({ error: "upload_failed", detail: `finalize status ${finRes.status}` });
      } else {
        const documents = finData.results.map((r) => ({ document_id: r.document_id, name: r.name, status: r.status }));
        const allErrors = [...clientErrors, ...finData.errors.map((e, i) => ({ row: i + 1, reason: e.reason }))];
        setResult({ ok: true, total: files.length, succeeded: finData.succeeded, failed: clientErrors.length + finData.failed, errors: allErrors, documents });
        const init: Record<string, DocStatus> = {};
        for (const d of documents) init[d.document_id] = { name: d.name, state: d.status === "extracted" ? "ready" : "processing" };
        setStatuses(init);
        for (const d of documents) if (d.status === "extraction_pending") void pollDoc(d.document_id, d.name);
      }
    } catch {
      setResult({ error: "upload_failed", detail: "finalize unreachable" });
    }

    setFiles([]); onDone();
    setBusy(false);
  };
```

> Note: `pb.collection("documents").create(fd)` throws a `ClientResponseError` on a PocketBase-side validation failure (wrong mime/oversized per field constraint) — the existing `try/catch` around it handles this, surfacing `e.message` per file. This is the SAME defense-in-depth posture the spec calls for: client pre-flight gate (Step 2's `tooLargeToSend`) catches the common case before any network call; PocketBase's field-level `maxSize`/`mimeTypes` (already configured on the `documents` collection) catches anything that slips through.

- [ ] **Step 4: Update `tooLargeToSend`/`oversizedFiles` to use the new constants**

Find the existing computation (added in tonight's earlier hotfix):
```tsx
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const oversizedFiles = files.filter((f) => f.size > PLATFORM_BODY_LIMIT_BYTES);
  const tooLargeToSend = totalBytes > PLATFORM_BODY_LIMIT_BYTES;
```
Replace with:
```tsx
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  const oversizedFiles = files.filter((f) => f.size > MAX_DOC_BYTES);
  const tooLargeToSend = oversizedFiles.length > 0 || totalBytes > MAX_SESSION_BYTES;
```
And update the two JSX spots referencing `PLATFORM_BODY_LIMIT_BYTES` (the per-file warning label, the batch-too-large message) to use `MAX_DOC_BYTES` / `MAX_SESSION_BYTES` respectively (per-file message uses `MAX_DOC_BYTES`, the "these files total more than Xmb" message uses `MAX_SESSION_BYTES`).

- [ ] **Step 5: Typecheck + full tests + build**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: tsc exit 0; full suite green; build compiles. (No existing component test harness for this page — same as tonight's earlier hotfix — rely on tsc + manual verification.)

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/dashboard/upload/page.tsx
git commit -m "feat(upload): documents upload directly to PocketBase (real fix for the 4.5MB cap)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task A3: Remove the superseded single-shot route

**Files:**
- Delete: `apps/web/app/api/upload/documents/route.ts`

The old route's logic now lives split across the client (Task A2, record creation) and `finalize` (Task A1, post-storage processing). Before deleting, confirm nothing else in the codebase calls `/api/upload/documents` directly.

- [ ] **Step 1: Confirm no other caller**

Run: `grep -rn "upload/documents" --include=*.ts --include=*.tsx app/ lib/ | grep -v "upload/documents/finalize" | grep -v "__tests__"`
Expected: only `app/dashboard/upload/page.tsx`'s OLD fetch call (which Task A2 already replaced) and `app/api/upload/documents/route.ts` itself. If anything else references it, STOP and report — do not delete.

- [ ] **Step 2: Delete the route and its now-obsolete reference inside the `documents-v2` setup doc comment if any mentions it by path**

```bash
rm apps/web/app/api/upload/documents/route.ts
```

- [ ] **Step 3: `npx tsc --noEmit && npx vitest run`**

Expected: exit 0; full suite green (no test referenced the deleted route directly — Task A1's tests are for `finalize`, a different file).

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore(upload): remove the superseded single-shot documents upload route

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

- [ ] **Step 5: Tranche A gate**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully". Document uploads now bypass the Vercel body cap entirely.

---

## TRANCHE B — Images (defer — apply to `feat/upload-to-edit-and-transparency` when that branch resumes, NOT to `main` tonight)

> Do not execute this tranche unless the `feat/upload-to-edit-and-transparency` branch is checked out and its B1–B3 work (the `uploaded_assets` collection, `/api/upload/image` route, `uploadImage()` helper) is present. On `main`, none of these files exist yet.

### Task B1: Remove the Vercel-mediated image upload route; write directly to PocketBase

**Files:**
- Delete (on the feature branch): `app/api/upload/image/route.ts`
- Modify (on the feature branch): `lib/generation-client.ts`

There is no extraction or Vault step for an uploaded edit-source image — unlike documents, this needs no finalize call at all.

- [ ] **Step 1: Replace `uploadImage()` in `lib/generation-client.ts`**

```ts
import pb from "./pb";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Upload an image to edit, directly to PocketBase (no Vercel function in the
 * file path — same pattern as the documents fix). Returns the public,
 * muapi-fetchable url or a friendly error.
 */
export async function uploadImage(file: File): Promise<{ url?: string; error?: string }> {
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    return { error: "Upload a PNG, JPG, or WebP." };
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { error: `That image is too large — keep it under ${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB.` };
  }
  try {
    const fd = new FormData();
    fd.append("user", pb.authStore.record?.id ?? "");
    fd.append("kind", "image");
    fd.append("file", file, file.name);
    const rec = await pb.collection("uploaded_assets").create(fd) as { id: string; file: string };
    const url = `${pb.baseURL}/api/files/uploaded_assets/${rec.id}/${encodeURIComponent(rec.file)}`;
    return { url };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Couldn't upload that image — try again." };
  }
}
```

- [ ] **Step 2: Delete the now-unused server route**

```bash
rm app/api/upload/image/route.ts
```

- [ ] **Step 3: Update/retire `__tests__/api/upload-image-route.test.ts`**

This test exercised the now-deleted server route. Replace it with a test of the rewritten `uploadImage()` client helper (mock `pb.collection`):

```ts
// apps/web/__tests__/lib/upload-image.test.ts (replaces __tests__/api/upload-image-route.test.ts)
import { describe, it, expect, vi, beforeEach } from "vitest";

const create = vi.fn();
vi.mock("../../lib/pb", () => ({
  default: { authStore: { record: { id: "u1" } }, baseURL: "http://pb", collection: () => ({ create }) },
}));

import { uploadImage } from "../../lib/generation-client";

beforeEach(() => create.mockReset());

function img(name: string, type: string, bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("uploadImage (direct to PocketBase)", () => {
  it("rejects a non-image type without calling PocketBase", async () => {
    const r = await uploadImage(img("a.pdf", "application/pdf"));
    expect(r.error).toMatch(/PNG, JPG, or WebP/);
    expect(create).not.toHaveBeenCalled();
  });

  it("success: creates directly against uploaded_assets and returns the public url", async () => {
    create.mockResolvedValue({ id: "rec1", file: "iris_abc.png" });
    const r = await uploadImage(img("iris.png", "image/png"));
    expect(r.url).toBe("http://pb/api/files/uploaded_assets/rec1/iris_abc.png");
  });

  it("a PocketBase create failure surfaces a friendly error", async () => {
    create.mockRejectedValue(new Error("field validation failed"));
    const r = await uploadImage(img("iris.png", "image/png"));
    expect(r.error).toBe("field validation failed");
  });
});
```

Delete the old route test:
```bash
rm __tests__/api/upload-image-route.test.ts
```

- [ ] **Step 4: Run tests, typecheck, build (Tranche B gate)**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green.

- [ ] **Step 5: Commit on the feature branch**

```bash
git add lib/generation-client.ts __tests__/lib/upload-image.test.ts
git rm app/api/upload/image/route.ts __tests__/api/upload-image-route.test.ts
git commit -m "feat(upload): images upload directly to PocketBase (no Vercel size cap)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage:** §4.1 (documents direct write + finalize) → Tasks A1, A2. §4.2 (images direct write, no finalize) → Task B1 (deferred to the correct branch). §4.3 (validation limits raised to real values) → A2 Step 2/4. §4.4 (failure handling: PB create failure surfaces friendly message; finalize per-id partial failure) → A1's not_owned/not_found/unsupported_type cases, A2's try/catch. §5 data flow → A1+A2 (documents), B1 (images). §6 tests → A1's 6 cases, B1's 3 cases. §7 files → A1 (new finalize route), A2 (page.tsx), A3 (delete old route), B1 (image route deleted, generation-client rewritten, test moved). §8 out of scope (orphan reconciliation, contacts CSV) → untouched, no task added for either, correctly excluded.

**Placeholder scan:** no TBD/TODO; every code step shows complete code. The one explicit verification step (A1 Step 5, confirming `adminHeaders`' real signature) is a concrete check with an exact command, not a vague "handle this."

**Type consistency:** `ResultRow`/`ErrorRow` (finalize) match the shape A2's client code reads (`results: {document_id,name,status}[]`, `errors: {document_id,reason}[]`). `extractKindFor`/`extractText` signatures match Task A1's usage exactly as fixed/tested in tonight's earlier extraction-bug hotfix (`(buffer: Uint8Array, kind: ExtractKind)`, `kind === "text"` path). `uploadImage`'s return shape (`{url?, error?}`) in Task B1 matches the EXISTING shape already used by call sites in `CommandCenter.tsx`/`DepartmentRoom.tsx` from last night's edit-as-intent work — no caller-side change needed there, only the implementation moves.
