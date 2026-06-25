# Upload-to-Edit, True Transparency & Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users edit their OWN images (upload → edit-as-intent), make STAFFD deliver TRUE transparency instead of a painted checkerboard, and give every rendered image a Download.

**Architecture:** Reuses the shipped edit-as-intent infra (the `remove_background` op → alpha-producing model is the only true-transparency mechanism). Transparency fix = enricher stops asking text-to-image for a "transparent background" (it paints a checkerboard) + a client pipeline that auto-runs background-removal on transparency-intent generations. Upload = a public-read `uploaded_assets` PB collection (file field `protected:false` → muapi-fetchable URL) + an attach button that makes the uploaded image the active artifact.

**Tech Stack:** TypeScript, Next.js App Router, vitest (NO jest-dom — use `el.textContent`+`.toMatch`), PocketBase REST, muapi.

**Spec:** `docs/superpowers/specs/2026-06-24-upload-to-edit-design.md`

**The gate (from `apps/web`):** `npx tsc --noEmit` (0) · `npx vitest run` (green) · `npx next build` ("Compiled successfully", at tranche boundaries). Commit footer: `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

```
EDIT app/api/_lib/generation/enricher-prompt.ts   line 18: solid removable bg, ban checkerboard (root-cause fix)
NEW  app/api/_lib/generation/intent-cues.ts        pure: wantsTransparency, detectUploadEditIntent
EDIT lib/generation-client.ts                      uploadImage(file), runGenerationWithTransparency(opts)
NEW  app/api/setup/uploaded-assets/route.ts         idempotent uploaded_assets collection (public file field)
EDIT app/api/_lib/security/row-rules.ts            register uploaded_assets (USER_OWNED record rules)
NEW  app/api/upload/image/route.ts                  POST multipart → public uploaded_assets row → public url
EDIT app/components/CommandCenter.tsx               attach button + upload→active artifact; send() nudge; transparency call-site swap; per-option Download
EDIT app/components/DepartmentRoom.tsx              attach button + upload→setImageUrl; transparency call-site swap
EDIT app/components/EditAffordances.tsx             restore per-option Download in grid cells

NEW  __tests__/generation/intent-cues.test.ts
NEW  __tests__/generation/enricher-prompt-transparency.test.ts   (or extend existing enricher test)
NEW  __tests__/generation/transparency-pipeline.test.ts
NEW  __tests__/api/upload-image-route.test.ts
```

Three shippable tranches: **A** true-transparency (the live bad-deliverable bug — ship first), **B** upload-to-edit, **C** nudge + Download.

---

## TRANCHE A — True transparency (checkerboard fix)

### Task A1: Enricher root-cause fix

**Files:**
- Modify: `apps/web/app/api/_lib/generation/enricher-prompt.ts` (line 18)
- Test: `apps/web/__tests__/generation/enricher-prompt-transparency.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/generation/enricher-prompt-transparency.test.ts
import { describe, it, expect } from "vitest";
import { buildEnricherSystemPrompt } from "../../app/api/_lib/generation/enricher-prompt";

describe("image enricher — no fake transparency (checkerboard fix)", () => {
  const p = buildEnricherSystemPrompt("image");
  it("never instructs a transparent background (text-to-image paints a checkerboard)", () => {
    expect(p).not.toMatch(/transparent background/i);
  });
  it("instructs a solid, removable background and bans the checkerboard", () => {
    expect(p).toMatch(/solid/i);
    expect(p).toMatch(/checkerboard/i); // present as an explicit ban
  });
});
```

- [ ] **Step 2: Run → fail**

Run: `cd /c/Users/xrupe/staffd/apps/web && npx vitest run __tests__/generation/enricher-prompt-transparency.test.ts`
Expected: FAIL (current prompt says "plain or transparent background", no "solid"/"checkerboard").

- [ ] **Step 3: Fix line 18 of `enricher-prompt.ts`**

Replace the sentence:
```
IF IT IS A LOGO OR BRAND MARK: a single iconic symbol — clean vector, flat design, simple and memorable, the brand's concept expressed as one shape/idea, centered on a plain or transparent background, professional brand identity. NOT a mockup, NOT a sheet of options, NOT a photo of a brief.
```
with:
```
IF IT IS A LOGO OR BRAND MARK: a single iconic symbol — clean vector, flat design, simple and memorable, the brand's concept expressed as one shape/idea, centered on a plain SOLID background (clean, even, easily removable — e.g. plain white), with crisp clean edges, professional brand identity. NEVER a transparent or checkerboard background (transparency is added afterward, not painted). NOT a mockup, NOT a sheet of options, NOT a photo of a brief.
```

- [ ] **Step 4: Run → pass**

Run: `npx vitest run __tests__/generation/enricher-prompt-transparency.test.ts`
Expected: PASS. Also run the existing enricher test if present (`npx vitest run __tests__/generation/enricher-prompt.test.ts`) — still green.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/_lib/generation/enricher-prompt.ts apps/web/__tests__/generation/enricher-prompt-transparency.test.ts
git commit -m "fix(generation): enricher no longer prompts transparent bg (paints a checkerboard)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A2: `wantsTransparency` pure helper

**Files:**
- Create: `apps/web/app/api/_lib/generation/intent-cues.ts`
- Test: `apps/web/__tests__/generation/intent-cues.test.ts`

Pure, client-safe (imports nothing server-only) — used by the client transparency pipeline AND (Tranche C) the upload nudge.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/generation/intent-cues.test.ts
import { describe, it, expect } from "vitest";
import { wantsTransparency } from "../../app/api/_lib/generation/intent-cues";

describe("wantsTransparency", () => {
  it("true for transparency-intent requests", () => {
    for (const s of ["a logo for IRIS", "make it transparent", "no background",
                     "a sticker of a cat", "die-cut decal", "cut out the subject"]) {
      expect(wantsTransparency(s), s).toBe(true);
    }
  });
  it("false for ordinary image requests", () => {
    for (const s of ["a sunset over the ocean", "a product photo on a table",
                     "an invoice for a client", "a hero banner"]) {
      expect(wantsTransparency(s), s).toBe(false);
    }
  });
  it("empty → false", () => expect(wantsTransparency("")).toBe(false));
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run __tests__/generation/intent-cues.test.ts`) — module not found.

- [ ] **Step 3: Implement**

```ts
// apps/web/app/api/_lib/generation/intent-cues.ts
/**
 * Pure, client-safe intent cues (no server/LLM deps) for the generation +
 * upload flows. Mirrors the keyword-classifier pattern of edit-ops.ts.
 */

// A logo/brand mark defaults to wanting transparency (used on any background).
const TRANSPARENCY = /\b(transparent|transparency|no background|without (a |the )?background|cut ?out|cutout|cut out|die[- ]?cut|sticker|decal|logo|brand mark|wordmark|emblem|icon set|png with transparency)\b/i;

/** True when a generation request implies a true-alpha (transparent) result. */
export function wantsTransparency(text: string): boolean {
  return TRANSPARENCY.test((text ?? "").trim());
}
```

- [ ] **Step 4: Run → pass** (`npx vitest run __tests__/generation/intent-cues.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/_lib/generation/intent-cues.ts apps/web/__tests__/generation/intent-cues.test.ts
git commit -m "feat(generation): wantsTransparency cue helper (pure)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A3: Client transparency pipeline + CommandCenter swap

**Files:**
- Modify: `apps/web/lib/generation-client.ts`
- Modify: `apps/web/app/components/CommandCenter.tsx`
- Test: `apps/web/__tests__/generation/transparency-pipeline.test.ts`

Add `runGenerationWithTransparency`: generate, then if it's an image whose prompt wants transparency, auto-run `runEdit` background-removal and return the alpha url (falling back to the solid-bg image on removal failure). Swap CommandCenter's image generation call sites to it.

- [ ] **Step 1: Write the failing test** (mock the client fetch boundary indirectly by mocking `runGeneration`/`runEdit`)

```ts
// apps/web/__tests__/generation/transparency-pipeline.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const runGeneration = vi.fn();
const runEdit = vi.fn();
vi.mock("../../lib/pb", () => ({ default: { authStore: { token: "t", record: { id: "u1" } } } }));

// Import after mocks; we mock the two drivers the pipeline composes.
vi.mock("../../lib/generation-client", async (orig) => {
  const actual = await orig<typeof import("../../lib/generation-client")>();
  return { ...actual, runGeneration: (...a: unknown[]) => runGeneration(...a), runEdit: (...a: unknown[]) => runEdit(...a) };
});
import { runGenerationWithTransparency } from "../../lib/generation-client";

beforeEach(() => { runGeneration.mockReset(); runEdit.mockReset(); });

describe("runGenerationWithTransparency", () => {
  it("transparency-intent image → auto bg-removal, returns the alpha url", async () => {
    runGeneration.mockResolvedValue({ url: "https://gen/solid.png" });
    runEdit.mockResolvedValue({ url: "https://gen/alpha.png" });
    const r = await runGenerationWithTransparency({ userId: "u1", kind: "image", prompt: "a logo for IRIS" });
    expect(runEdit).toHaveBeenCalledWith(expect.objectContaining({ kind: "image", sourceUrl: "https://gen/solid.png", instruction: "remove the background" }), undefined);
    expect(r.url).toBe("https://gen/alpha.png");
  });
  it("non-transparency image → no bg-removal", async () => {
    runGeneration.mockResolvedValue({ url: "https://gen/photo.png" });
    const r = await runGenerationWithTransparency({ userId: "u1", kind: "image", prompt: "a sunset photo" });
    expect(runEdit).not.toHaveBeenCalled();
    expect(r.url).toBe("https://gen/photo.png");
  });
  it("bg-removal failure → falls back to the solid-bg image", async () => {
    runGeneration.mockResolvedValue({ url: "https://gen/solid.png" });
    runEdit.mockResolvedValue({ error: "failed" });
    const r = await runGenerationWithTransparency({ userId: "u1", kind: "image", prompt: "a logo" });
    expect(r.url).toBe("https://gen/solid.png");
  });
  it("video → never bg-removes", async () => {
    runGeneration.mockResolvedValue({ url: "https://gen/v.mp4" });
    const r = await runGenerationWithTransparency({ userId: "u1", kind: "video", prompt: "a logo animation" });
    expect(runEdit).not.toHaveBeenCalled();
    expect(r.url).toBe("https://gen/v.mp4");
  });
});
```

> Note: because the pipeline calls `runGeneration`/`runEdit` from the same module, the test mocks them via a partial-module mock. If that proves awkward in practice (self-referential module mock), the implementer may instead structure `runGenerationWithTransparency` to accept the two drivers via default params (`{ _gen = runGeneration, _edit = runEdit } = {}`) for testability — pick whichever is clean and report which.

- [ ] **Step 2: Run → fail** (`npx vitest run __tests__/generation/transparency-pipeline.test.ts`).

- [ ] **Step 3: Implement in `lib/generation-client.ts`**

Add the import and the function (place after `runEdit`):
```ts
import { wantsTransparency } from "../app/api/_lib/generation/intent-cues";

/**
 * Generate, then deliver TRUE transparency when the prompt implies it: text-to-
 * image cannot make alpha (it paints a checkerboard), so a transparency-intent
 * image is generated on a solid background (enricher) and then auto-run through
 * background-removal to a real-alpha PNG. Falls back to the solid-bg image if
 * removal fails — never blocks the whole generation on the second step.
 */
export async function runGenerationWithTransparency(
  opts: { userId: string; kind: GenKind; prompt: string; aspectRatio?: string; tier?: string; department?: string; seed?: number },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  const gen = await runGeneration(opts, shouldCancel);
  if (gen.url && opts.kind === "image" && wantsTransparency(opts.prompt)) {
    const alpha = await runEdit({ kind: "image", sourceUrl: gen.url, instruction: "remove the background", department: opts.department }, shouldCancel);
    if (alpha.url) return { url: alpha.url };
  }
  return gen;
}
```

- [ ] **Step 4: Run → pass** (`npx vitest run __tests__/generation/transparency-pipeline.test.ts`). If you adopted the injected-driver variant, adjust the function signature accordingly and keep the four behaviors identical.

- [ ] **Step 5: Swap CommandCenter image generation call sites**

In `app/components/CommandCenter.tsx`, change the import:
```tsx
import { runGeneration, runEdit, runGenerationWithTransparency } from "../../lib/generation-client";
```
In `generateImageOptions` (the `Promise.all(... runGeneration({ ... kind:"image" ... }))`), replace `runGeneration` with `runGenerationWithTransparency` (same args). In `generateInlineMedia`, for the IMAGE path only, replace `runGeneration` with `runGenerationWithTransparency` (video stays `runGeneration`). Do NOT change the video path.

- [ ] **Step 6: Typecheck + full tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/generation-client.ts apps/web/app/components/CommandCenter.tsx apps/web/__tests__/generation/transparency-pipeline.test.ts
git commit -m "feat(generation): true-transparency pipeline (auto bg-removal) + CC wiring

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task A4: DepartmentRoom transparency swap

**Files:**
- Modify: `apps/web/app/components/DepartmentRoom.tsx`

- [ ] **Step 1: Locate the image generation submit**

Run: `grep -nE "runGeneration\(|kind: \"image\"|runImageGen" app/components/DepartmentRoom.tsx`
Find the image `runGeneration({ ... kind: "image" ... })` call (inside `runImageGen` ~line 645).

- [ ] **Step 2: Swap to the transparency pipeline**

Add `runGenerationWithTransparency` to the existing generation-client import in DepartmentRoom. Replace the image-kind `runGeneration(...)` call with `runGenerationWithTransparency(...)` (identical args). Leave the video `runGeneration` call unchanged.

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/DepartmentRoom.tsx
git commit -m "feat(generation): true-transparency pipeline in DepartmentRoom image gen

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 5: Tranche A gate**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully". Logos now deliver true alpha, not a checkerboard.

---

## TRANCHE B — Upload-to-edit

### Task B1: `uploaded_assets` collection (public file) + rules registry

**Files:**
- Create: `apps/web/app/api/setup/uploaded-assets/route.ts`
- Modify: `apps/web/app/api/_lib/security/row-rules.ts`

The file field is **`protected: false`** (default) so the `/api/files/...` URL is publicly fetchable by muapi (same as the business logo). Record-API rules are `USER_OWNED` (owner-scoped listing); file bytes are public via the unguessable id+filename, consistent with generated/logo assets.

- [ ] **Step 1: Register the collection's record rules**

In `app/api/_lib/security/row-rules.ts`, add to the `EXPECTED_COLLECTIONS` array (near the other `USER_OWNED_RULES` entries):
```ts
  { name: "uploaded_assets", rules: USER_OWNED_RULES },
```

- [ ] **Step 2: Create the setup route**

```ts
// apps/web/app/api/setup/uploaded-assets/route.ts
/**
 * Idempotent setup for `uploaded_assets` — user-uploaded images that become an
 * edit source for edit-as-intent. USER_OWNED record rules, but the `file` field
 * is PUBLIC (protected:false) so muapi can fetch the /api/files/... URL without
 * a token (same as the business logo; the unguessable id+filename is the
 * capability). Image mimes only.
 */
import { getAdminToken } from "../../_lib/pb";
import { ensureBaseCollection } from "../../_lib/setup/ensure-collection";
import { ensureCollectionRulesWithFreshToken } from "../../_lib/security/row-rules";

const NAME = "uploaded_assets";
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const MIME = ["image/png", "image/jpeg", "image/webp"];
const FIELDS = [
  { name: "user", type: "text", required: true },
  { name: "kind", type: "text", required: false }, // "image"
  { name: "file", type: "file", required: false, maxSelect: 1, maxSize: MAX_BYTES, mimeTypes: MIME, protected: false },
];

export async function POST() {
  if (!process.env.NEXT_PUBLIC_POCKETBASE_URL || !process.env.PB_ADMIN_EMAIL || !process.env.PB_ADMIN_PASSWORD) {
    return Response.json({ error: "PocketBase not configured" }, { status: 503 });
  }
  try {
    const token = await getAdminToken();
    const result = await ensureBaseCollection(token, NAME, FIELDS);
    const rules = await ensureCollectionRulesWithFreshToken(NAME);
    return Response.json({ ok: true, ...result, rules: rules.status });
  } catch (err) {
    console.error(`${NAME} setup error:`, err);
    return Response.json({ error: "Setup failed", detail: err instanceof Error ? err.message : "unknown" }, { status: 500 });
  }
}
export const GET = POST;
```

- [ ] **Step 3: Verify the row-rules registry test (if one exists) still passes**

Run: `grep -rln "EXPECTED_COLLECTIONS" __tests__/ 2>/dev/null` — if a test enumerates expected collections, run it: `npx vitest run <that file>`. Adding an entry is additive; if the test asserts an exact count it will need the new entry — update it to include `uploaded_assets` (do NOT weaken the assertion). Report what you found.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit` — exit 0.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/setup/uploaded-assets/route.ts apps/web/app/api/_lib/security/row-rules.ts
git commit -m "feat(upload): uploaded_assets collection (public file) + record rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> OPERATOR NOTE for the final report: this collection must be created in prod by running the setup route once (POST /api/setup/uploaded-assets) — same as other collections. Flag it in the handoff.

---

### Task B2: `POST /api/upload/image`

**Files:**
- Create: `apps/web/app/api/upload/image/route.ts`
- Test: `apps/web/__tests__/api/upload-image-route.test.ts`

Mirrors `app/api/upload/documents/route.ts` (multipart, whoAmI, PB multipart create) but for a single image into `uploaded_assets`, returning the public file URL.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/api/upload-image-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const whoAmI = vi.fn();
vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...a: unknown[]) => whoAmI(...a) }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "admin", pbUrl: () => "http://pb" }));

const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  whoAmI.mockResolvedValue({ id: "u1", email: "u@x.com" });
  global.fetch = fetchMock as unknown as typeof fetch;
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ id: "rec1", file: "iris_abc.png" }) });
});

import { POST } from "../../app/api/upload/image/route";

function form(file: File | null) {
  const fd = new FormData();
  if (file) fd.append("file", file, file.name);
  return new Request("http://localhost/api/upload/image", { method: "POST", headers: { Authorization: "t" }, body: fd });
}
function img(name: string, type: string, bytes = 10) {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("POST /api/upload/image", () => {
  it("401 without a session", async () => {
    whoAmI.mockResolvedValue(null);
    expect((await POST(form(img("a.png", "image/png")))).status).toBe(401);
  });
  it("400 with no file", async () => {
    const res = await POST(form(null));
    expect(res.status).toBe(400);
  });
  it("400 for a non-image type", async () => {
    const res = await POST(form(img("a.pdf", "application/pdf")));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unsupported_type");
  });
  it("success → returns the public uploaded_assets url", async () => {
    const res = await POST(form(img("iris.png", "image/png")));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.ok).toBe(true);
    expect(data.url).toBe("http://pb/api/files/uploaded_assets/rec1/iris_abc.png");
    expect(data.kind).toBe("image");
    // the PB create was multipart to uploaded_assets
    const createUrl = fetchMock.mock.calls.find((c) => String(c[0]).includes("/collections/uploaded_assets/records"));
    expect(createUrl).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run __tests__/api/upload-image-route.test.ts`).

- [ ] **Step 3: Implement**

```ts
// apps/web/app/api/upload/image/route.ts
/**
 * POST /api/upload/image — upload ONE image to edit (edit-as-intent source).
 * multipart `file`. Stores in the public-read `uploaded_assets` collection and
 * returns the public /api/files URL (muapi-fetchable). whoAmI auth (#39).
 */
import { getAdminToken, pbUrl } from "../../_lib/pb";
import { whoAmI } from "../../_lib/integrations/identity";

const MAX_BYTES = 10 * 1024 * 1024;
const MIME = new Set(["image/png", "image/jpeg", "image/webp"]);

export async function POST(req: Request) {
  const me = await whoAmI(req);
  if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });

  let formData: FormData;
  try { formData = await req.formData(); } catch { return Response.json({ error: "invalid_form" }, { status: 400 }); }
  const file = formData.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no_file" }, { status: 400 });
  if (!MIME.has(file.type)) return Response.json({ error: "unsupported_type", message: "Upload a PNG, JPG, or WebP." }, { status: 400 });
  if (file.size > MAX_BYTES) return Response.json({ error: "too_large", limitBytes: MAX_BYTES }, { status: 413 });

  let token: string;
  try { token = await getAdminToken(); } catch { return Response.json({ error: "pb_unconfigured" }, { status: 503 }); }
  const pb = pbUrl();

  const fd = new FormData();
  fd.append("user", me.id);
  fd.append("kind", "image");
  fd.append("file", file, file.name);
  const createRes = await fetch(`${pb}/api/collections/uploaded_assets/records`, { method: "POST", headers: { Authorization: token }, body: fd });
  if (!createRes.ok) return Response.json({ error: "save_failed", status: createRes.status }, { status: 502 });
  const rec = (await createRes.json()) as { id: string; file: string };
  const url = `${pb}/api/files/uploaded_assets/${rec.id}/${encodeURIComponent(rec.file)}`;
  return Response.json({ ok: true, url, kind: "image" }, { status: 200 });
}
```

- [ ] **Step 4: Run → pass** (`npx vitest run __tests__/api/upload-image-route.test.ts`). Note `encodeURIComponent("iris_abc.png")` === `"iris_abc.png"` so the asserted url matches.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/upload/image/route.ts apps/web/__tests__/api/upload-image-route.test.ts
git commit -m "feat(upload): POST /api/upload/image → public uploaded_assets url

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B3: `uploadImage` client helper

**Files:**
- Modify: `apps/web/lib/generation-client.ts`

- [ ] **Step 1: Add the helper** (after `runEdit`)

```ts
/** Upload one image to edit; returns the public url or a friendly error. */
export async function uploadImage(file: File): Promise<{ url?: string; error?: string }> {
  const fd = new FormData();
  fd.append("file", file, file.name);
  let res: Response;
  try {
    res = await fetch("/api/upload/image", { method: "POST", headers: { Authorization: pb.authStore.token }, body: fd });
  } catch (e) {
    return { error: `Couldn't upload that image: ${e instanceof Error ? e.message : String(e)}` };
  }
  const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string; message?: string };
  if (!res.ok || !data.url) return { error: data.message ?? data.error ?? "Couldn't upload that image — try again." };
  return { url: data.url };
}
```

- [ ] **Step 2: Typecheck** (`npx tsc --noEmit` — exit 0).

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/generation-client.ts
git commit -m "feat(upload): uploadImage client helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B4: CommandCenter attach button → active artifact

**Files:**
- Modify: `apps/web/app/components/CommandCenter.tsx`

Reuse `mediaBusyRef`/`setMediaGen` for the upload progress; on success push an inline media message and set the active artifact (the edit bar + pill from the shipped feature then apply).

- [ ] **Step 1: Import + a hidden file input ref**

Add to the generation-client import: `uploadImage`. Add a ref near `inputRef`:
```tsx
const fileInputRef = useRef<HTMLInputElement>(null);
```

- [ ] **Step 2: Add the upload handler** (near `generateImageOptions`)

```tsx
// Upload a user's own image → it becomes the active edit artifact (the edit bar
// + "Editing your visual" pill apply). No tier gate (uploads + image edits free).
async function handleImageUpload(file: File) {
  if (!file || mediaBusyRef.current) return;
  mediaBusyRef.current = true;
  setMediaGen({ kind: "image" });
  try {
    const { url, error } = await uploadImage(file);
    if (url) {
      setMessages((prev) => [...prev, { role: "assistant", content: "", media: { kind: "image", urls: [url] } }]);
      setActiveArtifact({ kind: "image", sourceUrl: url });
    } else {
      setMessages((prev) => [...prev, { role: "assistant", content: error ?? "Couldn't upload that image — try again." }]);
    }
  } finally {
    mediaBusyRef.current = false;
    setMediaGen(null);
  }
}
```

- [ ] **Step 3: Add the attach button + hidden input in the composer**

In the composer action row (where `VoiceInput` and the Send button are, ~line 1229), add before `VoiceInput`:
```tsx
<input
  ref={fileInputRef}
  type="file"
  accept="image/png,image/jpeg,image/webp"
  style={{ display: "none" }}
  onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleImageUpload(f); e.target.value = ""; }}
/>
<button
  type="button"
  aria-label="Upload an image to edit"
  onClick={() => fileInputRef.current?.click()}
  disabled={isWorking}
  className="text-xs"
  style={{ background: "transparent", border: "1px solid #2A2A38", color: "#A07BFF", borderRadius: 10, padding: "6px 9px", cursor: isWorking ? "not-allowed" : "pointer", opacity: isWorking ? 0.4 : 1 }}
>
  📎
</button>
```

- [ ] **Step 4: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; green (existing CommandCenter test still passes).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/CommandCenter.tsx
git commit -m "feat(upload): CommandCenter attach button → active edit artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task B5: DepartmentRoom attach button → setImageUrl

**Files:**
- Modify: `apps/web/app/components/DepartmentRoom.tsx`

- [ ] **Step 1: Locate the composer / input area and the image state setter**

Run: `grep -nE "setImageUrl|imageLoading|<textarea|VoiceInput|Send|task input|inputRef" app/components/DepartmentRoom.tsx | head`
Identify `setImageUrl`, `setImageError`, `imageLoading`/`setImageLoading`, and the composer action row.

- [ ] **Step 2: Add import + ref + handler**

Add `uploadImage` to the generation-client import. Add a `fileInputRef` (useRef<HTMLInputElement>(null)). Add (near the other media handlers):
```tsx
async function handleImageUpload(file: File) {
  if (!file || imageLoading) return;
  setImageError("");
  setImageLoading(true);
  try {
    const { url, error } = await uploadImage(file);
    if (url) setImageUrl(url);              // renders with its EditAffordances bar
    else setImageError(error ?? "Couldn't upload that image — try again.");
  } finally {
    setImageLoading(false);
  }
}
```
(Use the actual setter names found in Step 1; if image state is `imageLoading` without a setter exposed, use the existing pattern that `runImageGen` uses to toggle it.)

- [ ] **Step 3: Add the attach button + hidden input** in DepartmentRoom's composer action row, mirroring Task B4 Step 3 (same input + button JSX; wire onClick to `fileInputRef.current?.click()` and onChange to `handleImageUpload`). The image must render in the `department === "design"` media area (it already renders `imageUrl` there with `EditAffordances`).

> If DepartmentRoom's image media area is gated to `department === "design"`, the uploaded image will only show there. That's acceptable for v1 (Design is the visual workspace); note it in the report.

- [ ] **Step 4: Typecheck + tests + build (Tranche B gate)**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully".

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/DepartmentRoom.tsx
git commit -m "feat(upload): DepartmentRoom attach button → editable image

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## TRANCHE C — Orchestrator nudge + Download

### Task C1: Upload-intent nudge

**Files:**
- Modify: `apps/web/app/api/_lib/generation/intent-cues.ts` (add `detectUploadEditIntent`)
- Modify: `apps/web/__tests__/generation/intent-cues.test.ts` (add cases)
- Modify: `apps/web/app/components/CommandCenter.tsx` (wire the nudge in `send()`)

- [ ] **Step 1: Add failing tests for `detectUploadEditIntent`**

Append to `__tests__/generation/intent-cues.test.ts`:
```ts
import { detectUploadEditIntent } from "../../app/api/_lib/generation/intent-cues";

describe("detectUploadEditIntent", () => {
  it("true for 'edit an image I already have' phrasing", () => {
    for (const s of ["i need to upload an image and edit it", "remove the background of my image",
                     "edit my photo", "can you edit this picture", "touch up my logo"]) {
      expect(detectUploadEditIntent(s), s).toBe(true);
    }
  });
  it("false for generation / unrelated requests", () => {
    for (const s of ["make me a logo", "create an image of a sunset", "write an invoice", "design me a flyer"]) {
      expect(detectUploadEditIntent(s), s).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run → fail** (the import of `detectUploadEditIntent`).

- [ ] **Step 3: Implement `detectUploadEditIntent`** in `intent-cues.ts`

```ts
const GENERATE = /\b(make|create|generate|design|draw|build|write|produce)\b/i;
const EDIT_OWN = /\b(upload|edit|touch ?up|retouch|fix|change|crop|resize)\b.*\b(image|images|photo|picture|pic|logo|graphic|file|it|this|my)\b|\bremove (the )?background\b|\bbackground (removed|removal)\b/i;

/**
 * True when a message reads like "edit an image I already have" (so the UI can
 * nudge the user to upload) rather than a request to GENERATE a new image. The
 * caller only consults this when NO artifact is active.
 */
export function detectUploadEditIntent(text: string): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (GENERATE.test(t)) return false; // a "make/create" request is generation, not own-image edit
  return EDIT_OWN.test(t);
}
```

- [ ] **Step 4: Run → pass** (`npx vitest run __tests__/generation/intent-cues.test.ts`). Verify "remove the background of my image" → true and "make me a logo" → false.

- [ ] **Step 5: Wire the nudge in `CommandCenter.send()`**

Add `detectUploadEditIntent` to the intent-cues import. In `send()`, AFTER the `activeArtifact` edit-gate block and BEFORE the orchestrator routing, add:
```tsx
    // Upload nudge — "edit my image" with nothing to edit yet → point at the
    // attach button instead of routing to a specialist that asks for an upload.
    if (!activeArtifact && detectUploadEditIntent(content)) {
      setMessages((prev) => [...prev, { role: "user", content }, { role: "assistant", content: "Upload your image with the 📎 button below, then tell me what to change — e.g. “remove the background.”" }]);
      setInput("");
      setPhase("idle");
      return;
    }
```
(Place it so it only runs when the edit-gate did not already handle/return.)

- [ ] **Step 6: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; green.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/api/_lib/generation/intent-cues.ts apps/web/__tests__/generation/intent-cues.test.ts apps/web/app/components/CommandCenter.tsx
git commit -m "feat(upload): orchestrator upload nudge for edit-my-image with no artifact

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C2: Download consistency (per-option grid Download)

**Files:**
- Modify: `apps/web/app/components/EditAffordances.tsx`
- Test: `apps/web/__tests__/components/EditAffordances.test.tsx`

Single generated/edited/uploaded images already render with Download via the media block. The gap is the 3-up grid (owned by `EditAffordances`) — restore a Download per cell.

- [ ] **Step 1: Add a failing test** (append to the existing EditAffordances test)

```tsx
it("grid: each option exposes a Download link", () => {
  const { getAllByText } = render(
    <EditAffordances kind="image" urls={["https://x/1.png","https://x/2.png","https://x/3.png"]} onEdit={() => {}} />,
  );
  expect(getAllByText(/download/i).length).toBe(3);
});
```

- [ ] **Step 2: Run → fail** (`npx vitest run __tests__/components/EditAffordances.test.tsx`) — no Download in grid cells yet.

- [ ] **Step 3: Add a Download link inside each grid cell**

In `EditAffordances.tsx`, inside the grid `urls.map((u, idx) => ( ... ))` cell, after the `<img>`, add (keep it a sibling of the selectable button so clicks don't conflict — wrap the cell in a relative container if needed):
```tsx
              <a
                href={u} download target="_blank" rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="absolute bottom-1 right-1 px-2 py-0.5 rounded text-xs font-semibold"
                style={{ background: "rgba(13,13,22,0.85)", color: "#A07BFF", border: "1px solid #2A2A38" }}
              >
                Download
              </a>
```
The cell currently is a `<button>` containing the `<img>`. Change the cell to a relative-positioned `<div>` that contains BOTH the selectable `<button>` (the image, calling `setPicked`) AND the `<a download>` (with `stopPropagation` so downloading doesn't also select). Keep the selected-ring styling on the container based on `picked === idx`.

- [ ] **Step 4: Run → pass** (`npx vitest run __tests__/components/EditAffordances.test.tsx`) — all cases incl. the 3 Download links AND the existing select/onEdit behavior still pass. If the restructure broke the `getAllByRole("button", { name: /option/i })` selector, ensure each cell's selectable control still has `aria-label="Option N"`.

- [ ] **Step 5: Typecheck + full tests + build (Tranche C + final gate)**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: all green + "Compiled successfully".

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/components/EditAffordances.tsx apps/web/__tests__/components/EditAffordances.test.tsx
git commit -m "feat(ui): per-option Download in the visuals grid

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task C3: Final review + handoff

- [ ] **Step 1: Final full gate** from `apps/web`: `npx tsc --noEmit && npx vitest run && npx next build` — all green.
- [ ] **Step 2:** Final whole-feature review (cross-cutting: transparency pipeline correctness, public-URL/#39 on the upload route, no vendor-name leaks, nudge doesn't swallow generation requests).
- [ ] **Step 3:** Report for the operator: **the `uploaded_assets` collection must be created in prod by POSTing `/api/setup/uploaded-assets` once**, and the public-URL→muapi fetch is validated on the first real upload-edit (curl/manual).

---

## Self-Review

**Spec coverage:** §4.1 uploaded_assets → B1. §4.2 upload route → B2. §4.3 uploadImage → B3. §4.4 attach + active artifact → B4/B5. §4.5 nudge → C1. §4.6(a) enricher fix → A1; §4.6(b) wantsTransparency → A2; §4.6(c) client pipeline → A3/A4. §4.7 Download → C2 (grid) + existing media block (single). §4.8 intent-cues module → A2 + C1. §6 error handling → upload route (B2), pipeline fallback (A3 test), nudge guard (C1). §7 tests → A1,A2,A3,B2,C1,C2. §8 files → all tasks. §9 out-of-scope respected (no video upload, client-side chaining).

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the two adaptive spots (transparency-pipeline self-mock in A3, DeptRoom setter names in B5, grid cell restructure in C2) are called out with explicit guidance + a report-back, not left vague.

**Type consistency:** `wantsTransparency`, `detectUploadEditIntent`, `uploadImage`, `runGenerationWithTransparency`, `handleImageUpload`, `activeArtifact`/`setActiveArtifact` (from the shipped feature), `setImageUrl`/`setImageError` used consistently. `runGenerationWithTransparency` opts match `runGeneration` opts. The upload route returns `{ ok, url, kind }` matching `uploadImage`'s read.
