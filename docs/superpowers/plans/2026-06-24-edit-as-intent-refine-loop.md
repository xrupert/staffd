# Edit-as-Intent Refine Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer refine a finished visual ("no background + black outline", "give me variations", "add captions") by directing changes at *that specific artifact*, instead of orphaning it and producing something generic.

**Architecture:** A sibling submit route `POST /api/generation/edit` reuses the existing generation spine (whoAmI auth, `generation_jobs` ledger, webhook + `/api/generation/[id]/status` poll, inline render). A pure, client-safe edit-op classifier maps instruction words → an operation (not a model); a server-only LLM fallback covers ambiguous text. Edit-model slugs live in a new `EDIT_MODELS` routing band. The UI declares the edit target explicitly: an on-artifact edit bar, a selected-state on the 3-up grid, and an "Editing your visual ↑" composer pill — so typed refines apply only to a visibly-active artifact.

**Tech Stack:** TypeScript, Next.js App Router, vitest (no jest-dom matchers — use `el.textContent` + `.toMatch`), PocketBase REST, muapi gateway.

**Spec:** `docs/superpowers/specs/2026-06-24-edit-as-intent-refine-loop-design.md`

**The gate (run from `apps/web` before every commit):**
```
cd /c/Users/xrupe/staffd/apps/web
npx tsc --noEmit        # exit 0
npx vitest run          # all green
npx next build          # "Compiled successfully"  (run at tranche boundaries)
```

---

## File Structure

```
NEW  apps/web/app/api/_lib/generation/edit-ops.ts        pure (client-safe): EditOp, OP_KIND, ROUTE_OPS, classifyEditKeyword, EDIT_OP_SPECS
NEW  apps/web/app/api/_lib/generation/edit-ops-llm.ts    server-only: classifyEditLLM fallback (callLLM)
EDIT apps/web/app/api/_lib/generation/routing.ts         EDIT_MODELS band + routeForEdit + edit slugs in allRoutingSlugs
NEW  apps/web/app/api/generation/edit/route.ts           the edit submit route (sibling of the muapi route)
EDIT apps/web/app/api/_lib/generation/trigger-surfaces.ts register the edit route as a gated trigger
EDIT apps/web/lib/generation-client.ts                   runEdit() client driver (submit → reuse poll)
NEW  apps/web/app/components/EditAffordances.tsx         on-artifact edit bar + 3-up grid selected-state
EDIT apps/web/app/components/CommandCenter.tsx           active-artifact state + composer pill + send() edit-gate + wiring
EDIT apps/web/app/components/DepartmentRoom.tsx          edit bar parity on its inline media

NEW  apps/web/__tests__/generation/edit-ops.test.ts
NEW  apps/web/__tests__/generation/edit-ops-llm.test.ts
NEW  apps/web/__tests__/generation/edit-routing.test.ts
NEW  apps/web/__tests__/generation/edit-route.test.ts
EDIT apps/web/__tests__/generation/trigger-surfaces.test.ts
NEW  apps/web/__tests__/components/EditAffordances.test.tsx
```

Three shippable tranches: **A** backend core (no UI), **B** image edit-as-intent UI (ships the named failure fix), **C** video edit-as-intent UI + DepartmentRoom parity.

---

## TRANCHE A — Backend core

### Task 1: Pure edit-op classifier (`edit-ops.ts`)

**Files:**
- Create: `apps/web/app/api/_lib/generation/edit-ops.ts`
- Test: `apps/web/__tests__/generation/edit-ops.test.ts`

This module is **llm-free and client-safe** (imports only the `GenKind` type). It owns the operation vocabulary, the keyword classifier, and each op's muapi body shape. The server-only LLM fallback lives in a separate module (Task 2), mirroring the `intent-policy.ts` / `intent.ts` split.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/generation/edit-ops.test.ts
import { describe, it, expect } from "vitest";
import {
  classifyEditKeyword, EDIT_OP_SPECS, OP_KIND, ROUTE_OPS, type EditOp,
} from "../../app/api/_lib/generation/edit-ops";

describe("classifyEditKeyword — image", () => {
  it("pure background removal → remove_background", () => {
    expect(classifyEditKeyword("no background please", "image")?.op).toBe("remove_background");
    expect(classifyEditKeyword("make it transparent", "image")?.op).toBe("remove_background");
  });

  it("COMPOUND (bg + another edit) → single instruct_edit pass (decision 3)", () => {
    const r = classifyEditKeyword("no background + a thin black outline", "image");
    expect(r?.op).toBe("instruct_edit");
    expect(r?.editPrompt).toBe("no background + a thin black outline"); // full text preserved
  });

  it("plain instruction → instruct_edit", () => {
    expect(classifyEditKeyword("make it blue", "image")?.op).toBe("instruct_edit");
    expect(classifyEditKeyword("add a drop shadow", "image")?.op).toBe("instruct_edit");
  });

  it("variations cue → variations", () => {
    expect(classifyEditKeyword("give me more options", "image")?.op).toBe("variations");
  });

  it("non-edit text → null (falls through to normal routing)", () => {
    expect(classifyEditKeyword("what's my MRR this month", "image")).toBeNull();
    expect(classifyEditKeyword("thanks!", "image")).toBeNull();
  });
});

describe("classifyEditKeyword — video", () => {
  it("captions / trim / reorder map to their ops", () => {
    expect(classifyEditKeyword("add captions", "video")?.op).toBe("add_captions");
    expect(classifyEditKeyword("make it shorter", "video")?.op).toBe("trim");
    expect(classifyEditKeyword("reorder the clips", "video")?.op).toBe("recombine");
  });
});

describe("EDIT_OP_SPECS.buildBody — muapi body shapes", () => {
  it("remove_background → image_url only", () => {
    expect(EDIT_OP_SPECS.remove_background.buildBody("https://x/a.png", "")).toEqual({ image_url: "https://x/a.png" });
  });
  it("instruct_edit → image_url + prompt", () => {
    expect(EDIT_OP_SPECS.instruct_edit.buildBody("https://x/a.png", "make it blue")).toEqual({ image_url: "https://x/a.png", prompt: "make it blue" });
  });
  it("recombine → videos_list", () => {
    expect(EDIT_OP_SPECS.recombine.buildBody("https://x/v.mp4", "")).toEqual({ videos_list: ["https://x/v.mp4"] });
  });
});

describe("metadata", () => {
  it("ROUTE_OPS excludes variations (client-handled, never routed server-side)", () => {
    expect(ROUTE_OPS).not.toContain("variations" as EditOp);
    expect(ROUTE_OPS).toContain("instruct_edit" as EditOp);
  });
  it("OP_KIND tags every op with its source kind", () => {
    expect(OP_KIND.remove_background).toBe("image");
    expect(OP_KIND.add_captions).toBe("video");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `cd /c/Users/xrupe/staffd/apps/web && npx vitest run __tests__/generation/edit-ops.test.ts`
Expected: FAIL — `Cannot find module '../../app/api/_lib/generation/edit-ops'`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/_lib/generation/edit-ops.ts
/**
 * Edit-as-intent operation vocabulary + classifier (PURE, client-safe).
 *
 * Imports ONLY the GenKind type — no Anthropic / node deps — so both the client
 * (CommandCenter.send free-text gate) and the server (the edit route) import it.
 * The LLM fallback for ambiguous text lives in the server-only edit-ops-llm.ts,
 * mirroring the intent-policy.ts / intent.ts split.
 *
 * An "operation" is the INTENT (remove the background, refine, add captions),
 * never a model. Model resolution is routing.ts EDIT_MODELS, server-side only.
 */

import type { GenKind } from "./pricing";

export type EditOp =
  | "remove_background"
  | "instruct_edit"
  | "variations"
  | "recombine"
  | "trim"
  | "add_captions";

export type EditClassification = { op: EditOp; editPrompt: string } | null;

/** Source kind each op applies to (guards cross-kind nonsense). */
export const OP_KIND: Record<EditOp, GenKind> = {
  remove_background: "image",
  instruct_edit: "image",
  variations: "image",
  recombine: "video",
  trim: "video",
  add_captions: "video",
};

/**
 * Ops the EDIT ROUTE accepts. `variations` is deliberately excluded: it re-runs
 * the source's text prompt with new seeds (the existing generateImageOptions
 * path) and needs no source image, so the CLIENT handles it. The classifier
 * still emits it so free-text "more options" works.
 */
export const ROUTE_OPS: readonly EditOp[] = [
  "remove_background", "instruct_edit", "recombine", "trim", "add_captions",
];

/** Per-op muapi request body. submitPrediction is body-generic; field names live here only. */
export type EditOpSpec = { buildBody: (sourceUrl: string, editPrompt: string) => Record<string, unknown> };

export const EDIT_OP_SPECS: Record<EditOp, EditOpSpec> = {
  remove_background: { buildBody: (src) => ({ image_url: src }) },
  instruct_edit:     { buildBody: (src, p) => ({ image_url: src, prompt: p }) },
  // variations never reaches buildBody (client-handled) — present for completeness.
  variations:        { buildBody: (_src, p) => ({ prompt: p }) },
  recombine:         { buildBody: (src) => ({ videos_list: [src] }) },
  trim:              { buildBody: (src, p) => ({ video_url: src, prompt: p }) },
  add_captions:      { buildBody: (src, p) => ({ video_url: src, prompt: p }) },
};

const BG_REMOVAL = /\b(no background|without (a |the )?background|remove (the )?background|transparent|cut ?out|cutout|knock ?out)\b/;
// "another edit beyond background" cues — presence alongside BG_REMOVAL means COMPOUND → instruct_edit.
const OTHER_IMAGE_EDIT = /\b(outline|border|stroke|shadow|make it|change|recolou?r|add|replace|turn it|brighten|darken|crop|swap|put|color|colour|bigger|smaller|move)\b/;
const VARIATIONS = /\b(variations?|more (options|like this|versions?)|other options|different versions?|another version)\b/;

const CAPTIONS = /\b(captions?|subtitles?|text overlay)\b/;
const TRIM = /\b(trim|shorter|cut (to|down)|first \d+\s?s(econds?)?|\d+\s?seconds?)\b/;
const RECOMBINE = /\b(re-?order|combine|stitch|merge|join|sequence|rearrange)\b/;

/**
 * Synchronous keyword classifier. Returns null when the text is not edit-shaped
 * (caller falls through to normal routing). Used by BOTH the client send-gate
 * and the server route's first pass.
 */
export function classifyEditKeyword(instruction: string, sourceKind: GenKind): EditClassification {
  const text = (instruction ?? "").trim();
  if (!text) return null;
  const t = text.toLowerCase();

  if (sourceKind === "image") {
    if (VARIATIONS.test(t)) return { op: "variations", editPrompt: text };
    const bg = BG_REMOVAL.test(t);
    const other = OTHER_IMAGE_EDIT.test(t);
    if (bg && !other) return { op: "remove_background", editPrompt: text }; // pure bg removal
    if (bg && other) return { op: "instruct_edit", editPrompt: text };       // COMPOUND → one pass (decision 3)
    if (other) return { op: "instruct_edit", editPrompt: text };
    return null;
  }

  if (CAPTIONS.test(t)) return { op: "add_captions", editPrompt: text };
  if (TRIM.test(t)) return { op: "trim", editPrompt: text };
  if (RECOMBINE.test(t)) return { op: "recombine", editPrompt: text };
  return null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/generation/edit-ops.test.ts`
Expected: PASS (all cases). Confirms "no background + black outline" → `instruct_edit` with full text.

- [ ] **Step 5: Commit**

```bash
cd /c/Users/xrupe/staffd
git add apps/web/app/api/_lib/generation/edit-ops.ts apps/web/__tests__/generation/edit-ops.test.ts
git commit -m "feat(generation): pure edit-op classifier (keyword + op specs)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Server-only LLM fallback (`edit-ops-llm.ts`)

**Files:**
- Create: `apps/web/app/api/_lib/generation/edit-ops-llm.ts`
- Test: `apps/web/__tests__/generation/edit-ops-llm.test.ts`

When the keyword pass returns null but the route was reached with an active artifact, an ambiguous instruction ("brighten the mood a touch", "lose the busy bits") may still be an edit. This server-only fallback asks the LLM to map it to a `ROUTE_OPS` op or null. Reuses `callLLM` (no new Anthropic call-site pattern).

- [ ] **Step 1: Write the failing test** (mock `callLLM`)

```ts
// apps/web/__tests__/generation/edit-ops-llm.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const callLLM = vi.fn();
vi.mock("../../app/api/_lib/orchestrator/llm", () => ({ callLLM: (...a: unknown[]) => callLLM(...a) }));

import { classifyEditLLM } from "../../app/api/_lib/generation/edit-ops-llm";

beforeEach(() => callLLM.mockReset());

describe("classifyEditLLM", () => {
  it("maps an ambiguous image instruction to an op", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":"instruct_edit"}' });
    const r = await classifyEditLLM("lose the busy bits in the corner", "image");
    expect(r).toEqual({ op: "instruct_edit", editPrompt: "lose the busy bits in the corner" });
  });

  it("returns null when the model says it's not an edit", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":null}' });
    expect(await classifyEditLLM("how do refunds work", "image")).toBeNull();
  });

  it("never returns a non-ROUTE op (e.g. variations) from the LLM", async () => {
    callLLM.mockResolvedValue({ ok: true, text: '{"op":"variations"}' });
    expect(await classifyEditLLM("hmm", "image")).toBeNull();
  });

  it("returns null on LLM failure (fail-safe → normal routing)", async () => {
    callLLM.mockResolvedValue({ ok: false });
    expect(await classifyEditLLM("anything", "image")).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/generation/edit-ops-llm.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/_lib/generation/edit-ops-llm.ts
/**
 * Server-only LLM fallback for ambiguous edit instructions (W: edit-as-intent).
 * Runs only when classifyEditKeyword returned null but the request reached the
 * edit route with an active artifact. Maps free text → a ROUTE op or null.
 * Fail-safe: any error/ambiguity → null, so the caller falls back to normal
 * routing rather than mis-editing.
 */

import { callLLM } from "../orchestrator/llm";
import { ROUTE_OPS, type EditClassification, type EditOp } from "./edit-ops";
import type { GenKind } from "./pricing";

const ROUTE_SET = new Set<string>(ROUTE_OPS);

function systemFor(kind: GenKind): string {
  const ops = kind === "image"
    ? "remove_background, instruct_edit (any other change to the image)"
    : "recombine, trim, add_captions";
  return `You decide whether a message is an instruction to EDIT an existing ${kind} the user is looking at, and which operation it is.
Valid ops for a ${kind}: ${ops}.
Return STRICT JSON only: {"op":"<one of the ops>"} if it is clearly an edit of the current ${kind}, otherwise {"op":null}.
A question, a new request, or small talk is NOT an edit → {"op":null}.`;
}

export async function classifyEditLLM(instruction: string, sourceKind: GenKind): Promise<EditClassification> {
  const text = (instruction ?? "").trim();
  if (!text) return null;

  const res = await callLLM({
    intent: "route",
    system: systemFor(sourceKind),
    messages: [{ role: "user", content: text }],
  });
  if (!res.ok) return null;

  try {
    const json = res.text.slice(res.text.indexOf("{"), res.text.lastIndexOf("}") + 1);
    const op = (JSON.parse(json) as { op?: string | null }).op;
    if (typeof op === "string" && ROUTE_SET.has(op)) return { op: op as EditOp, editPrompt: text };
  } catch {
    return null;
  }
  return null;
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/generation/edit-ops-llm.test.ts`
Expected: PASS. Note the third case proves a non-ROUTE op from the LLM (`variations`) is rejected to null.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/_lib/generation/edit-ops-llm.ts apps/web/__tests__/generation/edit-ops-llm.test.ts
git commit -m "feat(generation): server-only LLM fallback for ambiguous edit text

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Edit-model routing band (`routing.ts`)

**Files:**
- Modify: `apps/web/app/api/_lib/generation/routing.ts`
- Test: `apps/web/__tests__/generation/edit-routing.test.ts`

Add `EDIT_MODELS` (op → ordered slug preference), `routeForEdit(op)`, and fold the edit slugs into `allRoutingSlugs()` so the hourly `validateRoutingSlugs` catalog check covers them too.

> **Verification step (do during this task):** confirm each slug below has a live `POST /api/v1/<slug>` with the body fields used in `EDIT_OP_SPECS`, against the muapi OpenAPI (see `docs/operator-runbooks/muapi-vendor-drift.md`). These are the intended slugs from the roadmap; treat any miss exactly like the existing "catalog-pending" routing slugs — fix the slug, not the design.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/__tests__/generation/edit-routing.test.ts
import { describe, it, expect } from "vitest";
import { routeForEdit, allRoutingSlugs } from "../../app/api/_lib/generation/routing";
import { ROUTE_OPS } from "../../app/api/_lib/generation/edit-ops";

describe("routeForEdit", () => {
  it("every routable op resolves to at least one slug", () => {
    for (const op of ROUTE_OPS) {
      expect(routeForEdit(op).length, `op ${op} has no slug`).toBeGreaterThan(0);
    }
  });
  it("instruct_edit prefers the instruction-edit model", () => {
    expect(routeForEdit("instruct_edit")[0]).toBe("nano-banana-pro-edit");
  });
  it("video ops route to the combiner / captioner", () => {
    expect(routeForEdit("recombine")).toContain("video-combiner");
    expect(routeForEdit("add_captions")).toContain("motion-graphics-edit");
  });
});

describe("allRoutingSlugs", () => {
  it("includes the edit slugs (so validateRoutingSlugs guards them)", () => {
    const slugs = allRoutingSlugs();
    expect(slugs).toContain("nano-banana-pro-edit");
    expect(slugs).toContain("video-combiner");
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/generation/edit-routing.test.ts`
Expected: FAIL — `routeForEdit` is not exported.

- [ ] **Step 3: Write the implementation** — add to `routing.ts`

After the `import { defaultTierFor, type GenKind, type Tier } from "./pricing";` line, add:

```ts
import type { EditOp } from "./edit-ops";
```

After the `DEFAULT_MODELS` declaration (before `ROUTING`), add:

```ts
/**
 * Edit-as-intent model band — op → ordered slug preference. Same swappable-
 * registry pattern as DEFAULT_MODELS; resolved server-side only (slugs never
 * reach the client). `variations` is intentionally absent (client re-gen path).
 * Slugs verified against the live muapi OpenAPI; body field names live in
 * edit-ops.ts EDIT_OP_SPECS.
 */
const EDIT_MODELS: Partial<Record<EditOp, string[]>> = {
  remove_background: ["remove-background", "birefnet-v2"],
  instruct_edit:     ["nano-banana-pro-edit", "flux-2-pro-edit"],
  recombine:         ["video-combiner"],
  trim:              ["video-combiner"],
  add_captions:      ["motion-graphics-edit"],
};

/** Ordered model preference for an edit op (empty for client-handled ops). */
export function routeForEdit(op: EditOp): string[] {
  return EDIT_MODELS[op] ?? [];
}
```

Then, inside `allRoutingSlugs()`, before `return [...slugs];`, add the edit slugs:

```ts
  for (const list of Object.values(EDIT_MODELS)) list?.forEach((s) => slugs.add(s));
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/generation/edit-routing.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the existing routing/catalog tests to confirm no regression**

Run: `npx vitest run __tests__/generation/`
Expected: all green (existing routing tests still pass; `allRoutingSlugs` just grew).

- [ ] **Step 6: Commit**

```bash
git add apps/web/app/api/_lib/generation/routing.ts apps/web/__tests__/generation/edit-routing.test.ts
git commit -m "feat(generation): EDIT_MODELS routing band + routeForEdit

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Edit submit route (`/api/generation/edit`)

**Files:**
- Create: `apps/web/app/api/generation/edit/route.ts`
- Test: `apps/web/__tests__/generation/edit-route.test.ts`

Mirrors the muapi route's spine: whoAmI auth (#39 — identity from token, never a body userId), classify op (keyword then LLM), resolve slug, build the per-op body, credit pre-flight for video (image = weight 0), submit, create a `generation_jobs` row (polled by the existing status endpoint), fast-path complete when muapi returns the URL on submit.

- [ ] **Step 1: Write the failing test** (mock the IO boundaries)

```ts
// apps/web/__tests__/generation/edit-route.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const whoAmI = vi.fn();
const submitPrediction = vi.fn();
const tryExtractOutputUrl = vi.fn();
const createJob = vi.fn();
const completeJob = vi.fn();
const getCreditState = vi.fn();
const trySuperAdminByUserId = vi.fn();

vi.mock("../../app/api/_lib/integrations/identity", () => ({ whoAmI: (...a: unknown[]) => whoAmI(...a) }));
vi.mock("../../app/api/_lib/integrations/muapi/predictions", () => ({
  submitPrediction: (...a: unknown[]) => submitPrediction(...a),
  tryExtractOutputUrl: (...a: unknown[]) => tryExtractOutputUrl(...a),
  buildWebhookUrl: () => null,
}));
vi.mock("../../app/api/_lib/generation/jobs", () => ({
  createJob: (...a: unknown[]) => createJob(...a),
  completeJob: (...a: unknown[]) => completeJob(...a),
  fingerprintFor: () => "fp",
  findInflightByFingerprint: async () => null,
}));
vi.mock("../../app/api/_lib/credits", () => ({ getCreditState: (...a: unknown[]) => getCreditState(...a) }));
vi.mock("../../app/api/_lib/auth/super-admin", () => ({ trySuperAdminByUserId: (...a: unknown[]) => trySuperAdminByUserId(...a) }));
vi.mock("../../app/api/_lib/pb", () => ({ getAdminToken: async () => "admin-token" }));

import { POST } from "../../app/api/generation/edit/route";

function req(body: unknown) {
  return new Request("http://localhost/api/generation/edit", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "tok" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MUAPI_API_KEY = "k";
  process.env.NEXT_PUBLIC_POCKETBASE_URL = "http://pb";
  whoAmI.mockResolvedValue({ id: "u1", email: "u@x.com" });
  trySuperAdminByUserId.mockResolvedValue(null);
  getCreditState.mockResolvedValue({ totalRemaining: { image: 100, video: 100 }, monthlyAllowance: { image: 100, video: 100 }, plan: "pro" });
  createJob.mockResolvedValue("job1");
  submitPrediction.mockResolvedValue({ id: "pred1" });
  tryExtractOutputUrl.mockReturnValue(null);
});

describe("POST /api/generation/edit", () => {
  it("401 without a session (Standard #39 — identity from token, not body)", async () => {
    whoAmI.mockResolvedValue(null);
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    expect(res.status).toBe(401);
  });

  it("400 when sourceUrl is missing", async () => {
    const res = await POST(req({ kind: "image", instruction: "make it blue" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("source_required");
  });

  it("image edit: routes instruct_edit slug, image_url+prompt body, weight 0, creates a job", async () => {
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "no background + black outline" }));
    expect(res.status).toBe(202);
    const [slug, body] = submitPrediction.mock.calls[0];
    expect(slug).toBe("nano-banana-pro-edit");          // compound → instruct_edit
    expect(body).toMatchObject({ image_url: "https://x/a.png", prompt: "no background + black outline" });
    expect(createJob).toHaveBeenCalledWith("http://pb", "admin-token", expect.objectContaining({ kind: "image", credit_weight: 0 }));
  });

  it("pure 'no background' → remove_background slug + image_url-only body", async () => {
    await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "remove the background" }));
    const [slug, body] = submitPrediction.mock.calls[0];
    expect(slug).toBe("remove-background");
    expect(body).toEqual(expect.objectContaining({ image_url: "https://x/a.png" }));
    expect(body).not.toHaveProperty("prompt");
  });

  it("video edit charges the tier weight (metered) and gates out-of-credits", async () => {
    getCreditState.mockResolvedValue({ totalRemaining: { image: 100, video: 0 }, monthlyAllowance: { image: 100, video: 50 }, plan: "pro" });
    const res = await POST(req({ kind: "video", sourceUrl: "https://x/v.mp4", instruction: "add captions", tier: "pro" }));
    expect(res.status).toBe(402);
    expect((await res.json()).error).toBe("out_of_credits");
    expect(submitPrediction).not.toHaveBeenCalled();
  });

  it("non-edit text with no resolvable op → 422 not_an_edit (caller falls back to normal routing)", async () => {
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "what is my MRR" }));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("not_an_edit");
  });

  it("fast path: muapi returns a URL on submit → completed + charged once", async () => {
    tryExtractOutputUrl.mockReturnValue("https://out/edited.png");
    completeJob.mockResolvedValue({ status: "completed", url: "https://out/edited.png", remaining: "unlimited" });
    const res = await POST(req({ kind: "image", sourceUrl: "https://x/a.png", instruction: "make it blue" }));
    const data = await res.json();
    expect(data).toMatchObject({ success: true, status: "completed", url: "https://out/edited.png" });
    expect(completeJob).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/generation/edit-route.test.ts`
Expected: FAIL — route module not found.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/app/api/generation/edit/route.ts
/**
 * POST /api/generation/edit — edit-as-intent submit route.
 * Body: { kind: "image"|"video", sourceUrl, instruction, tier?, department? }
 *
 * Sibling of /api/integrations/muapi (text-to-X). Same spine: whoAmI auth
 * (Standard #39), credit gate (video metered, image weight 0), generation_jobs
 * ledger (polled by /api/generation/[id]/status), webhook + fast path. Differs
 * only in resolution: classify the instruction → an edit OP → a model slug +
 * per-op body (no prompt enrichment; the source artifact carries the content).
 *
 * Standard #38: registered in trigger-surfaces.ts; the UI surface gates video
 * edits through GenerationTierInline before calling this.
 */

import { getCreditState } from "../../_lib/credits";
import { trySuperAdminByUserId } from "../../_lib/auth/super-admin";
import { getAdminToken } from "../../_lib/pb";
import { submitPrediction, tryExtractOutputUrl, buildWebhookUrl } from "../../_lib/integrations/muapi/predictions";
import { createJob, completeJob, fingerprintFor, findInflightByFingerprint, type GenJob } from "../../_lib/generation/jobs";
import { defaultTierFor, tierWeight, type Tier } from "../../_lib/generation/pricing";
import { routeForEdit } from "../../_lib/generation/routing";
import { classifyEditKeyword, EDIT_OP_SPECS, OP_KIND, ROUTE_OPS, type EditClassification } from "../../_lib/generation/edit-ops";
import { classifyEditLLM } from "../../_lib/generation/edit-ops-llm";
import { whoAmI } from "../../_lib/integrations/identity";

const MUAPI_KEY = process.env.MUAPI_API_KEY ?? "";
const ROUTE_SET = new Set<string>(ROUTE_OPS);

export async function POST(req: Request) {
  if (!MUAPI_KEY) {
    return Response.json({ error: "not_configured", message: "Image / video editing is not set up yet." }, { status: 503 });
  }
  const pbUrl = process.env.NEXT_PUBLIC_POCKETBASE_URL;
  if (!pbUrl) return Response.json({ error: "Service unavailable" }, { status: 503 });

  try {
    const { kind, sourceUrl, instruction, tier: reqTier, department } = (await req.json()) as {
      kind: "image" | "video"; sourceUrl?: string; instruction?: string; tier?: string; department?: string;
    };

    const me = await whoAmI(req);
    if (!me) return Response.json({ error: "unauthorized" }, { status: 401 });
    const userId = me.id;

    if (kind !== "image" && kind !== "video") return Response.json({ error: "kind must be 'image' or 'video'" }, { status: 400 });
    if (!sourceUrl?.trim()) return Response.json({ error: "source_required" }, { status: 400 });
    if (!instruction?.trim()) return Response.json({ error: "instruction is required" }, { status: 400 });

    // Classify: keyword first (free), LLM fallback for ambiguous text. variations
    // never routes here (client re-gen path) — treat as not_an_edit if it leaks.
    let cls: EditClassification = classifyEditKeyword(instruction, kind);
    if (!cls) cls = await classifyEditLLM(instruction, kind);
    if (!cls || !ROUTE_SET.has(cls.op) || OP_KIND[cls.op] !== kind) {
      return Response.json({ error: "not_an_edit" }, { status: 422 });
    }
    const { op, editPrompt } = cls;

    // Tier + credit weight. Images unmetered (weight 0). Video metered at the
    // selected tier weight (gated through GenerationTierInline by the surface).
    const dept = department ?? "";
    const tier: Tier = (["quick", "pro", "premium"].includes(reqTier ?? "") ? reqTier : defaultTierFor(dept, kind)) as Tier;
    const creditWeight = kind === "image" ? 0 : tierWeight(kind, tier);

    const superAdmin = await trySuperAdminByUserId(userId);
    const preState = superAdmin ? null : await getCreditState(pbUrl, userId);
    if (preState && preState.totalRemaining[kind] < creditWeight) {
      return Response.json(
        { error: "out_of_credits", message: `This ${kind} edit costs ${creditWeight} credits — you have ${preState.totalRemaining[kind]}.`, remaining: preState.totalRemaining[kind], required: creditWeight, plan: preState.plan },
        { status: 402 },
      );
    }

    // Resolve the edit slug (op → ordered preference). routing_unresolved if none.
    const slug = routeForEdit(op)[0];
    if (!slug) return Response.json({ error: "routing_unresolved", op }, { status: 500 });

    let adminToken: string;
    try { adminToken = await getAdminToken(); } catch { return Response.json({ error: "Service unavailable" }, { status: 503 }); }

    // Submit-time dedup (margin protection — muapi debits on completion).
    const fingerprint = fingerprintFor(userId, kind, `edit:${op}:${sourceUrl}:${editPrompt}`, "", "");
    const dupId = await findInflightByFingerprint(pbUrl, adminToken, fingerprint);
    if (dupId) return Response.json({ success: true, jobId: dupId, status: "pending", deduped: true }, { status: 202 });

    const body = EDIT_OP_SPECS[op].buildBody(sourceUrl, editPrompt);

    const appBase = process.env.NEXT_PUBLIC_APP_URL ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
    const webhookUrl = buildWebhookUrl(appBase);

    const submission = await submitPrediction(slug, body, webhookUrl);
    const predictionId = submission.id ?? submission.request_id ?? "";

    const jobId = await createJob(pbUrl, adminToken, {
      user: userId, kind, model: slug, prompt: editPrompt, aspect_ratio: "", prediction_id: predictionId,
      fingerprint, tier, credit_weight: creditWeight, muapi_model: slug,
    });
    if (!jobId) return Response.json({ error: "Could not start the edit" }, { status: 502 });

    const immediateUrl = tryExtractOutputUrl(submission);
    if (immediateUrl) {
      const job: GenJob = { id: jobId, user: userId, kind, status: "pending", model: slug, prediction_id: predictionId, tier, credit_weight: creditWeight, muapi_model: slug };
      const done = await completeJob(pbUrl, adminToken, job, immediateUrl, superAdmin);
      return Response.json({ success: true, jobId, status: "completed", url: done.url, op, remaining: done.remaining, ...(done.creditWarning ? { creditWarning: done.creditWarning } : {}) });
    }

    return Response.json({ success: true, jobId, status: "pending", op }, { status: 202 });
  } catch (err) {
    console.error("Edit route error:", err);
    const msg = err instanceof Error ? err.message : "Failed to edit";
    return Response.json({ error: "Edit failed", detail: msg }, { status: 502 });
  }
}
```

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/generation/edit-route.test.ts`
Expected: PASS (all 7 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/generation/edit/route.ts apps/web/__tests__/generation/edit-route.test.ts
git commit -m "feat(generation): POST /api/generation/edit (edit-as-intent submit route)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Register the edit route as a gated trigger (Standard #38)

**Files:**
- Modify: `apps/web/app/api/_lib/generation/trigger-surfaces.ts`
- Modify: `apps/web/__tests__/generation/trigger-surfaces.test.ts`

The edit route can start a paid (video) generation, so the surfaces that call it must be registered. The two surfaces are the same components that already generate — CommandCenter (inline gate) and DepartmentRoom (modal gate). The guard test fails CI on any `runGeneration`/`runEdit` call site not listed.

- [ ] **Step 1: Read the existing guard test to learn its exact assertion shape**

Run: `sed -n '1,80p' __tests__/generation/trigger-surfaces.test.ts`
Note whether it scans for `runGeneration` only or a configurable set, and how it reads `GENERATION_TRIGGER_SURFACES`. Adapt the edits in Step 3/4 to match its real assertions (the snippets below assume it iterates the registry and greps each `file` for its `gate`, and separately greps for stray trigger call-sites).

- [ ] **Step 2: Update the guard test to also recognise `runEdit` as a trigger call**

In `trigger-surfaces.test.ts`, find the regex/string that detects trigger call sites (currently matches `runGeneration`) and broaden it to both drivers. Example edit:

```ts
const TRIGGER_CALL = /\brun(Generation|Edit)\s*\(/;
```

If the test lists expected surfaces, no new file is added (both `runEdit` call sites live in the already-listed CommandCenter and DepartmentRoom), so the registry size is unchanged — the assertion that every call-site file is registered must now also pass for `runEdit`.

- [ ] **Step 3: Run the test, verify it fails** (after Tranche B/C wire `runEdit` in; until then it stays green)

Run: `npx vitest run __tests__/generation/trigger-surfaces.test.ts`
Expected at THIS task: PASS (no `runEdit` call sites exist yet; the broadened regex matches nothing new). This task pre-broadens the guard so Tranche B doesn't trip it. Re-run after Task 8.

- [ ] **Step 4: Add a clarifying comment to the registry**

In `trigger-surfaces.ts`, extend the header comment of `GENERATION_TRIGGER_SURFACES`:

```ts
// Surfaces call runGeneration (text-to-X) and/or runEdit (edit-as-intent). Both
// are paid-generation triggers; a video edit must mount its listed gate before
// submitting, same as a video generation.
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/api/_lib/generation/trigger-surfaces.ts apps/web/__tests__/generation/trigger-surfaces.test.ts
git commit -m "chore(generation): guard recognises runEdit as a paid trigger (Standard #38)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 6: Tranche A gate**

Run:
```
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: tsc exit 0; all tests green; "Compiled successfully". Tranche A complete — the edit API is live and tested.

---

## TRANCHE B — Image edit-as-intent UI (ships the named failure fix)

### Task 6: `runEdit` client driver

**Files:**
- Modify: `apps/web/lib/generation-client.ts`

Add `runEdit` — submit to `/api/generation/edit`, then reuse the SAME polling loop as `runGeneration` (edit jobs are ordinary `generation_jobs` rows polled by `/api/generation/[id]/status`). Refactor the shared poll into a helper so both drivers use it (DRY).

- [ ] **Step 1: Extract the shared poll helper**

In `generation-client.ts`, after the `runGeneration` function, extract the polling loop (the `for (let i = 0; i < MAX_POLLS; i++)` block) into:

```ts
async function pollJob(jobId: string, shouldCancel?: () => boolean): Promise<GenOutcome> {
  for (let i = 0; i < MAX_POLLS; i++) {
    if (shouldCancel?.()) return { error: "cancelled" };
    await new Promise((r) => setTimeout(r, POLL_MS));
    if (shouldCancel?.()) return { error: "cancelled" };
    let sres: Response;
    try {
      sres = await fetch(`/api/generation/${encodeURIComponent(jobId)}/status`, { headers: { Authorization: pb.authStore.token } });
    } catch { continue; }
    const sdata = (await sres.json().catch(() => ({}))) as StatusResponse;
    if (sdata.status === "completed" && sdata.url) return { url: sdata.url };
    if (sdata.status === "failed") return { error: sdata.error ?? "Generation failed." };
  }
  return { error: "Generation is taking longer than expected — check back in a moment." };
}
```

Then replace the inline loop in `runGeneration` with `return pollJob(jobId, shouldCancel);`.

- [ ] **Step 2: Add `runEdit`**

```ts
/**
 * runEdit — submit an edit-as-intent op against an existing artifact, then reuse
 * the shared status poll (edit jobs are ordinary generation_jobs rows). The
 * server classifies the instruction → op → model; the client only declares the
 * source artifact + instruction (+ tier for video edits).
 */
export async function runEdit(
  opts: { kind: GenKind; sourceUrl: string; instruction: string; tier?: string; department?: string },
  shouldCancel?: () => boolean,
): Promise<GenOutcome> {
  let res: Response;
  try {
    res = await fetch("/api/generation/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: pb.authStore.token },
      body: JSON.stringify(opts),
    });
  } catch (e) {
    return { error: `Couldn't reach the edit service: ${e instanceof Error ? e.message : String(e)}` };
  }
  const data = (await res.json().catch(() => ({}))) as SubmitResponse & { error?: string };
  if (res.status === 422) return { error: "not_an_edit" }; // caller falls back to normal routing
  if (!res.ok && res.status !== 202 && !data.jobId) {
    return { error: data.message ?? data.detail ?? data.error ?? "Couldn't apply that edit — try again." };
  }
  if (data.status === "completed" && data.url) return { url: data.url };
  const jobId = data.jobId;
  if (!jobId) return { error: "Couldn't start the edit — try again." };
  return pollJob(jobId, shouldCancel);
}
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/generation-client.ts
git commit -m "feat(generation): runEdit client driver (shared poll with runGeneration)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: `EditAffordances` component (on-artifact edit bar + grid select)

**Files:**
- Create: `apps/web/app/components/EditAffordances.tsx`
- Test: `apps/web/__tests__/components/EditAffordances.test.tsx`

A presentational component: renders the edit bar for a media message. For a multi-image grid it owns the selected-index state and only shows the bar once an option is picked. Emits `(op, instruction)` to the parent via `onEdit`. No network here — the parent owns `runEdit`.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/__tests__/components/EditAffordances.test.tsx
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import EditAffordances from "../../app/components/EditAffordances";

describe("EditAffordances", () => {
  it("single image: shows the image edit bar immediately", () => {
    const { container } = render(<EditAffordances kind="image" urls={["https://x/a.png"]} onEdit={() => {}} />);
    expect(container.textContent).toMatch(/Remove background/);
    expect(container.textContent).toMatch(/Variations/);
    expect(container.textContent).toMatch(/Refine/);
  });

  it("3-up grid: hides the bar until an option is selected, then targets it", () => {
    const onEdit = vi.fn();
    const { container, getAllByRole } = render(
      <EditAffordances kind="image" urls={["https://x/1.png", "https://x/2.png", "https://x/3.png"]} onEdit={onEdit} />,
    );
    expect(container.textContent).not.toMatch(/Remove background/); // no pick yet
    const cells = getAllByRole("button", { name: /option/i });
    fireEvent.click(cells[1]); // pick option 2
    expect(container.textContent).toMatch(/Remove background/);
    fireEvent.click(getAllByRole("button", { name: /Remove background/i })[0]);
    expect(onEdit).toHaveBeenCalledWith("remove_background", "remove the background", "https://x/2.png");
  });

  it("video: shows reorder / trim / captions", () => {
    const { container } = render(<EditAffordances kind="video" urls={["https://x/v.mp4"]} onEdit={() => {}} />);
    expect(container.textContent).toMatch(/Reorder/);
    expect(container.textContent).toMatch(/Trim/);
    expect(container.textContent).toMatch(/captions/i);
  });
});
```

- [ ] **Step 2: Run the test, verify it fails**

Run: `npx vitest run __tests__/components/EditAffordances.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Write the implementation**

```tsx
// apps/web/app/components/EditAffordances.tsx
"use client";

import { useState } from "react";
import type { EditOp } from "../api/_lib/generation/edit-ops";

/**
 * On-artifact edit bar (edit-as-intent). Presentational: declares the edit
 * target and emits (op, instruction, sourceUrl) to the parent, which owns the
 * runEdit call + active-artifact state. For a multi-image grid it owns the
 * selected-index (a refine needs an explicit pick — Law of Common Region).
 *
 * `Refine…` is the free-text entry: it asks the parent to focus the composer
 * with this artifact as the active target (op resolved server-side from text),
 * so it emits the sentinel op "refine".
 */

type Chip = { op: EditOp | "refine"; label: string; icon: string; instruction: string };

const IMAGE_CHIPS: Chip[] = [
  { op: "remove_background", label: "Remove background", icon: "🫥", instruction: "remove the background" },
  { op: "variations",       label: "Variations",        icon: "🔀", instruction: "give me variations" },
  { op: "refine",           label: "Refine…",           icon: "✦",  instruction: "" },
];
const VIDEO_CHIPS: Chip[] = [
  { op: "recombine",    label: "Reorder",      icon: "🔀", instruction: "reorder the clips" },
  { op: "trim",         label: "Trim",         icon: "✂️", instruction: "make it shorter" },
  { op: "add_captions", label: "Add captions", icon: "🔤", instruction: "add captions" },
];

export default function EditAffordances({
  kind, urls, onEdit,
}: {
  kind: "image" | "video";
  urls: string[];
  /** op "refine" → focus the composer for free text; otherwise apply directly. */
  onEdit: (op: EditOp | "refine", instruction: string, sourceUrl: string) => void;
}) {
  const isGrid = kind === "image" && urls.length > 1;
  const [picked, setPicked] = useState<number | null>(isGrid ? null : 0);
  const chips = kind === "image" ? IMAGE_CHIPS : VIDEO_CHIPS;
  const sourceUrl = picked != null ? urls[picked] : undefined;

  return (
    <div>
      {isGrid && (
        <div className="grid grid-cols-3 gap-1 p-1">
          {urls.map((u, idx) => (
            <button
              key={idx}
              type="button"
              aria-label={`Option ${idx + 1}`}
              onClick={() => setPicked(idx)}
              style={{
                padding: 0, border: picked === idx ? "2px solid #A07BFF" : "1px solid #2A2A38",
                borderRadius: 8, overflow: "hidden", background: "#0D0D16", cursor: "pointer",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={u} alt={`Option ${idx + 1}`} style={{ display: "block", width: "100%", height: "auto", maxHeight: 220, objectFit: "contain" }} />
            </button>
          ))}
        </div>
      )}

      {sourceUrl && (
        <div className="flex flex-wrap gap-2 px-2 py-2" style={{ borderTop: "1px solid #1E1E2A" }}>
          {isGrid && <span className="text-xs self-center" style={{ color: "#7070A0" }}>Editing option {(picked ?? 0) + 1} —</span>}
          {chips.map((c) => (
            <button
              key={c.op}
              type="button"
              aria-label={c.label}
              onClick={() => onEdit(c.op, c.instruction, sourceUrl)}
              className="inline-flex items-center gap-1 text-xs"
              style={{ padding: "5px 9px", borderRadius: 8, border: "1px solid #2A2A38", color: "#D0D0E8", background: "transparent", cursor: "pointer" }}
            >
              <span aria-hidden="true">{c.icon}</span>{c.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

> Note: `🫥` etc. are decorative chip glyphs inside the product (STAFFD UI, not the visualize host), consistent with the existing `ACTION_UI` icon style in `action-vocabulary.ts`. Keep them or swap for the project's icon set if one is in use in `app/components`.

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run __tests__/components/EditAffordances.test.tsx`
Expected: PASS (3 cases).

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/components/EditAffordances.tsx apps/web/__tests__/components/EditAffordances.test.tsx
git commit -m "feat(ui): EditAffordances — on-artifact edit bar + 3-up grid select

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Wire image edit-as-intent into CommandCenter

**Files:**
- Modify: `apps/web/app/components/CommandCenter.tsx`

Add the active-artifact state, mount `EditAffordances` under each media message, add the composer pill, and gate `send()` so a typed instruction with an active target routes to `runEdit` instead of the orchestrator. Image only in this tranche (video-edit chips render but route through the video path added in Tranche C; until then, image is fully wired).

- [ ] **Step 1: Add state + the apply-edit handler**

Near the other generation state (around `const [mediaGen, setMediaGen] = useState…`, line ~228), add:

```tsx
// Edit-as-intent — the visibly-active edit target (declared by selecting/acting
// on a rendered visual). While set, the composer shows the "Editing your visual"
// pill and a typed instruction routes to runEdit, not the orchestrator.
const [activeArtifact, setActiveArtifact] = useState<{ kind: "image" | "video"; sourceUrl: string } | null>(null);
```

Add the import at the top with the other component imports:

```tsx
import EditAffordances from "./EditAffordances";
import { runEdit } from "../../lib/generation-client";
import { classifyEditKeyword } from "../api/_lib/generation/edit-ops";
```

Add the handler near `generateImageOptions` (line ~426):

```tsx
// Apply an edit-as-intent op to an artifact. op "refine" just focuses the
// composer with this artifact active (free-text path); "variations" reuses the
// existing re-gen grid; everything else hits runEdit.
async function applyEdit(op: string, instruction: string, sourceUrl: string, kind: "image" | "video") {
  setActiveArtifact({ kind, sourceUrl });
  if (op === "refine") { inputRef.current?.focus(); return; }
  if (op === "variations") { void generateImageOptions(); return; }
  if (mediaBusyRef.current) return;
  mediaBusyRef.current = true;
  setMediaGen({ kind });
  try {
    const { url, error } = await runEdit({ kind, sourceUrl, instruction });
    if (url) {
      setMessages((prev) => [...prev, { role: "assistant", content: "", media: { kind, urls: [url] } }]);
      setActiveArtifact({ kind, sourceUrl: url }); // the edited result is the new target → the loop
    } else {
      setMessages((prev) => [...prev, { role: "assistant", content: error ?? "Couldn't apply that edit — try again." }]);
    }
  } finally {
    mediaBusyRef.current = false;
    setMediaGen(null);
  }
}
```

> If `inputRef` does not exist, add `const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);` and attach it to the composer input. Confirm the composer input element name in the JSX (search for the `<input`/`<textarea` the user types into) and add `ref={inputRef}`.

- [ ] **Step 2: Mount `EditAffordances` under the media render**

In the `if (msg.media) { … }` block (the `return (<div … >` that renders image/video, ending ~line 1006), insert `EditAffordances` just before that block's closing `</div>`:

```tsx
              <EditAffordances
                kind={kind}
                urls={urls}
                onEdit={(op, instruction, sourceUrl) => void applyEdit(op, instruction, sourceUrl, kind)}
              />
```

For a single image/video the component renders the bar directly; for the grid it renders the picker + bar. Remove the now-duplicated inline `<img>`/grid only if `EditAffordances` fully owns the visual — to keep this step low-risk, KEEP the existing render and let `EditAffordances` render only the chip bar for the single case and the picker+bar for the grid (the component already guards with `isGrid`). To avoid a double image in the grid case, pass a `renderImages={false}` prop OR (simpler) move the existing grid markup into `EditAffordances` and have the media block render only the header + `<EditAffordances/>`. Choose the move: delete the inline `kind === "image" ? (<grid/single img>) : (<video>)` body and let `EditAffordances` render images for `image`, while video stays inline with the bar appended. Keep the Download affordance by adding it inside `EditAffordances` cells (port the existing `<a download>`).

> This is the one fiddly integration point. Verify by eye in the running app (Step 6) that: single image shows one image + bar; grid shows three + picker; video shows the player + bar; Download still works.

- [ ] **Step 3: Add the composer pill above the input**

Find the composer container (search for the `<input`/send button near the bottom, around the `CommandCenterSuggestions`/input area). Immediately above the input row, add:

```tsx
{activeArtifact && (
  <div className="flex items-center gap-2 mb-2" style={{ alignSelf: "flex-start" }}>
    <span className="inline-flex items-center gap-2 text-xs" style={{ background: "rgba(91,33,232,0.18)", color: "#A07BFF", border: "1px solid rgba(91,33,232,0.35)", borderRadius: 999, padding: "4px 8px" }}>
      <span aria-hidden="true">🖼️</span>
      Editing your visual ↑
      <button type="button" aria-label="Stop editing this visual" onClick={() => setActiveArtifact(null)} style={{ background: "transparent", border: "none", color: "#A07BFF", cursor: "pointer", padding: 0, lineHeight: 1 }}>✕</button>
    </span>
  </div>
)}
```

- [ ] **Step 4: Gate `send()` so a typed refine routes to the edit path**

At the very top of `send(text?, options?)` (line ~540), after resolving the message text but BEFORE the `/api/orchestrate` fetch, add:

```tsx
const messageText = (text ?? input).trim();
// Edit-as-intent free-text gate: only when an artifact is the visibly-active
// target AND the text is edit-shaped (keyword pass). Otherwise fall through to
// normal routing. An explicit "new"/"another" cue clears the target first.
if (activeArtifact) {
  if (/\b(new|another|different)\b.*\b(image|picture|photo|visual|video|logo|graphic)\b/i.test(messageText)) {
    setActiveArtifact(null);
  } else {
    const cls = classifyEditKeyword(messageText, activeArtifact.kind);
    if (cls && cls.op !== "variations") {
      setMessages((prev) => [...prev, { role: "user", content: messageText }]);
      setInput("");
      void applyEdit(cls.op, cls.editPrompt, activeArtifact.sourceUrl, activeArtifact.kind);
      return;
    }
    if (cls && cls.op === "variations") {
      setMessages((prev) => [...prev, { role: "user", content: messageText }]);
      setInput("");
      void generateImageOptions();
      return;
    }
  }
}
```

> Adapt `messageText`/`input`/`setInput` to the component's real variable names (search the existing `send` body for how it currently reads the input value — reuse those identifiers rather than introducing new ones).

- [ ] **Step 5: Typecheck + unit tests**

Run:
```
npx tsc --noEmit
npx vitest run
```
Expected: exit 0; all green (including the broadened `trigger-surfaces.test.ts`, which now sees a `runEdit` call site in the already-registered CommandCenter).

- [ ] **Step 6: Verify in the running app (preview)**

Start the app and exercise the loop manually (or via the preview tools): generate an image → confirm the edit bar appears → click "Remove background" → confirm a new image renders and the pill shows "Editing your visual ↑" → type "make it warmer" → confirm it edits (not a fresh generation) → dismiss the pill → type "a new logo for IRIS" → confirm it generates fresh. Capture a screenshot for the summary.

- [ ] **Step 7: Commit**

```bash
git add apps/web/app/components/CommandCenter.tsx
git commit -m "feat(ui): image edit-as-intent in CommandCenter (bar + pill + send gate)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

- [ ] **Step 8: Tranche B gate**

Run:
```
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: all green + "Compiled successfully". The named "no background + outline" failure is now fixed for images.

---

## TRANCHE C — Video edit-as-intent + DepartmentRoom parity

### Task 9: Tier-gate the video-edit path in CommandCenter

**Files:**
- Modify: `apps/web/app/components/CommandCenter.tsx`

Video edits are metered, so they must pass `GenerationTierInline` before `runEdit` (Standard #38). Route a video edit chip/free-text through the existing `pendingGen`/tier-picker flow, then call `runEdit` with the chosen tier.

- [ ] **Step 1: Branch `applyEdit` for video**

In `applyEdit`, before the `runEdit` call, add a video branch that opens the tier picker and defers the submit:

```tsx
if (kind === "video" && op !== "refine" && op !== "variations") {
  // Metered — gate through the inline tier picker, then submit on confirm.
  setPendingGen({ kind: "video", mode: "edit", sourceUrl, instruction, op });
  return;
}
```

Extend the `GenerationRequest` type (in `GenerationTierInline`) with the optional edit fields `mode?: "generate" | "edit"; sourceUrl?: string; instruction?: string; op?: string;`, defaulting `mode` to `"generate"`.

- [ ] **Step 2: Handle the edit mode on tier confirm**

Where the tier picker confirm currently calls `generateInlineMedia(kind, tier)` (search for the `pendingGen` confirm handler), branch:

```tsx
if (pendingGen?.mode === "edit" && pendingGen.sourceUrl && pendingGen.instruction) {
  const { kind, sourceUrl, instruction } = pendingGen;
  setPendingGen(null);
  if (mediaBusyRef.current) return;
  mediaBusyRef.current = true;
  setMediaGen({ kind });
  try {
    const { url, error } = await runEdit({ kind, sourceUrl, instruction, tier });
    if (url) {
      setMessages((prev) => [...prev, { role: "assistant", content: "", media: { kind, urls: [url] } }]);
      setActiveArtifact({ kind, sourceUrl: url });
    } else {
      setMessages((prev) => [...prev, { role: "assistant", content: error ?? "Couldn't apply that edit — try again." }]);
    }
  } finally { mediaBusyRef.current = false; setMediaGen(null); }
  return;
}
```

- [ ] **Step 3: Typecheck + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: exit 0; all green.

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/CommandCenter.tsx apps/web/app/components/GenerationTierInline.tsx
git commit -m "feat(ui): tier-gate video edit-as-intent (Standard #38)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: DepartmentRoom parity

**Files:**
- Modify: `apps/web/app/components/DepartmentRoom.tsx`

DepartmentRoom also renders generations inline. Mount `EditAffordances` under its media and reuse the same `applyEdit`/active-artifact pattern, gating video through its `GenerationTierModal`.

- [ ] **Step 1: Locate DepartmentRoom's inline media render + generation handlers**

Run: `grep -nE "media|runGeneration|GenerationTierModal|setMessages|mediaBusy" app/components/DepartmentRoom.tsx | head -40`
Identify the inline media block and the existing tier-modal generate handler — the edit wiring mirrors Task 8/9 against these.

- [ ] **Step 2: Port active-artifact state + applyEdit + EditAffordances mount + (modal) tier gate for video**

Apply the same additions as Task 8 Steps 1–2 and Task 9, using DepartmentRoom's `GenerationTierModal` as the gate. Image edits submit directly; video edits open the modal then `runEdit({ ..., tier })`.

- [ ] **Step 3: Typecheck + tests + build**

Run:
```
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: all green + "Compiled successfully".

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/components/DepartmentRoom.tsx
git commit -m "feat(ui): edit-as-intent parity in DepartmentRoom

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Live verification + push

- [ ] **Step 1: Final full gate**

Run from `apps/web`:
```
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: exit 0; all green; "Compiled successfully".

- [ ] **Step 2: Push and live-curl sweep**

```bash
git push origin main
```
After Vercel deploys, confirm `/api/generation/edit` is live (a `curl` without auth must return 401, not a 500/404):
```bash
curl -s -o /dev/null -w "%{http_code}" -X POST https://urstaffd.com/api/generation/edit -H "Content-Type: application/json" -d '{"kind":"image","sourceUrl":"https://x/a.png","instruction":"make it blue"}'
```
Expected: `401` (route exists, auth enforced — per `staffd_vercel_footguns`, verify with a live curl, not deploy status).

- [ ] **Step 3: Manual loop check on production**

Generate an image → Remove background → confirm new artifact + pill → typed "add a soft shadow" edits it → "give me variations" returns a grid → pick one → refine it. Confirm a video edit ("add captions") shows the tier gate before charging.

---

## Self-Review

**Spec coverage** (against `2026-06-24-edit-as-intent-refine-loop-design.md`):
- §4.1 edit route → Task 4. §4.2 classifier (keyword + LLM) → Tasks 1–2. §4.3 EDIT_MODELS + buildBody → Tasks 1, 3. §4.4 explicit selection (bar, grid pick, pill) → Tasks 7–8. §4.5 send-gate (active-target + keyword, "new" guard, null fall-through) → Task 8 Step 4. §4.6 tier gate / video metered / image weight 0 → Tasks 4, 5, 9. §4.7 loop (edited result becomes new target) → Task 8 Step 1 (`setActiveArtifact(url)`). §5 data flow → Tasks 7–9. §6 error handling (source_required 400, not_an_edit 422→fall-through, routing_unresolved 500, out_of_credits 402) → Task 4 tests. §7 tests → Tasks 1,2,3,4,5,7. §8 files → all tasks.
- **Variations on an edited (prompt-less) artifact:** `generateImageOptions` uses `lastCompleted.output` (the text prompt), so "variations" after a pure edit has no prompt to re-run. v1 behaviour: variations chip is most meaningful on the first generation grid; on an edit result it re-runs the last text prompt if present, else no-ops with the existing warning. Acceptable for v1; right-sizing (variations-of-an-image via instruct_edit "a variation of this") is a follow-up, not in scope.
- **Video-edit credit weight:** v1 charges the selected video tier weight (ratified). Right-sizing edit costs to the cheaper combiner/caption price is a future refinement noted in the spec, not this plan.

**Placeholder scan:** no TBD/TODO; every code step shows complete code; the one fiddly UI merge (Task 8 Step 2) is called out with an explicit verify-in-app step rather than left vague. Slug verification (Task 3) is a concrete OpenAPI check, mirroring the existing "catalog-pending" routing pattern.

**Type consistency:** `EditOp`, `EditClassification`, `classifyEditKeyword`, `classifyEditLLM`, `ROUTE_OPS`, `OP_KIND`, `EDIT_OP_SPECS`, `routeForEdit`, `runEdit`, `applyEdit`, `activeArtifact` used consistently across tasks. `runEdit` opts `{ kind, sourceUrl, instruction, tier?, department? }` match the route body and the client driver. `onEdit(op, instruction, sourceUrl)` signature matches between `EditAffordances` (Task 7) and `applyEdit` (Task 8).
